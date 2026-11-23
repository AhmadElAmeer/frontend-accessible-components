// Checks beyond keyboard behaviour: colour contrast (WCAG 1.4.3 / 1.4.11) in
// light and dark mode, visible focus on every control, reduced motion, small
// screens, and an axe-core scan when axe-core is installed (it is in CI).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { skip, demoPage } from "./harness.mjs";

// Runs in the page: contrast of every visible text node against its effective background.
function contrastProblems() {
  function parse(c) {
    let m = c.match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/);
    if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
    m = c.match(/^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.e-]+))?\)$/);
    if (m) return [m[1] * 255, m[2] * 255, m[3] * 255, m[4] === undefined ? 1 : +m[4]];
    throw new Error(`can't parse colour ${c}`);
  }
  const over = (top, under) => {
    const a = top[3];
    return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1);
  };
  // Composite every ancestor background from the root down.
  function background(el) {
    const chain = [];
    for (let e = el; e; e = e.parentElement) chain.push(e);
    let bg = [255, 255, 255, 1];
    for (const e of chain.reverse()) bg = over(parse(getComputedStyle(e).backgroundColor), bg);
    return bg;
  }
  const lum = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

  const problems = [];
  let checked = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!n.textContent.trim() || !el || el.closest("[hidden], .visually-hidden, script")) continue;
    if (el.getClientRects().length === 0) continue;
    if (el.closest("[aria-disabled=true]")) continue; // WCAG exempts inactive components
    const style = getComputedStyle(el);
    const fg = over(parse(style.color), background(el));
    const r = ratio(fg, background(el));
    const size = parseFloat(style.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
    checked++;
    if (r < (large ? 3 : 4.5)) problems.push(`${r.toFixed(2)}:1 for "${n.textContent.trim().slice(0, 30)}" (<${el.localName}.${el.className}>)`);
  }
  // Focus outlines and control borders are non-text contrast (3:1).
  const focus = document.activeElement;
  if (focus && focus !== document.body) {
    const s = getComputedStyle(focus);
    if (s.outlineStyle !== "none") {
      const r = ratio(over(parse(s.outlineColor), background(focus.parentElement)), background(focus.parentElement));
      if (r < 3) problems.push(`focus outline ${r.toFixed(2)}:1 on ${focus.localName}`);
    }
  }
  return { problems, checked };
}

async function stateTour(page, check) {
  await check("initial");
  await page.focus("#country");
  await page.keyboard.type("an");
  await page.keyboard.press("ArrowDown");
  await check("listbox open with an active option");
  await page.keyboard.press("Escape");
  await page.focus('[data-opens="dialog-delete"]');
  await page.keyboard.press("Enter");
  await check("dialog open");
  await page.keyboard.press("Escape");
}

for (const scheme of ["light", "dark"]) {
  test(`contrast: text 4.5:1 (3:1 large) and focus outline 3:1, ${scheme} mode`, { skip }, async () => {
    const page = await demoPage({ colorScheme: scheme });
    let total = 0;
    await stateTour(page, async (where) => {
      const { problems, checked } = await page.evaluate(contrastProblems);
      assert.deepEqual(problems, [], `${scheme}, ${where}`);
      total += checked;
    });
    assert.ok(total > 100, `only ${total} text nodes checked`);
    await page.done();
  });
}

test("every control shows a visible focus indicator when reached with Tab", { skip }, async () => {
  const page = await demoPage();
  await page.focus(".skip-link");
  const seen = [];
  for (let i = 0; i < 30; i++) {
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      const s = getComputedStyle(el);
      return { what: `${el.localName} ${el.textContent.trim().slice(0, 20) || el.id}`, style: s.outlineStyle, width: parseFloat(s.outlineWidth), visible: el.matches(":focus-visible") };
    });
    assert.ok(info.visible && info.style !== "none" && info.width >= 2, JSON.stringify(info));
    seen.push(info.what);
    if (info.what.startsWith("a GitHub")) break;
    await page.keyboard.press("Tab");
  }
  assert.ok(seen.length >= 12, seen.join(", "));
  await page.done();
});

test("reduced motion: no animations when the user asks for none", { skip }, async () => {
  for (const reducedMotion of ["no-preference", "reduce"]) {
    const page = await demoPage({ reducedMotion });
    await page.click('[data-opens="dialog-delete"]');
    const animations = await page.evaluate(() => document.getElementById("dialog-delete").getAnimations().length);
    assert.equal(animations, reducedMotion === "reduce" ? 0 : 1, reducedMotion);
    await page.done();
  }
});

test("small screens: no horizontal scrolling at 320 px, dialogs fit", { skip }, async () => {
  const page = await demoPage({ viewport: { width: 320, height: 640 } });
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.equal(await overflow(), 0);
  await page.click('[data-opens="dialog-profile"]');
  const box = await page.locator("#dialog-profile").boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 320, JSON.stringify(box));
  await page.done();
});

// ---- axe-core, when available (CI installs it and sets REQUIRE_AXE=1).
let axeSource = null;
try {
  axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
} catch {
  if (process.env.REQUIRE_AXE) throw new Error("axe-core is required (REQUIRE_AXE is set)");
}

test("axe-core finds no violations, in several states and both colour schemes", { skip: skip || (!axeSource && "axe-core not installed") }, async () => {
  for (const scheme of ["light", "dark"]) {
    const page = await demoPage({ colorScheme: scheme });
    await page.addScriptTag({ content: axeSource });
    await stateTour(page, async (where) => {
      const result = await page.evaluate(() => window.axe.run(document, { resultTypes: ["violations"] }));
      const found = result.violations.map((v) => `${v.id} (${v.nodes.length}): ${v.help}`);
      assert.deepEqual(found, [], `${scheme}, ${where}`);
      console.log(`# axe ${scheme}, ${where}: 0 violations, ${result.passes.length} rules passed`);
    });
    await page.done();
  }
});
