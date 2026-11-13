import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const RELEASE_TAG = "animatic-media";

export function parseGhVersion(text) {
  const m = /gh version (\d+)\.(\d+)\.(\d+)/.exec(text ?? "");
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

const atLeast = (v, want) => {
  if (!v) return false;
  for (let i = 0; i < 3; i++) if (v[i] !== want[i]) return v[i] > want[i];
  return true;
};

/**
 * Decide how a video reaches a PR. Pure, so the privacy rule is tested, not trusted.
 * GitHub serves comment attachments from an anonymous URL, private repo or not.
 */
export function decide({ isPrivate, megabytes, ghVersion, policy }) {
  if (megabytes > policy.maxMegabytes)
    return { action: "refuse", reason: `video is ${megabytes.toFixed(1)} MB, limit is ${policy.maxMegabytes} MB — render with fewer or shorter shots, or --quality draft` };
  if (isPrivate) {
    if (policy.private === "refuse")
      return { action: "refuse", reason: "repo is private and attachments are served from a public URL; set attach.private to \"release-asset\" or \"allow\" in .animatic.json if that is fine" };
    if (policy.private === "release-asset")
      return { action: "release-asset", reason: "private repo: uploading as a release asset, which needs repo access to download (it will not play inline)" };
  }
  if (atLeast(ghVersion, [2, 99, 0])) return { action: "gh-attach", reason: "gh supports --attach" };
  return { action: "upload-api", reason: "gh is older than 2.99; posting to the user-attachments endpoint directly" };
}

const gh = (args, opts = {}) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();

export function attach({ video, repo, pr, heading, policy, dryRun, log = console.error }) {
  const megabytes = fs.statSync(video).size / 1e6;
  const info = JSON.parse(gh(["api", `repos/${repo}`, "--jq", "{private: .private, id: .id}"]));
  const ghVersion = parseGhVersion(gh(["--version"]));
  const d = decide({ isPrivate: info.private, megabytes, ghVersion, policy });
  log(`animatic attach: ${d.action} — ${d.reason}`);
  if (d.action === "refuse") return { ...d, ok: false };

  const name = `pr-${pr}-${path.basename(video)}`;
  const body = (ref) => `### ${heading}\n\n${ref}\n`;
  const bodyFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "animatic-")), "body.md");

  if (dryRun) return { ...d, ok: true, dryRun: true, name };

  if (d.action === "gh-attach") {
    // gh inserts the uploaded URL where the file is referenced; an empty ref line keeps it below the heading.
    fs.writeFileSync(bodyFile, body(""));
    const url = gh(["pr", "comment", String(pr), "-R", repo, "--body-file", bodyFile, "--attach", video]);
    return { ...d, ok: true, comment: url };
  }
  if (d.action === "upload-api") {
    const url = gh([
      "api", "--method", "POST",
      `https://uploads.github.com/user-attachments/assets?repository_id=${info.id}&name=${encodeURIComponent(name)}&content_type=video/mp4`,
      "--input", video, "--jq", ".url",
    ]);
    fs.writeFileSync(bodyFile, body(url));
    const comment = gh(["pr", "comment", String(pr), "-R", repo, "--body-file", bodyFile]);
    return { ...d, ok: true, url, comment };
  }
  // release-asset
  try {
    gh(["release", "view", RELEASE_TAG, "-R", repo]);
  } catch {
    gh(["release", "create", RELEASE_TAG, "-R", repo, "--prerelease", "--title", "animatic media", "--notes", "PR videos made by animatic. Safe to delete."]);
  }
  const staged = path.join(path.dirname(bodyFile), name);
  fs.copyFileSync(video, staged);
  gh(["release", "upload", RELEASE_TAG, staged, "-R", repo, "--clobber"]);
  const url = `https://github.com/${repo}/releases/download/${RELEASE_TAG}/${encodeURIComponent(name)}`;
  fs.writeFileSync(bodyFile, body(`[▶ 看视频](${url})`));
  const comment = gh(["pr", "comment", String(pr), "-R", repo, "--body-file", bodyFile]);
  return { ...d, ok: true, url, comment };
}
