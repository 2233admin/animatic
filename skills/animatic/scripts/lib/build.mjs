import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { onScreenText } from "./storyboard.mjs";

const STYLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "assets", "styles");
const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const VIDEO = /\.(mp4|webm|mov)$/i;
const n = (x) => Number(x.toFixed(3));
const pad2 = (x) => String(x).padStart(2, "0");

// Google Fonts families each style draws with, as css2 `family=` specs.
const FONTS = {
  ark: ["Archivo:wdth,wght@125,500;125,600", "Geist Mono:wght@300;400;500;600", "Noto Sans SC:wght@300;400;500;600"],
  plain: ["Noto Sans SC:wght@400;500;600;700"],
};

/**
 * Pin every glyph so all machines render the same film: fetch subsets holding
 * exactly the characters on screen and point @font-face at local copies.
 * Offline, fall back to installed fonts and say so.
 */
function fontFaces(specs, text, outDir, warn) {
  const chars = [...new Set(text + "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-·/ ")].join("");
  const fam = specs.map((s) => `family=${s.replace(/ /g, "+")}`).join("&");
  const url = `https://fonts.googleapis.com/css2?${fam}&text=${encodeURIComponent(chars)}`;
  try {
    let css = execFileSync("curl", ["-sSfL", "-m", "30", "-A", "Mozilla/5.0 Chrome/120", url], { encoding: "utf8" });
    let i = 0;
    css = css.replace(/url\((https:[^)]+)\)/g, (_, u) => {
      const file = `assets/font-${i++}.ttf`;
      execFileSync("curl", ["-sSfL", "-m", "60", "-o", path.join(outDir, file), u]);
      return `url("${file}")`;
    });
    if (!i) throw new Error("no font files in response");
    return css;
  } catch (e) {
    warn(`could not fetch font subsets (${String(e.message).split("\n")[0]}); using installed fonts, so renders may differ between machines`);
    return "";
  }
}

function copyAsset(abs, outDir, seen) {
  if (seen.has(abs)) return seen.get(abs);
  const h = crypto.createHash("sha1").update(abs).digest("hex").slice(0, 8);
  const rel = `assets/${h}-${path.basename(abs)}`;
  fs.copyFileSync(abs, path.join(outDir, rel));
  seen.set(abs, rel);
  return rel;
}

/** Inline a scene fragment, copying any local file it points at. */
function sceneHtml(abs, outDir, seen) {
  return fs.readFileSync(abs, "utf8").replace(/\b(src|href)="([^"]+)"/g, (m, attr, ref) => {
    if (/^(https?:|data:|#)/.test(ref)) return m;
    const file = path.resolve(path.dirname(abs), ref);
    if (!fs.existsSync(file)) throw new Error(`${path.basename(abs)}: ${attr}="${ref}" not found`);
    return `${attr}="${copyAsset(file, outDir, seen)}"`;
  });
}

function media(rel, dir, outDir, seen, t) {
  const src = copyAsset(path.resolve(dir, rel), outDir, seen);
  if (VIDEO.test(rel))
    return `<video class="clip media" src="${src}" muted playsinline data-start="${n(t.start)}" data-duration="${n(t.dur)}" data-media-start="${n(t.mediaStart ?? 0)}"></video>`;
  return `<img class="media" src="${src}" alt="" />`;
}

function labels(shot) {
  return (shot.labels ?? [])
    .map((l, i) => `<div class="label" id="${esc(shot.id)}-l${i}" style="left:${l.x * 100}%;top:${l.y * 100}%"><i></i><s></s><span>${esc(l.text)}</span></div>`)
    .join("");
}

/** What the document says about itself: who issued it, its number, its source line. */
export function docMeta(sb) {
  const d = sb.doc ?? {};
  const repo = sb.pr?.repo ?? "";
  return {
    issuer: d.issuer ?? (repo ? repo.split("/").pop() : "animatic"),
    subtitle: d.subtitle ?? sb.title ?? "",
    index: d.index ?? (sb.pr?.number ? `PR-${sb.pr.number}` : "PR"),
    src: d.src ?? `SRC / ${repo ? `${repo} · ` : ""}captured from the running change`,
  };
}

// The emblem's motif is a merge: two lines joining into one, inside a chamfered square.
const EMBLEM = `<svg viewBox="0 0 56 56" aria-hidden="true"><path d="M2 2H44L54 12V54H2Z" fill="none" stroke="currentColor" stroke-width="3"/><path d="M18 12V44M38 12C38 30 18 24 18 34" fill="none" stroke="currentColor" stroke-width="3.5"/><rect x="12" y="38" width="12" height="12" fill="var(--brand)"/></svg>`;

function chrome(style, meta, W, H) {
  if (style !== "ark") return "";
  const m = 96;
  const corners = [
    [m - 4, 36], [W - m - 5, 36], [m - 4, H - 45], [W - m - 5, H - 45],
  ].map(([x, y]) => `<i class="corner" style="left:${x}px;top:${y}px"></i>`).join("");
  const ticks = [
    `left:${m}px;top:0;width:2px;height:24px`, `left:${W - m}px;top:0;width:2px;height:24px`,
    `left:${m}px;top:${H - 24}px;width:2px;height:24px`, `left:${W - m}px;top:${H - 24}px;width:2px;height:24px`,
    `left:40px;top:40px;width:30px;height:2px`, `left:${W - 70}px;top:40px;width:30px;height:2px`,
    `left:40px;top:${H - 41}px;width:30px;height:2px`, `left:${W - 70}px;top:${H - 41}px;width:30px;height:2px`,
  ].map((s) => `<i class="tick" style="${s}"></i>`).join("");
  const strip = ["#00a6e0", "#e6007e", "#ffed00", "#1a1a1a", "var(--brand)", "#777", "#bbb"].map((c) => `<i style="background:${c}"></i>`).join("");
  return `
      <svg class="streaks" width="${W}" height="${H}" aria-hidden="true"><filter id="st"><feTurbulence type="fractalNoise" baseFrequency="0.0007 0.012" numOctaves="2" seed="7"/><feColorMatrix type="saturate" values="0"/><feGaussianBlur stdDeviation="0 6"/></filter><rect width="100%" height="100%" filter="url(#st)"/></svg>
      <div class="grid-dots"></div>${corners}${ticks}
      <header class="head"><div class="issuer">${EMBLEM}<div><b>${esc(meta.issuer)}</b><span>${esc(meta.subtitle)}</span></div></div><div class="docno">${esc(meta.index)}</div></header>
      <footer class="foot"><span>${esc(meta.src)}</span><span class="strip">${strip}</span></footer>
      <div class="screen"></div>`;
}

/** Write a HyperFrames project for the planned shots into `outDir`. */
export function buildProject({ shots, total }, sb, dir, config, outDir, gsapPath, warn = console.error) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, "assets"), { recursive: true });
  fs.copyFileSync(gsapPath, path.join(outDir, "gsap.min.js"));
  const seen = new Map();
  const { width: W, height: H, transitionSeconds: T } = config;
  const style = config.style === "plain" ? "plain" : "ark";
  const BAR = config.captionBarHeight;
  const [SW, SH] = style === "ark" ? [W - 192, 660] : [W, H - BAR];
  const meta = docMeta(sb);

  const bodies = shots.map((s, i) => {
    const dur = T + s.hold + T;
    const t = { start: s.start, dur, mediaStart: s.kind === "clip" ? Math.max(0, (s.trim?.[0] ?? 0) - T) : 0 };
    let stage = "";
    if (s.kind === "scene") stage = `<div class="scene">${sceneHtml(path.resolve(dir, s.html), outDir, seen)}</div>`;
    if (s.kind === "clip" || s.kind === "image") stage = `<div class="frame">${media(s.src, dir, outDir, seen, t)}</div>`;
    if (s.kind === "compare")
      stage = `<div class="compare">
        <figure><figcaption class="tag bad">${esc(s.beforeLabel ?? "改之前")}</figcaption><div class="frame">${media(s.before, dir, outDir, seen, { ...t, mediaStart: 0 })}</div></figure>
        <figure><figcaption class="tag good">${esc(s.afterLabel ?? "改之后")}</figcaption><div class="frame">${media(s.after, dir, outDir, seen, { ...t, mediaStart: 0 })}</div></figure>
      </div>`;
    return `<section id="${esc(s.id)}" class="clip shot" data-start="${n(s.start)}" data-duration="${n(dur)}" data-track-index="${i % 2}">
        <div class="sheetno">SHEET ${pad2(i + 1)} OF ${pad2(shots.length)}</div>
        <div class="stage">${stage}${labels(s)}</div>
        <div class="bar"><p>${esc(s.caption)}</p></div>
      </section>`;
  });

  const anim = shots
    .map((s, i) => {
      const id = JSON.stringify(`#${s.id}`);
      const lines = [
        `tl.fromTo(${id}, {opacity:0}, {opacity:1, duration:${T}, ease:"power2.out"}, ${n(s.start)});`,
        `tl.fromTo(${id}+" .stage", {y:14}, {y:0, duration:${n(T + 0.3)}, ease:"power3.out"}, ${n(s.start)});`,
      ];
      (s.labels ?? []).forEach((_, j) =>
        lines.push(`tl.fromTo("#${s.id}-l${j}", {opacity:0, x:-10}, {opacity:1, x:0, duration:0.3, ease:"power2.out"}, ${n(s.inAt + 0.1 + j * 0.15)});`),
      );
      (s.highlight ?? []).forEach((sel, j) =>
        lines.push(`tl.fromTo(${JSON.stringify(`#${s.id} ${sel}`)}, {scale:1}, {scale:1.06, duration:0.3, yoyo:true, repeat:1, ease:"sine.inOut"}, ${n(s.inAt + 0.2 + j * 0.25)});`),
      );
      if (i < shots.length - 1) lines.push(`tl.to(${id}, {opacity:0, duration:${T}, ease:"power2.in"}, ${n(s.outAt)});`);
      return lines.join("\n      ");
    })
    .join("\n      ");

  const allText = shots.map((s) => `${s.caption} ${onScreenText(s, dir)}`).join("") + Object.values(meta).join("");
  const faces = fontFaces(FONTS[style], allText, outDir, warn);
  const css = fs
    .readFileSync(path.join(STYLES, `${style}.css`), "utf8")
    .replaceAll("{{W}}", W).replaceAll("{{H}}", H).replaceAll("{{SW}}", SW).replaceAll("{{SH}}", SH).replaceAll("{{BAR}}", BAR);
  const brand = config.brand ? `--brand:${config.brand};${config.onBrand ? `--on-brand:${config.onBrand};` : ""}` : "";

  const html = `<!doctype html>
<html lang="${esc(sb.lang ?? "zh-CN")}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${W}, height=${H}" />
    <title>${esc(sb.title ?? meta.index)}</title>
    <script src="./gsap.min.js"></script>
    <style>
${faces}
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: #000; }
${css}
    </style>
  </head>
  <body>
    <div id="root" data-dialect="${esc(config.dialect)}" style="${brand}" data-composition-id="main" data-start="0" data-duration="${n(total)}" data-width="${W}" data-height="${H}" data-fps="${config.fps}">${chrome(style, meta, W, H)}
      ${bodies.join("\n      ")}
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
      ${anim}
      window.__timelines = window.__timelines || {};
      window.__timelines["main"] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
`;
  fs.writeFileSync(path.join(outDir, "index.html"), html);
  fs.writeFileSync(
    path.join(outDir, "hyperframes.json"),
    JSON.stringify({ paths: { blocks: "compositions", components: "compositions/components", assets: "assets" }, media: { autoProxy: true } }, null, 2),
  );
  fs.writeFileSync(
    path.join(outDir, "timeline.json"),
    JSON.stringify({ total, shots: shots.map(({ id, kind, start, inAt, outAt, hold, need, newWords, caption }) => ({ id, kind, start, inAt, outAt, hold, need, newWords, caption })) }, null, 2),
  );
  return path.join(outDir, "index.html");
}
