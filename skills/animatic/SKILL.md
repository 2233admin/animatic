---
name: animatic
description: Make a short, captioned, silent video that shows how a pull request works, and post it on the PR. Use when a PR changes something a reviewer would rather see than read — UI, a CLI or TUI flow, a data flow, an architecture — and when the user says /animatic, "PR video", "demo video", "show how it works", "录个视频", "给 PR 配视频", "做个动画讲解". Writes a storyboard, captures real footage (browser, terminal) or draws diagram scenes, renders with HyperFrames, checks the result from its own frames, and attaches it to the PR. Not for refactors, dependency bumps, typo fixes, or changes nobody can see.
compatibility: Needs Node 20+, ffmpeg/ffprobe and Chrome. gh CLI for posting. The renderer (hyperframes, gsap) installs into the skill folder on first render. Terminal capture uses vhs when installed; browser capture uses Playwright.
---

# animatic

A reviewer who watches a PR run in thirty seconds understands it better than one who reads
three screens of description, and far better than one who has to pull the branch. This skill
turns a PR into that thirty seconds: a storyboard, real footage, a few diagram scenes, one
caption per shot.

The rules that make such a video worth watching — never draw a screen you did not capture,
leave every caption on screen long enough to read, ten shots at most — are enforced by
`scripts/animatic.mjs`, not by this text. If the script rejects something, fix the
storyboard; do not work around the check.

```text
diff → worth a video? → storyboard → capture → animatic check → animatic render → look at the sheet → animatic attach
                 └─ no: say so in one line on the PR and stop
```

Run the CLI as `node <skill-dir>/scripts/animatic.mjs <command>`; below it is `animatic`.

## 1. Decide whether this PR gets a video

Make one when a reviewer would understand the change faster by seeing it:

- something on screen changed (UI, CLI output, TUI);
- a flow changed (request path, queue, state machine, data pipeline);
- a before/after is the whole point (speed, layout, error message).

Skip it for refactors with no visible change, dependency bumps, docs, config, typos. Say
"no video: <reason>" in one line instead. A video on every PR costs reviewers time instead of
saving it.

## 2. Write the storyboard

`animatic new .animatic/pr-<n>` scaffolds `storyboard.json`, `scenes/` and `captures/`.
Keep `.animatic/` in the repo's `.gitignore`.

Before any shot, write `takeaway`: the one sentence the viewer should remember. It is never
shown. Then one shot per point, and delete every shot that does not change what the viewer
knows. Fewer is better; the script stops at ten.

Shot kinds (full schema: `schema/storyboard.schema.json`, guidance: `references/storyboard.md`):

| kind | shows | needs |
|---|---|---|
| `clip` | real footage of the change running | `src` video you captured, optional `trim` |
| `image` | a real screenshot | `src` image you captured |
| `compare` | before and after side by side | `before`, `after` captures |
| `scene` | a diagram of how it works | `html` fragment using the diagram kit |

Write captions and on-screen text in English (`language` in config changes that; `check`
rejects CJK captions while it is `"en"`). Every shot has a `caption`: one short line saying what the picture means, as you would say it
to a person — not a label read aloud. `labels` put a word on the exact spot it names
(`x`, `y` from 0 to 1 over the picture). `highlight` pulses elements of a scene to point at
what changed.

Build diagram scenes around one picture that changes from shot to shot, not a new picture
each time. The kit's classes keep one meaning per colour: `.box.accent` is what this PR
changed, `.good` / `.bad` are better / worse, `.dim` is out of the picture. Never a bullet
list, a status table, or boxes with nothing connecting them.

### The document around the shots

The default style, `ark`, frames the film as a document the repository issued: the PR number
is the document number, each shot is one sheet, the header names the issuer, the footer cites
the source. Fill `pr` (`repo`, `number`) and, if the defaults don't fit, `doc` (`issuer`,
`subtitle`, `index`, `src`). Pick the dialect from who is speaking — `field` for a product
team, `terminal-dark`/`terminal-ice` for infrastructure and ops, `paper` for research, `wartime`
only for an incident — and set `brand` from the subject (the product's own colour if it has
one). One saturated colour per film; it marks what this PR changed. Status colours only as
small tags. `style: "plain"` drops the document chrome.

## 3. Capture real footage

Product UI comes only from captures of the running change. If a visible change has no
capture, do not draw it — leave it out and say on the PR what changed on screen.

- Browser: Playwright with `recordVideo`, driving the flow as a user would. If the PR
  already has an independent verifier driving it with Playwright, record that run: the
  footage is then the verification itself, not a staged demo.
- Terminal / TUI: `vhs` tape files (deterministic and re-runnable); fall back to a
  screenshot of real output.
- Before/after: capture the base branch and the PR head the same way.

Recipes: `references/capture.md`. Put files in `captures/`.

## 4. Check, render, look

```bash
animatic check .animatic/pr-42/storyboard.json     # schema, captures exist, captions fit, reading time
animatic render .animatic/pr-42/storyboard.json    # → animatic.mp4 + .animatic/verify/contact-sheet.png
```

Hold times are computed, not guessed: each shot stays fully on screen for as long as its
caption plus every on-screen word the previous shot did not show takes to read
(`readingSpeed` in config; 5 字/s and 3 words/s by default). `render` then measures the file:
its length must match the plan, and every still shot must look the same just after it settles
and just before it leaves. It fails loudly otherwise.

Open the contact sheet with your image viewer before posting. It shows one frame per shot at
the size the video plays in a PR. Check that every caption is legible, nothing covers the
picture, and nothing on screen claims more than the work did — a check you did not run is not
shown as passing, and nothing still waiting on a person is shown as done.

## 5. Post it

```bash
animatic attach .animatic/pr-42/animatic.mp4 --pr 42 [--repo owner/name] [--dry-run]
```

GitHub serves comment attachments from an anonymous URL even for private repositories, so
`attach` refuses private repos unless `.animatic.json` says otherwise (`attach.private`:
`refuse` | `release-asset` | `allow`). It also refuses files over `attach.maxMegabytes`.
When the PR is updated, re-render only if a capture or scene the storyboard uses has changed.

Reply with the comment link and one line on anything the video could not show.

## Config

`.animatic.json` at the repo root overrides any default in `scripts/lib/config.mjs`:
reading speed, caption limits, max shots, theme colours, the CJK font family, the attach
policy. Names of products and machines belong there, never in a storyboard template.
