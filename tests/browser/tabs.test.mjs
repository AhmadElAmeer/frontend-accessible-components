import { test } from "node:test";
import assert from "node:assert/strict";
import { skip, demoPage, invariants, rng } from "./harness.mjs";
import { makeTabsModel } from "../models/tabs-model.mjs";

const TABLISTS = {
  "tabs-auto": { n: 4, disabled: new Set([3]), manual: false, vertical: false, rtl: false },
  "tabs-manual": { n: 3, disabled: new Set(), manual: true, vertical: true, rtl: false },
  "tabs-rtl": { n: 3, disabled: new Set(), manual: false, vertical: false, rtl: true },
};

/** Index of the focused tab and of the selected tab in one tab list. */
function tabState(page, id) {
  return page.evaluate((id) => {
    const tabs = [...document.querySelectorAll(`#${id} [role=tab]`)];
    return {
      focus: tabs.indexOf(document.activeElement),
      selected: tabs.findIndex((t) => t.getAttribute("aria-selected") === "true"),
      visiblePanels: [...document.querySelectorAll(`#${id} [role=tabpanel]`)].filter((p) => !p.hidden).length,
    };
  }, id);
}

async function focusSelectedTab(page, id) {
  await page.focus(`#${id} [role=tab][aria-selected=true]`);
}

test("automatic tabs: arrows select and wrap, the disabled tab is skipped, Home/End", { skip }, async () => {
  const page = await demoPage();
  await focusSelectedTab(page, "tabs-auto");
  const seen = [];
  for (const key of ["ArrowRight", "ArrowRight", "ArrowRight", "ArrowLeft", "End", "Home", "ArrowLeft"]) {
    await page.keyboard.press(key);
    const s = await tabState(page, "tabs-auto");
    assert.equal(s.focus, s.selected, "selection follows focus");
    assert.equal(s.visiblePanels, 1);
    seen.push(s.selected);
    await invariants(page, `after ${key}`);
  }
  // 0 → 1 → 2 → (3 disabled) 0 → 2 ← … End stops at 2 (last enabled), Home 0, Left wraps to 2.
  assert.deepEqual(seen, [1, 2, 0, 2, 2, 0, 2]);
  await page.done();
});

test("manual tabs: arrows only move focus; Enter and Space select; vertical uses Up/Down", { skip }, async () => {
  const page = await demoPage();
  await focusSelectedTab(page, "tabs-manual");
  await page.keyboard.press("ArrowDown");
  assert.deepEqual(await tabState(page, "tabs-manual"), { focus: 1, selected: 0, visiblePanels: 1 });
  await page.keyboard.press("ArrowRight"); // the cross axis does nothing
  assert.deepEqual(await tabState(page, "tabs-manual"), { focus: 1, selected: 0, visiblePanels: 1 });
  await page.keyboard.press("Enter");
  assert.deepEqual(await tabState(page, "tabs-manual"), { focus: 1, selected: 1, visiblePanels: 1 });
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp"); // wraps to the last tab
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.keyboard.press(" ");
  assert.deepEqual(await tabState(page, "tabs-manual"), { focus: 2, selected: 2, visiblePanels: 1 });
  assert.equal(await page.evaluate(() => window.scrollY), scrollBefore, "Space on a tab must not scroll the page");
  await invariants(page);
  await page.done();
});

test("right-to-left: Left moves forward, Right moves back", { skip }, async () => {
  const page = await demoPage();
  await focusSelectedTab(page, "tabs-rtl");
  await page.keyboard.press("ArrowLeft");
  assert.equal((await tabState(page, "tabs-rtl")).selected, 1);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  assert.equal((await tabState(page, "tabs-rtl")).selected, 2);
  await page.done();
});

test("a tab list is one Tab stop, and Tab goes from the tab to its panel", { skip }, async () => {
  const page = await demoPage();
  await focusSelectedTab(page, "tabs-auto");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Tab");
  const panel = await page.evaluate(() => [document.activeElement.getAttribute("role"), document.activeElement.getAttribute("aria-labelledby")]);
  const tabId = await page.getAttribute("#tabs-auto [role=tab][aria-selected=true]", "id");
  assert.deepEqual(panel, ["tabpanel", tabId]);
  // Walking the whole page with Tab, from the skip link to the footer link:
  // each tab list contributes exactly one stop.
  await page.focus(".skip-link");
  const stops = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    const [role, text] = await page.evaluate(() => [document.activeElement.getAttribute("role"), document.activeElement.textContent]);
    if (role === "tab") stops.push(await page.evaluate(() => document.activeElement.closest("[data-tabs]").id));
    if (text === "GitHub") break;
  }
  assert.deepEqual(stops, ["tabs-auto", "tabs-manual", "tabs-rtl"]);
  await page.done();
});

test("clicking: selects enabled tabs, ignores the disabled one", { skip }, async () => {
  const page = await demoPage();
  await page.click("#tabs-auto [role=tab] >> text=Install");
  assert.equal((await tabState(page, "tabs-auto")).selected, 2);
  await page.click("#tabs-auto [role=tab] >> text=Roadmap", { force: true }); // force: Playwright won't click aria-disabled
  assert.equal((await tabState(page, "tabs-auto")).selected, 2);
  assert.equal(await page.getAttribute("#tabs-auto [role=tab] >> text=Roadmap", "aria-disabled"), "true");
  await page.done();
});

test("without JavaScript every section and heading is readable", { skip }, async () => {
  const page = await demoPage({ javaScriptEnabled: false });
  const sections = await page.$$eval("[data-tabs] > section", (els) => els.map((s) => ({
    visible: s.getClientRects().length > 0 && !s.hidden,
    heading: s.querySelector("h4")?.textContent.trim(),
  })));
  assert.equal(sections.length, 10);
  assert.ok(sections.every((s) => s.visible && s.heading), JSON.stringify(sections));
  assert.equal(await page.$$eval("[role=tab]", (t) => t.length), 0);
  await page.done();
});

test("model-based: 150 random key sequences per tab list agree with the APG model", { skip }, async () => {
  const page = await demoPage();
  const rand = rng(2026);
  const KEYS = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End", "Enter", " "];
  let steps = 0;
  for (const [id, cfg] of Object.entries(TABLISTS)) {
    const model = makeTabsModel(cfg);
    for (let run = 0; run < 150; run++) {
      // Reset: select the first tab, then put focus on it.
      await page.evaluate((id) => {
        const tabs = window.demo.tabs.find((t) => t.root.id === id);
        tabs.select(0, { focus: true });
      }, id);
      let state = { focus: 0, selected: 0 };
      const keys = [];
      for (let i = 0; i < 12; i++) {
        const key = KEYS[Math.floor(rand() * KEYS.length)];
        keys.push(key);
        await page.keyboard.press(key);
        state = model(state, key);
        const real = await tabState(page, id);
        assert.deepEqual({ focus: real.focus, selected: real.selected }, state, `${id}: ${keys.join(" ")}`);
        await invariants(page, `${id}: ${keys.join(" ")}`);
        steps++;
      }
    }
  }
  assert.equal(steps, 3 * 150 * 12);
  await page.done();
});

