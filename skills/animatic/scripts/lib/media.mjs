import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

export function probeSeconds(file) {
  const out = run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).trim();
  const s = Number(out);
  if (!Number.isFinite(s)) throw new Error(`ffprobe could not read a duration from ${file}`);
  return s;
}

export function frameAt(video, seconds, out, width = 720) {
  run("ffmpeg", ["-v", "error", "-y", "-ss", seconds.toFixed(3), "-i", video, "-frames:v", "1", "-vf", `scale=${width}:-2`, out]);
  return out;
}

/** PSNR between two images in dB; Infinity when identical. */
export function psnr(a, b) {
  const r = spawnSync("ffmpeg", ["-v", "info", "-i", a, "-i", b, "-lavfi", "psnr", "-f", "null", "-"], { encoding: "utf8" });
  const m = `${r.stderr}${r.stdout}`.match(/average:(inf|[\d.]+)/);
  if (!m) throw new Error(`could not compare ${a} and ${b}`);
  return m[1] === "inf" ? Infinity : Number(m[1]);
}

/**
 * Check a rendered file against its timeline, from the frames themselves:
 * - the file is as long as the plan says;
 * - every shot without moving footage looks the same just after it settles and
 *   just before it starts to leave, so it really stayed on screen for its hold;
 * - one frame per shot at chat size, tiled into a contact sheet to look at.
 */
export function verifyRender(video, timeline, config, workDir) {
  const problems = [];
  fs.rmSync(workDir, { recursive: true, force: true }); // stale frames from a longer cut would end up on the sheet
  fs.mkdirSync(workDir, { recursive: true });
  const dur = probeSeconds(video);
  const frame = 1 / config.fps;
  if (Math.abs(dur - timeline.total) > 2 * frame)
    problems.push(`file runs ${dur.toFixed(3)}s, plan says ${timeline.total.toFixed(3)}s`);

  const measured = [];
  timeline.shots.forEach((s, i) => {
    const mid = path.join(workDir, `sheet-${String(i).padStart(2, "0")}.png`);
    frameAt(video, s.inAt + s.hold / 2, mid);
    if (s.kind === "clip" || s.moving) {
      measured.push({ id: s.id, hold: s.hold, checked: "footage moves; length taken from the plan" });
      return;
    }
    // Labels and highlights finish within ~1.2s of the shot settling.
    const settle = Math.min(s.inAt + 1.2, s.inAt + s.hold / 2);
    const a = frameAt(video, settle, path.join(workDir, `${s.id}-a.png`), 480);
    const b = frameAt(video, s.outAt - frame, path.join(workDir, `${s.id}-b.png`), 480);
    const db = psnr(a, b);
    if (db < 38) problems.push(`${s.id}: picture changed during its hold (PSNR ${db.toFixed(1)} dB) — something moves or fades early`);
    measured.push({ id: s.id, hold: Number((s.outAt - s.inAt).toFixed(3)), need: Number(s.need.toFixed(2)), stillPsnr: db === Infinity ? "identical" : Number(db.toFixed(1)) });
  });

  const cols = timeline.shots.length > 4 ? 3 : 2;
  const rows = Math.ceil(timeline.shots.length / cols);
  const sheet = path.join(workDir, "contact-sheet.png");
  run("ffmpeg", ["-v", "error", "-y", "-start_number", "0", "-i", path.join(workDir, "sheet-%02d.png"), "-vf", `tile=${cols}x${rows}:padding=8:color=0x333333`, "-frames:v", "1", sheet]);
  return { duration: dur, problems, measured, sheet };
}
