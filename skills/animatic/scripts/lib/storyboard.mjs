import fs from "node:fs";
import path from "node:path";
import { tokens, newTokens, readingSeconds, htmlText, captionSize } from "./text.mjs";

export const KINDS = ["scene", "clip", "image", "compare"];
const VIDEO = /\.(mp4|webm|mov)$/i;
const IMAGE = /\.(png|jpe?g|webp|gif|svg)$/i;

export function loadStoryboard(file) {
  const raw = fs.readFileSync(file, "utf8");
  let sb;
  try {
    sb = JSON.parse(raw);
  } catch (e) {
    throw new Error(`${file}: not valid JSON (${e.message})`);
  }
  return { sb, dir: path.dirname(path.resolve(file)) };
}

/** Text a viewer sees on the shot itself, excluding its caption and screenshot pixels. */
export function onScreenText(shot, dir) {
  const parts = [];
  if (shot.kind === "scene" && shot.html) {
    const p = path.resolve(dir, shot.html);
    if (fs.existsSync(p)) parts.push(htmlText(fs.readFileSync(p, "utf8")));
  }
  for (const l of shot.labels ?? []) parts.push(l.text ?? "");
  if (shot.kind === "compare") parts.push(shot.beforeLabel ?? "", shot.afterLabel ?? "");
  return parts.join(" ");
}

function mediaFiles(shot) {
  if (shot.kind === "clip" || shot.kind === "image") return [["src", shot.src]];
  if (shot.kind === "compare") return [["before", shot.before], ["after", shot.after]];
  if (shot.kind === "scene") return [["html", shot.html]];
  return [];
}

/**
 * Validate a storyboard and compute its timeline.
 * `probe(path) -> seconds` measures a video; injected so tests need no ffmpeg.
 * Returns { errors, warnings, shots: [{...shot, start, hold, inAt, outAt, need, newWords}], total }.
 */
export function plan(sb, dir, config, probe) {
  const errors = [];
  const warnings = [];
  const T = config.transitionSeconds;

  if (!sb || typeof sb !== "object") return { errors: ["storyboard must be a JSON object"], warnings, shots: [], total: 0 };
  if (!sb.takeaway || typeof sb.takeaway !== "string")
    errors.push("takeaway: write the one sentence the viewer should remember. It is never shown; it decides what to cut.");
  const shots = Array.isArray(sb.shots) ? sb.shots : [];
  if (shots.length === 0) errors.push("shots: need at least one shot");
  if (shots.length > config.maxShots)
    errors.push(`shots: ${shots.length} shots, limit is ${config.maxShots}. Cut every shot that does not change what the viewer knows.`);

  const ids = new Set();
  let prevText = [];
  let t = 0;
  const out = [];

  shots.forEach((shot, i) => {
    const where = `shots[${i}]${shot?.id ? ` (${shot.id})` : ""}`;
    if (!shot || typeof shot !== "object") {
      errors.push(`${where}: must be an object`);
      return;
    }
    if (!shot.id) errors.push(`${where}: id is required`);
    else if (ids.has(shot.id)) errors.push(`${where}: duplicate id`);
    ids.add(shot.id);

    if (!KINDS.includes(shot.kind)) errors.push(`${where}: kind must be one of ${KINDS.join(", ")}`);

    if (!shot.caption || !String(shot.caption).trim()) errors.push(`${where}: caption is required — say what the picture means, in one short line`);
    else {
      const c = captionSize(shot.caption);
      if (config.language === "en" && c.cjk > 0)
        errors.push(`${where}: caption is not in English; videos are in English unless .animatic.json sets "language"`);
      if (c.cjk > config.caption.maxCjk || c.words > config.caption.maxWords)
        errors.push(`${where}: caption too long (${c.cjk} 字 / ${c.words} words; limit ${config.caption.maxCjk} 字 or ${config.caption.maxWords} words)`);
    }

    // Every pixel of product UI must come from a real capture, never be drawn.
    for (const [field, rel] of mediaFiles(shot)) {
      if (!rel) {
        errors.push(`${where}: ${field} is required for kind "${shot.kind}"`);
        continue;
      }
      const abs = path.resolve(dir, rel);
      if (!fs.existsSync(abs)) errors.push(`${where}: ${field} file not found: ${rel}`);
      if (field === "html" && !/\.html?$/i.test(rel)) errors.push(`${where}: html must be an .html fragment`);
      if (shot.kind === "clip" && !VIDEO.test(rel)) errors.push(`${where}: clip src must be a video (mp4/webm/mov)`);
      if (shot.kind === "image" && !IMAGE.test(rel)) errors.push(`${where}: image src must be an image`);
      if (shot.kind === "compare" && !VIDEO.test(rel) && !IMAGE.test(rel)) errors.push(`${where}: ${field} must be an image or video`);
    }

    for (const [j, l] of (shot.labels ?? []).entries()) {
      if (!l.text) errors.push(`${where}: labels[${j}].text is required`);
      if (!(l.x >= 0 && l.x <= 1 && l.y >= 0 && l.y <= 1))
        errors.push(`${where}: labels[${j}] needs x and y between 0 and 1 — put the label on the thing it names`);
    }

    // Reading time: the caption plus every on-screen word the previous shot did not show.
    const screen = tokens(onScreenText(shot, dir));
    const fresh = [...newTokens(prevText, screen), ...tokens(shot.caption ?? "")];
    prevText = screen;
    const need = Math.max(config.minHoldSeconds, readingSeconds(fresh, config.readingSpeed));

    let hold = need;
    let clipLen = null;
    if (shot.kind === "clip" && shot.src && fs.existsSync(path.resolve(dir, shot.src))) {
      const full = probe(path.resolve(dir, shot.src));
      const [a, b] = shot.trim ?? [0, full];
      if (!(a >= 0 && b > a && b <= full + 0.05)) errors.push(`${where}: trim [${a}, ${b}] is outside the clip (0–${full.toFixed(2)}s)`);
      clipLen = Math.min(b, full) - a;
      if (clipLen + 1e-6 < need)
        errors.push(`${where}: clip plays ${clipLen.toFixed(2)}s but its text needs ${need.toFixed(2)}s to read. Shorten the caption or keep more of the clip.`);
      hold = Math.max(need, clipLen);
    }
    if (shot.hold !== undefined) {
      if (typeof shot.hold !== "number" || shot.hold + 1e-6 < need)
        errors.push(`${where}: hold ${shot.hold}s is shorter than the ${need.toFixed(2)}s its new text needs`);
      else if (clipLen !== null && shot.hold > clipLen + 0.05)
        errors.push(`${where}: hold ${shot.hold}s is longer than the clip (${clipLen.toFixed(2)}s)`);
      else hold = shot.hold;
    }
    hold = Math.round(hold * config.fps) / config.fps;

    const start = t;
    out.push({ ...shot, start, inAt: start + T, outAt: start + T + hold, hold, need, newWords: fresh.length, clipLen });
    t = start + T + hold;
  });

  const total = Math.round((t + T) * config.fps) / config.fps;
  if (total > 90) warnings.push(`video runs ${total.toFixed(1)}s; reviewers rarely watch past a minute`);
  return { errors, warnings, shots: out, total };
}
