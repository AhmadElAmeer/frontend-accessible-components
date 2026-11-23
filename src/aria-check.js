// A runtime checker for the ARIA promises these components make.
//
// checkAria(document) returns a list of human-readable problems (empty when
// everything holds). The browser tests call it after every simulated key
// press; it is also handy in the console while developing. It checks
// relationships a static linter can't see, because they only exist while the
// page is being used (an active option, an open dialog, the focused element).

const visible = (el) => !!el && !el.closest("[hidden]") && el.getClientRects().length > 0;

function refs(el, attr) {
  return (el.getAttribute(attr) ?? "").split(/\s+/).filter(Boolean);
}

function accessibleName(el) {
  const label = el.getAttribute("aria-label");
  if (label?.trim()) return label.trim();
  const ids = refs(el, "aria-labelledby");
  if (ids.length) return ids.map((id) => document.getElementById(id)?.textContent.trim() ?? "").join(" ").trim();
  if (el.labels?.length) return [...el.labels].map((l) => l.textContent.trim()).join(" ");
  return "";
}

export function checkAria(root = document) {
  const problems = [];
  const fail = (msg) => problems.push(msg);
  const doc = root.ownerDocument ?? root;

  // 1. IDs are unique, and every ID reference points at something.
  const seen = new Map();
  for (const el of root.querySelectorAll("[id]")) {
    if (seen.has(el.id)) fail(`duplicate id "${el.id}"`);
    seen.set(el.id, el);
  }
  for (const attr of ["aria-controls", "aria-labelledby", "aria-describedby", "aria-activedescendant", "aria-owns"]) {
    for (const el of root.querySelectorAll(`[${attr}]`)) {
      for (const id of refs(el, attr)) {
        if (!doc.getElementById(id)) fail(`${attr}="${id}" on <${el.localName}> points at nothing`);
      }
    }
  }

  // 2. Comboboxes.
  for (const box of root.querySelectorAll("[role=combobox]")) {
    const name = accessibleName(box) || `#${box.id}`;
    const expanded = box.getAttribute("aria-expanded");
    if (expanded !== "true" && expanded !== "false") fail(`combobox ${name}: aria-expanded is "${expanded}"`);
    if (!accessibleName(box)) fail(`combobox ${name}: no accessible name`);
    const list = doc.getElementById(box.getAttribute("aria-controls") ?? "");
    if (!list || list.getAttribute("role") !== "listbox") { fail(`combobox ${name}: aria-controls is not a listbox`); continue; }
    if (expanded === "true" && !visible(list)) fail(`combobox ${name}: expanded but its listbox is hidden`);
    if (expanded === "false" && visible(list)) fail(`combobox ${name}: collapsed but its listbox is visible`);
    if (expanded === "true" && !list.querySelector("[role=option]")) fail(`combobox ${name}: expanded with no options`);
    const activeId = box.getAttribute("aria-activedescendant");
    const selected = [...list.querySelectorAll("[role=option][aria-selected=true]")];
    if (activeId) {
      const opt = doc.getElementById(activeId);
      if (expanded !== "true") fail(`combobox ${name}: active option while collapsed`);
      if (!opt || opt.getAttribute("role") !== "option" || !list.contains(opt)) fail(`combobox ${name}: active descendant is not an option of its listbox`);
      else if (selected.length !== 1 || selected[0] !== opt) fail(`combobox ${name}: aria-selected doesn't match the active option`);
    } else if (selected.length) {
      fail(`combobox ${name}: an option is aria-selected but none is active`);
    }
  }

  // 3. Tab lists.
  for (const list of root.querySelectorAll("[role=tablist]")) {
    const tabs = [...list.querySelectorAll("[role=tab]")];
    const name = list.getAttribute("aria-label") ?? "tablist";
    if (!accessibleName(list)) fail(`tablist ${name}: no accessible name`);
    const selected = tabs.filter((t) => t.getAttribute("aria-selected") === "true");
    if (selected.length !== 1) fail(`tablist ${name}: ${selected.length} tabs selected`);
    const stops = tabs.filter((t) => t.tabIndex === 0);
    if (stops.length !== 1 || stops[0] !== selected[0]) fail(`tablist ${name}: the tab stop isn't the selected tab`);
    for (const tab of tabs) {
      const panel = doc.getElementById(tab.getAttribute("aria-controls") ?? "");
      if (!panel || panel.getAttribute("role") !== "tabpanel") { fail(`tab "${tab.textContent}": aria-controls is not a tabpanel`); continue; }
      if (panel.getAttribute("aria-labelledby") !== tab.id) fail(`tabpanel for "${tab.textContent}" isn't labelled by its tab`);
      const on = tab.getAttribute("aria-selected") === "true";
      if (on !== !panel.hidden) fail(`tab "${tab.textContent}": selected=${on} but its panel hidden=${panel.hidden}`);
      if (on && tab.getAttribute("aria-disabled") === "true") fail(`tab "${tab.textContent}": disabled but selected`);
    }
  }

  // 4. Modal dialogs: named, focus inside the topmost one, everything else inert.
  const modals = [...root.querySelectorAll("[role=dialog][aria-modal=true], [role=alertdialog][aria-modal=true]")].filter(visible);
  for (const d of modals) if (!accessibleName(d)) fail(`dialog #${d.id}: no accessible name`);
  const top = modals.find((d) => !d.closest("[inert]"));
  if (modals.length && !top) fail("every open dialog is inert");
  if (top) {
    if (modals.filter((d) => !d.closest("[inert]")).length > 1) fail("more than one open dialog is interactive");
    if (!top.contains(doc.activeElement)) fail(`focus is outside the open dialog #${top.id} (on <${doc.activeElement?.localName}>)`);
    for (const child of doc.body.children) {
      if (!child.contains(top) && !child.inert && visible(child)) fail(`<${child.localName}${child.id ? "#" + child.id : ""}> is interactive behind dialog #${top.id}`);
    }
  }
  return problems;
}
