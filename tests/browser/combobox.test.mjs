import { test } from "node:test";
import assert from "node:assert/strict";
import { skip, demoPage, invariants, rng } from "./harness.mjs";
import { initial, step } from "../models/combobox-model.mjs";
import { COUNTRIES } from "../../demo/countries.js";

const LABELS = COUNTRIES.map((c) => c.label);

/** Everything observable about a combobox, in the model's terms. */
function observe(page, id) {
  return page.evaluate((id) => {
    const input = document.getElementById(id);
    const list = document.getElementById(input.getAttribute("aria-controls"));
    const options = [...list.querySelectorAll("[role=option]")];
    const activeId = input.getAttribute("aria-activedescendant");
    const open = input.getAttribute("aria-expanded") === "true";
    return {
      value: input.value,
      caret: input.selectionStart,
      open,
      active: activeId ? options.findIndex((o) => o.id === activeId) : -1,
      // Closed lists keep their last results in the DOM; only compare them when open.
      results: open ? options.map((o) => o.textContent) : null,
      status: document.getElementById(`${id}-status`).textContent,
      problems: window.demo.checkAria(document),
    };
  }, id);
}

const comparable = ({ problems, ...s }) => ({ ...s, results: s.open ? s.results : null });

test("typing filters with highlights; Down/Up wrap; Enter accepts", { skip }, async () => {
  const page = await demoPage();
  await page.focus("#country");
  await page.keyboard.type("guin");
  let s = await observe(page, "country");
  assert.deepEqual(s.results, ["Guinea", "Guinea-Bissau", "Equatorial Guinea", "Papua New Guinea"]);
  assert.equal(s.active, -1, "no automatic selection while typing");
  assert.equal(s.status, "4 results available.");
  assert.deepEqual(await page.$$eval("#country-listbox mark", (m) => m.map((x) => x.textContent)), ["Guin", "Guin", "Guin", "Guin"]);
  for (const [key, active] of [["ArrowDown", 0], ["ArrowDown", 1], ["ArrowUp", 0], ["ArrowUp", 3], ["ArrowDown", 0]]) {
    await page.keyboard.press(key);
    assert.equal((await observe(page, "country")).active, active, key);
    await invariants(page, key);
  }
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  s = await observe(page, "country");
  assert.equal(s.value, "Papua New Guinea");
  assert.equal(s.open, false);
  assert.equal(s.status, "Papua New Guinea selected.");
  assert.equal(await page.textContent("#country-result"), "Picked Papua New Guinea (PG).");
  await page.done();
});

test("accents and apostrophes: 'cote d'iv' and 'sao tome' find their countries", { skip }, async () => {
  const page = await demoPage();
  await page.focus("#country");
  await page.keyboard.type("cote d'iv");
  assert.deepEqual((await observe(page, "country")).results, ["Côte d’Ivoire"]);
  await page.fill("#country", "");
  await page.keyboard.type("SAO TOME");
  assert.deepEqual((await observe(page, "country")).results, ["São Tomé and Príncipe"]);
  assert.equal(await page.innerHTML("#country-listbox [role=option]"), "<mark>São</mark> <mark>Tomé</mark> and Príncipe");
  await page.done();
});

test("Escape closes the list, then clears the box; no matches announces 'No results.'", { skip }, async () => {
  const page = await demoPage();
  await page.focus("#country");
  await page.keyboard.type("qq");
  let s = await observe(page, "country");
  assert.equal(s.open, false);
  assert.equal(s.status, "No results.");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("bel");
  await page.keyboard.press("Escape");
  s = await observe(page, "country");
  assert.deepEqual([s.open, s.value], [false, "bel"]);
  await page.keyboard.press("Escape");
  s = await observe(page, "country");
  assert.deepEqual([s.open, s.value, s.status], [false, "", ""]);
  await page.done();
});

test("mouse: clicking an option accepts it and keeps focus in the box; blur closes the list", { skip }, async () => {
  const page = await demoPage();
  await page.click("#country");
  await page.keyboard.type("nor");
  await page.click("#country-listbox [role=option] >> text=North Macedonia");
  assert.equal(await page.inputValue("#country"), "North Macedonia");
  assert.equal(await page.evaluate(() => document.activeElement.id), "country");
  await page.keyboard.type(" x");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("ArrowDown");
  assert.equal((await observe(page, "country")).open, true);
  await page.click("h1");
  assert.equal((await observe(page, "country")).open, false);
  await invariants(page);
  await page.done();
});

test("model-based: 400 random key sequences agree with the model at every step", { skip }, async () => {
  const page = await demoPage();
  const rand = rng(1923);
  // Letters chosen so that lists are often non-empty, plus accents, space and every special key.
  const KEYS = ["a", "n", "i", "e", "r", "o", "u", "s", "é", "ç", " ", "z",
    "Backspace", "Backspace", "ArrowDown", "ArrowDown", "ArrowUp", "Alt+ArrowDown", "Alt+ArrowUp",
    "Enter", "Escape", "Home", "End", "ArrowLeft", "ArrowRight"];
  let steps = 0;
  let maxResults = 0;
  let accepted = 0;
  for (let run = 0; run < 400; run++) {
    await page.evaluate(() => {
      const c = window.demo.comboboxes.local;
      c.input.value = "";
      c.close();
      c.input.blur();
      c.input.focus();
    });
    // Blur + refocus restores the initial state except for leftover results and status, which the model ignores when closed.
    let model = { ...initial(), status: (await observe(page, "country")).status };
    const keys = [];
    for (let i = 0; i < 25; i++) {
      const key = KEYS[Math.floor(rand() * KEYS.length)];
      keys.push(key);
      if (key.length === 1) await page.keyboard.type(key);
      else await page.keyboard.press(key);
      model = step(model, key, LABELS);
      const real = await observe(page, "country");
      assert.deepEqual(comparable(real), comparable(model), `run ${run}: ${JSON.stringify(keys)}`);
      assert.deepEqual(real.problems, [], `ARIA invariants, run ${run}: ${JSON.stringify(keys)}`);
      if (model.open) maxResults = Math.max(maxResults, model.results.length);
      if (key === "Enter" && real.status.endsWith(" selected.")) accepted++;
      steps++;
    }
  }
  assert.equal(steps, 400 * 25);
  // The sequences actually reach the interesting states.
  assert.ok(maxResults > 50, `largest list ${maxResults}`);
  assert.ok(accepted > 20, `only ${accepted} accepts`);
  console.log(`# combobox model: ${steps} steps, ${accepted} Enter-accepts, largest list ${maxResults}`);
  await page.done();
});

// ---- the async (server) combobox

// 40 ms between keys: faster than the 200 ms debounce, slow enough that the
// browser runs its timers between key presses, as with a real typist.
async function typeRemote(page, text) {
  await page.focus("#remote");
  await page.keyboard.type(text, { delay: 40 });
}

test("server search: debounced; one request for a burst of typing", { skip }, async () => {
  const page = await demoPage();
  await page.evaluate(() => { window.demo.server.latency = () => 50; });
  await typeRemote(page, "germ");
  await page.waitForFunction(() => document.getElementById("remote").getAttribute("aria-expanded") === "true");
  assert.equal(await page.evaluate(() => window.demo.server.calls), 1);
  assert.deepEqual((await observe(page, "remote")).results, ["Germany"]);
  await invariants(page);
  await page.done();
});

test("server search: a slow old response never overwrites a newer one", { skip }, async () => {
  const page = await demoPage();
  // "a" is answered after 900 ms, "al" after 50 ms. A naive client would show "a"'s results last.
  // The fake server ignores abort here, so this tests the sequence-number guard, not just abort.
  await page.evaluate(() => {
    const s = window.demo.server;
    s.latency = (q) => (q === "a" ? 900 : 50);
    const original = s.search;
    s.search = (q) => original(q, { signal: new AbortController().signal });
  });
  await typeRemote(page, "a");
  await page.waitForTimeout(300); // past the 200 ms debounce: the "a" request is in flight
  await page.keyboard.type("l");
  await page.waitForTimeout(1200); // both responses have arrived
  const s = await observe(page, "remote");
  assert.equal(s.value, "al");
  assert.ok(s.results.length > 0);
  assert.ok(s.results.every((r) => /al/i.test(r.normalize("NFD").replace(/\p{M}/gu, ""))), JSON.stringify(s.results));
  assert.equal(s.status, `${s.results.length} results available.`);
  assert.equal(await page.evaluate(() => window.demo.server.calls), 2);
  await page.done();
});

test("server search: superseded requests are aborted", { skip }, async () => {
  const page = await demoPage();
  await page.evaluate(() => {
    const s = window.demo.server;
    s.latency = () => 400;
    s.aborted = 0;
    const original = s.search;
    s.search = (q, ctx) => { ctx.signal.addEventListener("abort", () => s.aborted++); return original(q, ctx); };
  });
  await typeRemote(page, "f");
  await page.waitForTimeout(250);
  await page.keyboard.type("r");
  await page.waitForTimeout(250);
  await page.keyboard.type("a");
  await page.waitForFunction(() => document.getElementById("remote").getAttribute("aria-expanded") === "true");
  assert.deepEqual(await page.evaluate(() => [window.demo.server.calls, window.demo.server.aborted]), [3, 2]);
  assert.deepEqual((await observe(page, "remote")).results, ["France"]);
  await page.done();
});

test("server search: Escape while loading clears the box and cancels the search", { skip }, async () => {
  const page = await demoPage();
  await page.evaluate(() => { window.demo.server.latency = () => 300; });
  await typeRemote(page, "peru");
  await page.waitForFunction(() => window.demo.server.calls === 1); // sent; the answer is due in 300 ms
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  const s = await observe(page, "remote");
  // The list wasn't open yet, so Escape means "clear"; the late answer must not reopen anything.
  assert.deepEqual([s.open, s.value, await page.evaluate(() => document.activeElement.id)], [false, "", "remote"]);
  await invariants(page);
  await page.done();
});

test("server search: errors are announced and the list stays closed; leaving the box cancels", { skip }, async () => {
  const page = await demoPage();
  await page.evaluate(() => { window.demo.server.latency = () => 50; window.demo.server.fail = true; });
  await typeRemote(page, "ita");
  await page.waitForFunction(() => document.querySelector("#remote").closest(".combobox").dataset.state === "error");
  const s = await observe(page, "remote");
  assert.equal(s.open, false);
  assert.equal(s.status, "Couldn't load results. Keep typing to try again.");
  // Recovers once the server does.
  await page.evaluate(() => { window.demo.server.fail = false; window.demo.server.latency = () => 300; });
  await page.keyboard.type("l");
  await page.waitForFunction(() => document.getElementById("remote").getAttribute("aria-expanded") === "true");
  assert.deepEqual((await observe(page, "remote")).results, ["Italy"]);
  // A response that arrives after the user has left must not pop the list open,
  // even from a server that ignores the abort signal.
  await page.evaluate(() => {
    const s = window.demo.server;
    const original = s.search;
    s.search = (q) => original(q, { signal: new AbortController().signal });
  });
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(250); // request sent, answer due in 300 ms
  await page.click("h1");
  await page.waitForTimeout(500);
  assert.equal((await observe(page, "remote")).open, false);
  await invariants(page);
  await page.done();
});
