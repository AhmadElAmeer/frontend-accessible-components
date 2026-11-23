// Capture the README screenshots from the demo page.
//   node scripts/screenshots.mjs
import { createRequire } from "node:module";
import { serve } from "../tests/serve.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const server = await serve();
const browser = await chromium.launch();

/** An element's box in page (document) coordinates. */
function docBox(page, selector) {
  return page.$eval(selector, (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + window.scrollX, y: r.y + window.scrollY, width: r.width, height: r.height };
  });
}

async function shot(name, { scheme = "light", width = 900, height = 640 } = {}, act) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: scheme });
  await page.goto(server.url);
  await page.waitForFunction(() => window.demo);
  const clip = await act(page);
  await page.waitForTimeout(300); // let opening animations finish
  // A clip is in page coordinates; without one, the viewport (where fixed overlays are) is captured.
  await page.screenshot({ path: `docs/${name}.png`, ...(clip ? { clip, fullPage: true } : {}) });
  await page.close();
  console.log(`wrote docs/${name}.png`);
}

// Combobox: accent-insensitive matching with highlights, second option active.
await shot("combobox", {}, async (page) => {
  await page.focus("#country");
  await page.keyboard.type("gu");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  const box = await docBox(page, "section[aria-labelledby=h-combobox]");
  return { x: box.x - 16, y: box.y - 16, width: box.width + 32, height: 430 };
});

// Nested dialogs in dark mode: the confirmation on top of the edit form.
await shot("dialogs-dark", { scheme: "dark" }, async (page) => {
  await page.click('[data-opens="dialog-profile"]');
  await page.keyboard.press("End");
  await page.keyboard.type(" K.");
  await page.keyboard.press("Escape");
  return null;
});

// The three tab lists, with the live ARIA check in the header.
await shot("tabs", { height: 1000 }, async (page) => {
  await page.focus("#tabs-auto [role=tab][aria-selected=true]");
  await page.keyboard.press("ArrowRight");
  await page.focus("#tabs-rtl [role=tab][aria-selected=true]");
  await page.keyboard.press("ArrowLeft");
  await page.focus("#tabs-auto [role=tab][aria-selected=true]");
  await page.keyboard.up("Shift"); // a keyup refreshes the header's live check
  const tabs = await docBox(page, "section[aria-labelledby=h-tabs]");
  const check = await docBox(page, "#checker");
  return { x: tabs.x - 16, y: check.y - 12, width: tabs.width + 32, height: tabs.y + tabs.height - check.y + 28 };
});

await browser.close();
server.close();
