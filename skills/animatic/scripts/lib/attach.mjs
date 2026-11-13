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

  // Direct upload can be blocked (proxies, enterprise policy). Fall back to a release asset:
  // it will not play inline, but the reviewer still gets the video.
  try {
    if (d.action === "gh-attach" || d.action === "upload-api") return direct(d, { video, repo, pr, info, name, body, bodyFile });
  } catch (e) {
    log(`animatic attach: ${d.action} failed (${String(e.stderr || e.message).trim().split("\n").pop()}); falling back to a release asset`);
  }
  return viaRelease({ ...d, action: "release-asset", fellBack: d.action !== "release-asset" }, { video, repo, pr, name, body, bodyFile });
}

function direct(d, { video, repo, pr, info, name, body, bodyFile }) {
  if (d.action === "gh-attach") {
    // gh inserts the uploaded URL where the file is referenced; an empty ref line keeps it below the heading.
    fs.writeFileSync(bodyFile, body(""));
    // gh pr comment talks GraphQL; this path needs gh >= 2.99 and an unrestricted API.
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
    return { ...d, ok: true, url, comment: comment(repo, pr, bodyFile) };
  }
}

// REST only: repository-scoped endpoints work where GraphQL or other paths are blocked.
function comment(repo, pr, bodyFile) {
  return gh(["api", "--method", "POST", `repos/${repo}/issues/${pr}/comments`, "-F", `body=@${bodyFile}`, "--jq", ".html_url"]);
}

function viaRelease(d, { video, repo, pr, name, body, bodyFile }) {
  let rel;
  try {
    rel = JSON.parse(gh(["api", `repos/${repo}/releases/tags/${RELEASE_TAG}`, "--jq", "{id, upload_url}"]));
  } catch {
    rel = JSON.parse(gh([
      "api", "--method", "POST", `repos/${repo}/releases`, "-f", `tag_name=${RELEASE_TAG}`, "-f", "name=animatic media",
      "-f", "body=PR videos made by animatic. Safe to delete.", "-F", "prerelease=true", "--jq", "{id, upload_url}",
    ]));
  }
  const old = gh(["api", `repos/${repo}/releases/${rel.id}/assets`, "--paginate", "--jq", `.[] | select(.name == "${name}") | .id`]);
  for (const id of old.split("\n").filter(Boolean)) gh(["api", "--method", "DELETE", `repos/${repo}/releases/assets/${id}`]);
  const uploadBase = rel.upload_url.replace(/\{.*\}$/, "");
  const url = gh(["api", "--method", "POST", `${uploadBase}?name=${encodeURIComponent(name)}`, "-H", "Content-Type: video/mp4", "--input", video, "--jq", ".browser_download_url"]);
  fs.writeFileSync(bodyFile, body(`[▶ Watch the video](${url})`));
  return { ...d, ok: true, url, comment: comment(repo, pr, bodyFile) };
}
