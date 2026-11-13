# Capturing real footage

Everything a viewer sees of the product comes from these. Capture at 1920×1080 (or the same
aspect) so footage fills the picture without bars.

## Browser (Playwright)

```js
// capture.mjs — run with: node capture.mjs <base-url> <out-dir>
import { chromium } from "playwright";
const [url, out] = process.argv.slice(2);
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  recordVideo: { dir: out, size: { width: 1920, height: 1080 } },
});
const page = await context.newPage();
await page.goto(url);
await page.waitForLoadState("networkidle");
await page.waitForTimeout(600);          // let the viewer see the starting state
await page.getByRole("button", { name: "Send" }).click();
await page.waitForTimeout(1500);         // and the result
await context.close();                   // the video is written on close
await browser.close();
```

- Move as a person would: pause before and after each action. Footage that races through
  cannot be read, and the script will refuse clips shorter than their captions need.
- Record base and head the same way for a `compare` shot.
- Recordings come out as `.webm`; animatic accepts them as they are. Use `trim` to cut the
  blank start.
- If the PR's verifier already drives the change with Playwright, add `recordVideo` there
  instead of writing a second script.

## Terminal and TUI (vhs)

```tape
# demo.tape — run with: vhs demo.tape
Output captures/cli.mp4
Set Width 1920
Set Height 1080
Set FontSize 30
Set TypingSpeed 40ms
Type "mytool sync --dry-run"
Sleep 400ms
Enter
Sleep 2.5s
```

Tapes are re-runnable, so the footage can be regenerated when the PR changes. Without vhs,
take a screenshot of real output (any terminal) and use an `image` shot.

## Screenshots

`image` shots take PNG/JPEG/WebP. A screenshot of real output counts as a capture; a mock-up
does not.
