// Planted-bug check: apply one bug at a time, run the tests that should catch
// it, and report whether they failed. The source is restored after each run.
//   node scripts/mutants.mjs            all mutants
//   node scripts/mutants.mjs 3 7        only mutants 3 and 7
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const U = "tests/unit/filter.test.mjs";
const T = "tests/browser/tabs.test.mjs";
const D = "tests/browser/dialog.test.mjs";
const C = "tests/browser/combobox.test.mjs";
const A = "tests/browser/a11y.test.mjs";

const MUTANTS = [
  // tabs
  ["tabs: arrows not reversed in RTL", "src/tabs.js", 'const rtl = getComputedStyle(this.tablist).direction === "rtl";', "const rtl = false;", [T]],
  ["tabs: no wrap-around", "src/tabs.js", "const i = (((from + step * k) % n) + n) % n;", "const i = Math.min(n - 1, Math.max(0, from + step * k));", [T]],
  ["tabs: disabled tabs not skipped", "src/tabs.js", 'return i >= 0 && i < this.tabs.length && this.tabs[i].getAttribute("aria-disabled") !== "true";', "return i >= 0 && i < this.tabs.length;", [T]],
  ["tabs: every tab is a Tab stop", "src/tabs.js", "tab.tabIndex = on ? 0 : -1;", "tab.tabIndex = 0;", [T]],
  ["tabs: manual mode selects on arrows", "src/tabs.js", 'if (this.activation === "automatic") this.select(target);', "this.select(target);", [T]],
  ["tabs: End ignores disabled last tab", "src/tabs.js", 'else if (e.key === "End") target = this.#step(this.tabs.length, -1);', 'else if (e.key === "End") target = this.tabs.length - 1;', [T]],
  ["tabs: panel not focusable", "src/tabs.js", "section.tabIndex = 0;", "", [T]],
  // dialog
  ["dialog: page behind not inert", "src/dialog.js", "        child.inert = true;\n", "", [D]],
  ["dialog: focus not returned to the opener", "src/dialog.js", "if (back && back.isConnected && !back.closest(\"[inert]\")) focusElement(back);", "if (false) focusElement(back);", [D]],
  ["dialog: Shift+Tab doesn't wrap", "src/dialog.js", "      if (e.shiftKey && (active === first", "      if (false && (active === first", [D]],
  ["dialog: cancel event ignored", "src/dialog.js", "if (this.el.dispatchEvent(cancel)) this.close(\"escape\");", "this.el.dispatchEvent(cancel); this.close(\"escape\");", [D]],
  ["dialog: nested dialog left inert (the bug the checker found)", "src/dialog.js", "    this.backdrop.inert = false;\n    stack.push(this);", "    stack.push(this);", [D]],
  ["dialog: scroll lock never released", "src/dialog.js", "  root.style.overflow = saved.overflow;", "", [D]],
  ["dialog: data-autofocus ignored", "src/dialog.js", 'const target = this.el.querySelector("[data-autofocus]") ?? tabbables(this.el)[0];', "const target = tabbables(this.el)[0];", [D]],
  ["dialog: focus left in a hidden dialog when the opener is gone", "src/dialog.js", "      else document.activeElement.blur();", "", [D]],
  // combobox
  ["combobox: aria-activedescendant not set", "src/combobox.js", '      this.input.setAttribute("aria-activedescendant", next.id);', "", [C]],
  ["combobox: Down doesn't wrap", "src/combobox.js", ": (from + step + n) % n;", ": Math.min(n - 1, Math.max(0, from + step));", [C]],
  ["combobox: first option auto-activated while typing", "src/combobox.js", 'this.#activate(activate === "first" ? 0 : activate === "last" ? n - 1 : -1);', 'this.#activate(activate === "last" ? n - 1 : 0);', [C]],
  ["combobox: Escape on a closed list doesn't clear", "src/combobox.js", '        } else if (this.input.value !== "") {', "        } else if (false) {", [C]],
  ["combobox: stale responses not ignored", "src/combobox.js", "        if (seq !== this.request) return;\n        this.#setResults", "        this.#setResults", [C]],
  ["combobox: superseded requests not aborted", "src/combobox.js", "    clearTimeout(this.timer);\n    this.controller?.abort();\n    this.controller = null;\n\n    if (!this.async)", "    clearTimeout(this.timer);\n\n    if (!this.async)", [C]],
  ["combobox: no debounce", "src/combobox.js", "this.delay = options.delay ?? (this.async ? 200 : 0);", "this.delay = 0;", [C]],
  ["combobox: wrong result count announced", "src/combobox.js", "`${n} results available.`", "`${n - 1} results available.`", [C]],
  ["combobox: Enter on an option submits the form", "src/combobox.js", "          e.preventDefault(); // don't submit the form when picking an option\n", "", [D]],
  ["combobox: mousedown steals focus", "src/combobox.js", '    this.listbox.addEventListener("mousedown", (e) => e.preventDefault());', "", [C]],
  ["combobox: blur doesn't close", "src/combobox.js", '    input.addEventListener("blur", () => this.close());', "", [C]],
  ["combobox: close doesn't invalidate in-flight search", "src/combobox.js", "    clearTimeout(this.timer);\n    this.request++;", "    clearTimeout(this.timer);", [C]],
  // filter
  ["filter: accents not folded", "src/filter.js", '.replace(MARKS, "")', "", [U, C]],
  ["filter: highlight ranges in folded positions", "src/filter.js", "found.push([origin[at], origin[at + word.length]]);", "found.push([at, at + word.length]);", [U, C]],
  ["filter: results not ranked", "src/filter.js", "return hits.sort((a, b) => a.score - b.score);", "return hits;", [U, C]],
  ["filter: inside-word occurrence preferred", "src/filter.js", "      if (at === -1 || !isWordChar(text[at - 1])) break;", "      break;", [U, C]],
  // styles
  ["css: focus outline removed", "styles.css", "  outline: 3px solid var(--focus);", "  outline: none;", [A]],
  ["css: low-contrast muted text", "styles.css", "  --muted: #55565c;", "  --muted: #8f9096;", [A]],
  ["css: dark-mode accent too dark", "styles.css", "    --accent: #8ab4f8;", "    --accent: #2f5aa8;", [A]],
  ["css: animation ignores reduced motion", "styles.css", "@media (prefers-reduced-motion: no-preference) {\n  .dialog-backdrop", "@media all {\n  .dialog-backdrop", [A]],
  ["css: vertical tabs overflow on phones", "styles.css", "  .tabs--vertical { grid-template-columns: 1fr; }", "  .tabs--vertical { grid-template-columns: 1fr; min-width: 400px; }", [A]],
];

// Check every pattern first, so a stale mutant fails before an hour of test runs.
for (const [i, [name, file, from]] of MUTANTS.entries()) {
  const count = readFileSync(file, "utf8").split(from).length - 1;
  if (count !== 1) throw new Error(`mutant ${i + 1} (${name}): pattern found ${count} times in ${file}`);
}

const only = process.argv.slice(2).map(Number);
let caught = 0;
let ran = 0;
for (const [i, [name, file, from, to, tests]] of MUTANTS.entries()) {
  if (only.length && !only.includes(i + 1)) continue;
  const original = readFileSync(file, "utf8");
  const count = original.split(from).length - 1;
  if (count !== 1) throw new Error(`mutant ${i + 1} (${name}): pattern found ${count} times in ${file}`);
  writeFileSync(file, original.replace(from, to));
  try {
    const t0 = Date.now();
    const r = spawnSync("node", ["--test", "--test-concurrency=1", ...tests], { encoding: "utf8" });
    const failed = r.status !== 0;
    const names = [...r.stdout.matchAll(/^not ok \d+ - (.*)$/gm)].map((m) => m[1]);
    ran++;
    if (failed) caught++;
    console.log(`${String(i + 1).padStart(2)}. ${failed ? "CAUGHT " : "MISSED "} ${name} (${((Date.now() - t0) / 1000).toFixed(0)} s)` +
      (failed ? `\n      by: ${names.slice(0, 3).join(" | ") || r.stderr.split("\n")[0]}` : ""));
  } finally {
    writeFileSync(file, original);
  }
}
console.log(`\n${caught}/${ran} planted bugs caught`);
