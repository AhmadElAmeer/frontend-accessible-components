// Demo page wiring. Everything the tests drive is exposed on window.demo.
import { enhance, Combobox, checkAria } from "../src/index.js";
import { COUNTRIES } from "./countries.js";

const { tabs, dialogs } = enhance();

// ---- comboboxes
const local = new Combobox(document.getElementById("country"), {
  source: COUNTRIES,
  onSelect: (c) => { document.getElementById("country-result").textContent = `Picked ${c.label} (${c.code}).`; },
});
const inDialog = new Combobox(document.getElementById("profile-country"), { source: COUNTRIES });

// A fake server: answers after `latency(query)` ms, honours abort, can fail.
const server = {
  latency: () => 100 + Math.random() * 800,
  fail: false,
  calls: 0,
  search(query, { signal }) {
    server.calls++;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        if (server.fail) reject(new Error("503 Service Unavailable"));
        else resolve(COUNTRIES.filter((c) => c.label.length > 0)); // server returns candidates; the client ranks them
      }, server.latency(query));
      signal.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("aborted", "AbortError")); });
    });
  },
};
const remote = new Combobox(document.getElementById("remote"), { source: (q, ctx) => server.search(q, ctx) });
document.getElementById("fail-toggle").addEventListener("change", (e) => { server.fail = e.target.checked; });

// ---- dialogs
const result = document.getElementById("dialog-result");
dialogs["dialog-delete"].el.addEventListener("close", (e) => {
  result.textContent = e.detail.returnValue === "delete" ? "Project deleted (not really)." : "Nothing was deleted.";
});

const profile = dialogs["dialog-profile"];
const discard = dialogs["dialog-discard"];
const form = document.getElementById("profile-form");
let saved = new FormData(form);
const dirty = () => [...new FormData(form)].some(([k, v]) => saved.get(k) !== v);
form.addEventListener("submit", (e) => {
  e.preventDefault();
  saved = new FormData(form);
  profile.close("save");
  result.textContent = `Profile saved: ${saved.get("name")}${saved.get("country") ? ", " + saved.get("country") : ""}.`;
});
// Cancel (or Escape) with unsaved changes asks first, in a second dialog on top.
function cancelProfile(opener) {
  if (dirty()) discard.open(opener);
  else profile.close("cancel");
}
document.getElementById("profile-cancel").addEventListener("click", (e) => cancelProfile(e.currentTarget));
profile.el.addEventListener("cancel", (e) => {
  if (dirty()) {
    e.preventDefault(); // keep the dialog open and ask first
    discard.open(document.activeElement);
  }
});
discard.el.addEventListener("close", (e) => {
  if (e.detail.returnValue === "discard") {
    for (const [k, v] of saved) form.elements[k].value = v;
    profile.close("cancel");
  }
});

// ---- live ARIA check in the header
const checker = document.getElementById("checker");
function runCheck() {
  const problems = checkAria(document);
  checker.dataset.state = problems.length ? "fail" : "pass";
  checker.textContent = problems.length
    ? `ARIA check: ${problems.length} problem${problems.length > 1 ? "s" : ""}: ${problems.join("; ")}`
    : "ARIA check: all invariants hold";
}
for (const type of ["keyup", "click", "focusin"]) document.addEventListener(type, () => requestAnimationFrame(runCheck));
runCheck();

window.demo = { tabs, dialogs, comboboxes: { local, inDialog, remote }, server, checkAria };
