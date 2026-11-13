# Writing a storyboard

## The two notes that come first

1. `takeaway` — what the viewer remembers. "Search is fast again because the missing index
   is back", not "Search improvements".
2. One line per shot, in your head or in the shot's `id`: what this shot adds. If you cannot
   say, delete the shot.

## Shots

- One point per shot.
- Keep the same picture across shots and change it: add a box, light up the part this PR
  changed, swap red for green. A viewer follows one picture changing much more easily than a
  series of new ones.
- Show results honestly: done, still running, failed, not checked. Something waiting on a
  person is never drawn as done. Show bugs found and fixed along the way.
- Draw only from facts you have. Never invent a number. Never draw a UI you did not capture.

## Captions

- About ten words or under twenty-four 字. The script rejects longer ones.
- Say what the picture means, as you would say it to a person. "搜索又快了，因为索引回来了",
  not "搜索：通过".
- Say each fact once. If the picture already shows it, the caption does not repeat it.
- Captions sit in a fixed bar under the picture and never cover it.

## Labels and highlights

- `labels: [{ "text": "新按钮", "x": 0.72, "y": 0.18 }]` — `x`, `y` are fractions of the
  picture area. Put the label on the thing; a label off to the side is a legend, and legends
  make viewers look twice.
- `highlight: [".go"]` — CSS selectors inside a scene that pulse once after it settles.

## Diagram kit (scenes)

A scene is an HTML fragment rendered in the picture area (1728×660 in `ark`, 1920×952 in `plain`). Use the kit so every film speaks
the same visual language:

```html
<div class="row">
  <div class="box">队列<small>一次一个</small></div>
  <div class="arrow accent">→</div>
  <div class="box accent go">并行派发<small>这个 PR 加的</small></div>
</div>
```

| class | meaning |
|---|---|
| `.row` / `.col` | lay boxes out left-to-right / top-to-bottom |
| `.box` | a thing in the system |
| `.box.accent`, `.arrow.accent` | what this PR changed |
| `.box.good` / `.box.bad` | better / worse |
| `.box.dim` | present but not the point |
| `.note` | a quiet aside |
| `.big` | one number or word that is the whole point |

At most six boxes per scene, at most eight words per box. Anything that needs a sentence
belongs in the caption or nowhere.

## Timing

You do not set durations. The script holds each shot for as long as its new text takes to read
(caption + on-screen words the previous shot lacked), at least 1.6 s. A clip plays for its
trimmed length; if that is shorter than its text needs, the script refuses — shorten the
caption or keep more of the clip. `hold` can lengthen a shot, never shorten it below that.
