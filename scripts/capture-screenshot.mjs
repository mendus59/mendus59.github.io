#!/usr/bin/env node
// Takes a screenshot of a project's live site for its README and its card on https://mendus59.github.io.
// Run by each project repo's "Screenshot" workflow (through .github/workflows/project-screenshot.yml).
//
//   node capture-screenshot.mjs --url https://mendus59.github.io/App/ --out docs/screenshot.jpg
//     [--width 1280] [--height 800] [--wait 3000] [--prepare "document.querySelector('#play').click()"]
//     [--threshold 0.02]
//
// The picture is a 1280x800 JPEG of the first screen. If a screenshot is already at --out and less than
// --threshold of its pixels changed noticeably, the old file is kept, so small differences (a clock, an
// animation frame) don't add a new image to the repo's history. Writes changed=true|false to
// $GITHUB_OUTPUT. Needs playwright (or playwright-core with the runner's Chrome).

import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";

const { values: opt } = parseArgs({
  options: {
    url: { type: "string" },
    out: { type: "string", default: "docs/screenshot.jpg" },
    width: { type: "string", default: "1280" },
    height: { type: "string", default: "800" },
    wait: { type: "string", default: "3000" },
    prepare: { type: "string", default: "" },
    threshold: { type: "string", default: "0.02" },
    chrome: { type: "boolean", default: false }, // use the installed Chrome (GitHub runners have one)
  },
});
if (!opt.url) throw new Error("--url is required");

let pw;
try {
  pw = await import("playwright");
} catch {
  pw = await import("playwright-core");
}
const browser = await pw.chromium.launch(opt.chrome ? { channel: "chrome" } : {});
const context = await browser.newContext({
  viewport: { width: +opt.width, height: +opt.height },
  deviceScaleFactor: 1,
  colorScheme: "light",
  reducedMotion: "reduce",
});
const page = await context.newPage();
await page.goto(opt.url, { waitUntil: "load", timeout: 60000 });
await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
if (opt.prepare) {
  await page.evaluate(opt.prepare).catch((err) => console.warn(`--prepare failed: ${err.message}`));
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
}
await page.waitForTimeout(+opt.wait);
const shot = await page.screenshot({ type: "jpeg", quality: 80 });

// Share of pixels that differ noticeably from the screenshot already there (1 if there is none).
const old = await readFile(opt.out).catch(() => null);
let diff = 1;
if (old) {
  diff = await page.evaluate(
    async ([a, b]) => {
      const load = (b64) =>
        new Promise((ok, fail) => {
          const img = new Image();
          img.onload = () => ok(img);
          img.onerror = fail;
          img.src = `data:image/jpeg;base64,${b64}`;
        });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      if (ia.width !== ib.width || ia.height !== ib.height) return 1;
      const px = (img) => {
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext("2d");
        g.drawImage(img, 0, 0);
        return g.getImageData(0, 0, img.width, img.height).data;
      };
      const [da, db] = [px(ia), px(ib)];
      let changed = 0;
      for (let i = 0; i < da.length; i += 4) {
        if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 48) changed++;
      }
      return changed / (da.length / 4);
    },
    [old.toString("base64"), shot.toString("base64")],
  ).catch(() => 1);
}
await browser.close();

const changed = diff >= +opt.threshold;
if (changed) {
  await mkdir(dirname(opt.out), { recursive: true });
  await writeFile(opt.out, shot);
}
const msg = old
  ? `${(diff * 100).toFixed(1)}% of pixels changed: ${changed ? "saved the new screenshot" : "kept the current one"}`
  : "saved the first screenshot";
console.log(`${opt.url} -> ${opt.out}: ${msg}`);
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `Screenshot of ${opt.url}: ${msg}\n`);
