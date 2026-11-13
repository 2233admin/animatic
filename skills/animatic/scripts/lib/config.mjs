import fs from "node:fs";
import path from "node:path";

// Everything a team might reasonably disagree on lives here, not in code.
// A repo overrides any key in `.animatic.json` at its root.
export const DEFAULTS = {
  width: 1920,
  height: 1080,
  fps: 30,
  captionBarHeight: 128,
  captionFontSize: 46,
  transitionSeconds: 0.4,
  minHoldSeconds: 1.6,
  maxShots: 10,
  // Language of everything on screen. "en" rejects CJK captions; set "zh" (or any other) to allow them.
  language: "en",
  readingSpeed: { cjkCharsPerSecond: 5, wordsPerSecond: 3 },
  caption: { maxCjk: 24, maxWords: 14 },
  // ark: industrial sci-fi document (after arknights-printer). plain: dark, no chrome.
  style: "ark",
  // field | terminal-dark | terminal-ice | paper | wartime — one institution, one dialect.
  dialect: "field",
  // The one saturated colour. null keeps the dialect's own; pick it from the subject.
  brand: null,
  onBrand: null,
  attach: {
    // GitHub serves PR attachments from an anonymous URL even for private repos.
    // refuse | release-asset | allow
    private: "refuse",
    maxMegabytes: 10,
  },
  quality: "standard",
};

function merge(base, over) {
  if (!over || typeof over !== "object" || Array.isArray(over)) return over ?? base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = base && typeof base[k] === "object" && !Array.isArray(base[k]) ? merge(base[k], v) : v;
  }
  return out;
}

/** Walk up from `start` to find `.animatic.json`; merge it over the defaults. */
export function loadConfig(start = process.cwd(), extra = undefined) {
  let dir = path.resolve(start);
  let found = null;
  for (;;) {
    const p = path.join(dir, ".animatic.json");
    if (fs.existsSync(p)) {
      found = p;
      break;
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  let cfg = DEFAULTS;
  if (found) cfg = merge(cfg, JSON.parse(fs.readFileSync(found, "utf8")));
  if (extra) cfg = merge(cfg, extra);
  return { config: cfg, source: found };
}

export { merge };
