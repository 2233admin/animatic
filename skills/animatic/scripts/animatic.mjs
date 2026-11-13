#!/usr/bin/env node
// animatic — storyboard in, checked PR video out.
//   animatic new <dir>                 scaffold a storyboard
//   animatic check <storyboard.json>   validate and time it, no rendering
//   animatic render <storyboard.json>  build, render, verify from the frames
//   animatic attach <video> --pr N     post it on the PR (privacy rule applies)
//   animatic doctor                    what is installed

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./lib/config.mjs";
import { loadStoryboard, plan } from "./lib/storyboard.mjs";
import { buildProject } from "./lib/build.mjs";
import { probeSeconds, verifyRender } from "./lib/media.mjs";
import { attach } from "./lib/attach.mjs";

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const say = (...a) => console.error(...a);
const die = (msg, code = 1) => {
  say(msg);
  process.exit(code);
};

function args(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      if (v !== undefined) flags[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith("--")) flags[k] = argv[++i];
      else flags[k] = true;
    } else if (a === "-o") flags.out = argv[++i];
    else pos.push(a);
  }
  return { pos, flags };
}

function ensureDeps() {
  const bin = path.join(SKILL_DIR, "node_modules", ".bin", "hyperframes");
  if (!fs.existsSync(bin)) {
    say("animatic: first run, installing the renderer (hyperframes, gsap)…");
    const r = spawnSync("npm", ["install", "--prefix", SKILL_DIR, "--no-audit", "--no-fund", "--loglevel=error"], { stdio: "inherit" });
    if (r.status !== 0) die("animatic: npm install failed; run it yourself in " + SKILL_DIR);
  }
  return { bin, gsap: path.join(SKILL_DIR, "node_modules", "gsap", "dist", "gsap.min.js") };
}

function report(p) {
  const rows = p.shots.map((s) => `  ${s.id.padEnd(14)} ${s.kind.padEnd(8)} hold ${s.hold.toFixed(2)}s  needs ${s.need.toFixed(2)}s  (${s.newWords} new)  ${s.caption}`);
  say(rows.join("\n"));
  say(`  total ${p.total.toFixed(2)}s, ${p.shots.length} shots`);
  for (const w of p.warnings) say(`warning: ${w}`);
  for (const e of p.errors) say(`error: ${e}`);
}

function planFile(file) {
  const { sb, dir } = loadStoryboard(file);
  const { config } = loadConfig(dir);
  const p = plan(sb, dir, config, probeSeconds);
  return { sb, dir, config, p };
}

const cmds = {
  doctor() {
    const has = (c, a = ["-version"]) => {
      try {
        return execFileSync(c, a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).split("\n")[0];
      } catch {
        return null;
      }
    };
    const lines = [
      ["node", process.version],
      ["ffmpeg", has("ffmpeg")],
      ["ffprobe", has("ffprobe")],
      ["gh", has("gh", ["--version"])],
      ["vhs (terminal capture)", has("vhs", ["--version"])],
      ["renderer", fs.existsSync(path.join(SKILL_DIR, "node_modules", "hyperframes")) ? "installed" : "installs on first render"],
    ];
    for (const [k, v] of lines) say(`${v ? "✓" : "✗"} ${k}${v ? `: ${v}` : ""}`);
  },

  new({ pos }) {
    const dir = path.resolve(pos[0] ?? ".animatic/pr");
    if (fs.existsSync(path.join(dir, "storyboard.json"))) die(`${dir}/storyboard.json already exists`);
    fs.mkdirSync(path.join(dir, "scenes"), { recursive: true });
    fs.mkdirSync(path.join(dir, "captures"), { recursive: true });
    fs.copyFileSync(path.join(SKILL_DIR, "assets", "storyboard.example.json"), path.join(dir, "storyboard.json"));
    for (const f of fs.readdirSync(path.join(SKILL_DIR, "assets", "scenes")))
      fs.copyFileSync(path.join(SKILL_DIR, "assets", "scenes", f), path.join(dir, "scenes", f));
    say(`animatic: wrote ${path.relative(process.cwd(), dir)}/storyboard.json and scenes/. Captures go in captures/.`);
  },

  check({ pos }) {
    if (!pos[0]) die("usage: animatic check <storyboard.json>");
    const { p } = planFile(pos[0]);
    report(p);
    if (p.errors.length) process.exit(1);
    say("check passed");
  },

  render({ pos, flags }) {
    if (!pos[0]) die("usage: animatic render <storyboard.json> [-o out.mp4] [--quality draft|standard|high]");
    const { sb, dir, config, p } = planFile(pos[0]);
    report(p);
    if (p.errors.length) die("render stopped: fix the storyboard first");
    const deps = ensureDeps();
    const work = path.join(dir, ".animatic");
    const project = path.join(work, "project");
    buildProject(p, sb, dir, config, project, deps.gsap);
    const out = path.resolve(flags.out ?? path.join(dir, "animatic.mp4"));
    say(`animatic: rendering ${p.total.toFixed(1)}s…`);
    const r = spawnSync(deps.bin, ["render", project, "-o", out, "-q", flags.quality ?? config.quality, "-f", String(config.fps), "--quiet"], {
      stdio: "inherit",
      env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1", DO_NOT_TRACK: "1", HYPERFRAMES_SKIP_SKILLS: "1" },
    });
    if (r.status !== 0 || !fs.existsSync(out)) die("render failed");
    const v = verifyRender(out, JSON.parse(fs.readFileSync(path.join(project, "timeline.json"), "utf8")), config, path.join(work, "verify"));
    fs.writeFileSync(path.join(work, "verify", "report.json"), JSON.stringify(v, null, 2));
    say(`animatic: ${out} (${v.duration.toFixed(2)}s, ${(fs.statSync(out).size / 1e6).toFixed(1)} MB)`);
    say(`animatic: contact sheet ${v.sheet} — look at it before posting`);
    for (const m of v.measured) say(`  ${m.id}: ${JSON.stringify(m)}`);
    if (v.problems.length) die(v.problems.map((x) => `problem: ${x}`).join("\n"));
    say("verify passed");
  },

  attach({ pos, flags }) {
    if (!pos[0] || !flags.pr) die("usage: animatic attach <video> --pr N [--repo owner/name] [--dry-run]");
    let repo = flags.repo;
    if (!repo) {
      const url = execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }).trim();
      const m = /github\.com[:/]([^/]+\/[^/.]+)/.exec(url);
      if (!m) die("could not tell the repo from git remote; pass --repo owner/name");
      repo = m[1];
    }
    const { config } = loadConfig(process.cwd());
    const res = attach({
      video: path.resolve(pos[0]),
      repo,
      pr: flags.pr,
      heading: flags.heading ?? "这个 PR 怎么运作",
      policy: config.attach,
      dryRun: Boolean(flags["dry-run"]),
    });
    console.log(JSON.stringify(res));
    if (!res.ok) process.exit(1);
  },
};

const [cmd, ...rest] = process.argv.slice(2);
if (!cmds[cmd]) die("usage: animatic <doctor|new|check|render|attach> …", cmd ? 1 : 0);
try {
  cmds[cmd](args(rest));
} catch (e) {
  die(`animatic ${cmd}: ${e.message}`);
}
