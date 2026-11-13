import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tokens, newTokens, readingSeconds, htmlText } from "../skills/animatic/scripts/lib/text.mjs";
import { plan } from "../skills/animatic/scripts/lib/storyboard.mjs";
import { DEFAULTS, merge } from "../skills/animatic/scripts/lib/config.mjs";
import { decide, parseGhVersion } from "../skills/animatic/scripts/lib/attach.mjs";

const speed = DEFAULTS.readingSpeed;
const ZH = { ...DEFAULTS, language: "zh" };

test("CJK counts per character, other scripts per word", () => {
  assert.deepEqual(tokens("改了 PR 的 merge queue"), ["改", "了", "的", "pr", "merge", "queue"]);
  // 5 字 at 5/s + 3 words at 3/s = 2s
  assert.equal(readingSeconds(tokens("搜索变快了 three words here"), speed), 2);
});

test("only text the previous shot did not show counts as new", () => {
  const prev = tokens("PR 审查者");
  const next = tokens("PR 视频 审查者");
  assert.deepEqual(newTokens(prev, next), ["视", "频"]);
});

test("htmlText drops tags, scripts and styles", () => {
  assert.equal(htmlText('<div class="box">PR<small>只有文字</small></div><style>.x{}</style>'), "PR 只有文字");
});

function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "animatic-test-"));
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), body);
  }
  return dir;
}

test("hold is long enough to read the caption and the new on-screen words", () => {
  const dir = fixture({ "a.html": "<div>一二三四五</div>", "b.html": "<div>一二三四五 六七八九十</div>" });
  const sb = {
    takeaway: "x",
    shots: [
      { id: "a", kind: "scene", html: "a.html", caption: "甲乙丙丁戊" },
      { id: "b", kind: "scene", html: "b.html", caption: "甲乙丙丁戊" },
    ],
  };
  const p = plan(sb, dir, ZH, () => 0);
  assert.deepEqual(p.errors, []);
  assert.equal(p.shots[0].need, 2); // 5 on screen + 5 caption = 10 字
  assert.equal(p.shots[1].need, 2); // 5 new on screen + 5 caption
  // shots overlap by one transition; total = sum(T + hold) + T
  const T = DEFAULTS.transitionSeconds;
  assert.ok(Math.abs(p.total - (T + 2 + T + 2 + T)) < 1e-9);
});

test("a hand-set hold shorter than reading time is an error, not a silent fix", () => {
  const dir = fixture({ "a.html": "<div>图</div>" });
  const sb = { takeaway: "x", shots: [{ id: "a", kind: "scene", html: "a.html", caption: "这是一句需要好几秒才能读完的字幕", hold: 1 }] };
  const p = plan(sb, dir, DEFAULTS, () => 0);
  assert.match(p.errors.join("\n"), /hold 1s is shorter/);
});

test("UI shots must point at real captures", () => {
  const dir = fixture({});
  const sb = { takeaway: "x", shots: [{ id: "ui", kind: "clip", src: "captures/flow.mp4", caption: "新按钮出现了" }] };
  const p = plan(sb, dir, DEFAULTS, () => 5);
  assert.match(p.errors.join("\n"), /file not found: captures\/flow.mp4/);
});

test("a clip too short for its caption fails loudly", () => {
  const dir = fixture({ "c.mp4": "x" });
  const sb = { takeaway: "x", shots: [{ id: "c", kind: "clip", src: "c.mp4", caption: "这一句字幕需要至少三秒钟才能读得完整" }] };
  const p = plan(sb, dir, ZH, () => 1.0);
  assert.match(p.errors.join("\n"), /clip plays 1.00s but its text needs/);
});

test("missing takeaway, too many shots and long captions are all reported at once", () => {
  const dir = fixture({ "a.html": "<div>x</div>" });
  const shots = Array.from({ length: 11 }, (_, i) => ({ id: `s${i}`, kind: "scene", html: "a.html", caption: "短" }));
  shots[0].caption = "这是一句明显超过了二十四个汉字上限的字幕，它应该被检查脚本拦下来才对";
  const p = plan({ shots }, dir, DEFAULTS, () => 0);
  const all = p.errors.join("\n");
  assert.match(all, /takeaway/);
  assert.match(all, /11 shots, limit is 10/);
  assert.match(all, /caption too long/);
});

test("labels must sit on the thing they name", () => {
  const dir = fixture({ "i.png": "x" });
  const sb = { takeaway: "x", shots: [{ id: "i", kind: "image", src: "i.png", caption: "这里", labels: [{ text: "新按钮" }] }] };
  assert.match(plan(sb, dir, DEFAULTS, () => 0).errors.join("\n"), /x and y between 0 and 1/);
});

test("private repos are refused by default because attachment URLs are public", () => {
  const d = decide({ isPrivate: true, megabytes: 1, ghVersion: [2, 99, 0], policy: DEFAULTS.attach });
  assert.equal(d.action, "refuse");
  const r = decide({ isPrivate: true, megabytes: 1, ghVersion: [2, 99, 0], policy: { ...DEFAULTS.attach, private: "release-asset" } });
  assert.equal(r.action, "release-asset");
});

test("public repos use gh --attach when gh is new enough, else the upload endpoint", () => {
  assert.equal(decide({ isPrivate: false, megabytes: 1, ghVersion: parseGhVersion("gh version 2.99.1 (x)"), policy: DEFAULTS.attach }).action, "gh-attach");
  assert.equal(decide({ isPrivate: false, megabytes: 1, ghVersion: parseGhVersion("gh version 2.89.0 (x)"), policy: DEFAULTS.attach }).action, "upload-api");
  assert.equal(decide({ isPrivate: false, megabytes: 40, ghVersion: [3, 0, 0], policy: DEFAULTS.attach }).action, "refuse");
});

test("repo config overrides defaults key by key", () => {
  const c = merge(DEFAULTS, { readingSpeed: { cjkCharsPerSecond: 8 }, attach: { private: "allow" } });
  assert.equal(c.readingSpeed.cjkCharsPerSecond, 8);
  assert.equal(c.readingSpeed.wordsPerSecond, 3);
  assert.equal(c.attach.maxMegabytes, 10);
});

import { docMeta } from "../skills/animatic/scripts/lib/build.mjs";

test("the document is numbered after the PR unless the storyboard says otherwise", () => {
  const m = docMeta({ pr: { repo: "XartLab/foreman", number: 42 } });
  assert.equal(m.issuer, "foreman");
  assert.equal(m.index, "PR-42");
  assert.equal(docMeta({ doc: { index: "ANM-001" } }).index, "ANM-001");
});

test("videos are in English by default", () => {
  const dir = fixture({ "a.html": "<div>PR</div>" });
  const sb = { takeaway: "x", shots: [{ id: "a", kind: "scene", html: "a.html", caption: "现在 PR 自带视频" }] };
  assert.match(plan(sb, dir, DEFAULTS, () => 0).errors.join("\n"), /not in English/);
  assert.deepEqual(plan(sb, dir, ZH, () => 0).errors, []);
});
