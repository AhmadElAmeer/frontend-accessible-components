// Shared setup for the browser tests: a static server, one Chromium, and a
// page factory that fails the test on any console error.
import { before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { serve } from "../serve.mjs";

let chromium = null;
try {
  ({ chromium } = createRequire(import.meta.url)("playwright"));
} catch {
  if (process.env.REQUIRE_BROWSER) throw new Error("playwright is required (REQUIRE_BROWSER is set)");
}
export const skip = !chromium && "playwright not installed";

let server;
let browser;
before(async () => {
  if (!chromium) return;
  server = await serve();
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  server?.close();
});

export function url(path = "") {
  return server.url + path;
}

/** A fresh page on the demo, with console errors collected. */
export async function demoPage(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1000, height: 800 }, ...options });
  const page = await context.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && page.errors.push(m.text()));
  await page.goto(url());
  if (options.javaScriptEnabled !== false) await page.waitForFunction(() => window.demo);
  page.done = async () => {
    assert.deepEqual(page.errors, [], "console errors");
    await context.close();
  };
  return page;
}

export function newContext(options) {
  return browser.newContext(options);
}

/** Assert the ARIA invariants hold right now. */
export async function invariants(page, where = "") {
  const problems = await page.evaluate(() => window.demo.checkAria(document));
  assert.deepEqual(problems, [], `ARIA invariants ${where}`);
}

/** Description of the focused element, for readable assertions. */
export function focused(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    return el?.id || el?.textContent.trim() || el?.localName;
  });
}

/** Seeded random numbers, so a failing random sequence can be replayed. */
export function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
