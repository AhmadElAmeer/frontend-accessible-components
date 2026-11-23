// A pure, DOM-free model of the combobox's keyboard behaviour: the spec the
// browser test compares the real component against after every key press.
// It shares only the matching function (unit-tested on its own) with the
// implementation; the interaction rules are written out again here, from the
// table in src/combobox.js, as a reducer over plain data.

import { filterItems } from "../../src/filter.js";

export function initial() {
  return { value: "", caret: 0, open: false, active: -1, results: [], status: "" };
}

function statusFor(value, n) {
  if (value.trim() === "" && n === 0) return "";
  if (n === 0) return "No results.";
  return n === 1 ? "1 result available." : `${n} results available.`;
}

function search(s, labels, { open, activate }) {
  if (s.value.trim() === "" && activate === null) {
    return { ...s, results: [], open: false, active: -1, status: statusFor(s.value, 0) };
  }
  const results = filterItems(s.value, labels).map((h) => h.label);
  const n = results.length;
  const show = open && n > 0;
  const active = !show ? -1 : activate === "first" ? 0 : activate === "last" ? n - 1 : -1;
  return { ...s, results, open: show, active, status: statusFor(s.value, n) };
}

function accept(s) {
  const label = s.results[s.active];
  return { ...s, value: label, caret: label.length, open: false, active: -1, status: `${label} selected.` };
}

const close = (s) => ({ ...s, open: false, active: -1 });

/** Apply one key to the state. `key` is a printable character or a key name, optionally "Alt+…". */
export function step(s, key, labels) {
  const alt = key.startsWith("Alt+");
  const k = alt ? key.slice(4) : key;
  const n = s.results.length;
  switch (k) {
    case "ArrowDown":
      if (!s.open) return search(s, labels, { open: true, activate: alt ? "none" : "first" });
      if (alt) return s;
      return { ...s, active: s.active === -1 ? 0 : (s.active + 1) % n };
    case "ArrowUp":
      if (alt) return s.open && s.active >= 0 ? accept(s) : close(s);
      if (!s.open) return search(s, labels, { open: true, activate: "last" });
      return { ...s, active: s.active === -1 ? n - 1 : (s.active - 1 + n) % n };
    case "Enter":
      return s.open && s.active >= 0 ? accept(s) : s;
    case "Escape":
      if (s.open) return close(s);
      if (s.value !== "") return search({ ...s, value: "", caret: 0 }, labels, { open: false, activate: null });
      return s;
    case "Home": case "End": case "ArrowLeft": case "ArrowRight": {
      const caret = k === "Home" ? 0 : k === "End" ? s.value.length
        : k === "ArrowLeft" ? Math.max(0, s.caret - 1) : Math.min(s.value.length, s.caret + 1);
      return { ...s, caret, active: s.open ? -1 : s.active };
    }
    case "Backspace": {
      if (s.caret === 0) return s; // nothing deleted, no input event
      const value = s.value.slice(0, s.caret - 1) + s.value.slice(s.caret);
      return search({ ...s, value, caret: s.caret - 1 }, labels, { open: true, activate: null });
    }
    default: {
      if ([...k].length !== 1) throw new Error(`model: unknown key ${key}`);
      const value = s.value.slice(0, s.caret) + k + s.value.slice(s.caret);
      return search({ ...s, value, caret: s.caret + k.length }, labels, { open: true, activate: null });
    }
  }
}
