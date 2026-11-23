export { Tabs } from "./tabs.js";
export { Dialog, topDialog } from "./dialog.js";
export { Combobox } from "./combobox.js";
export { checkAria } from "./aria-check.js";
export { fold, match, filterItems, segments } from "./filter.js";

import { Tabs } from "./tabs.js";
import { Dialog } from "./dialog.js";

/**
 * Enhance declarative markup under `root`:
 *   [data-tabs]                      → Tabs
 *   [role=dialog][data-dialog]       → Dialog, opened by any [data-opens="<dialog id>"] button
 * Comboboxes need a data source, so they are created in code.
 * Returns the created instances, keyed by element id where there is one.
 */
export function enhance(root = document) {
  const made = { tabs: [], dialogs: {} };
  for (const el of root.querySelectorAll("[data-tabs]")) made.tabs.push(new Tabs(el));
  for (const el of root.querySelectorAll("[data-dialog]")) made.dialogs[el.id] = new Dialog(el);
  document.addEventListener("click", (e) => {
    const opener = e.target.closest("[data-opens]");
    const dialog = opener && made.dialogs[opener.dataset.opens];
    if (dialog) dialog.open(opener);
  });
  return made;
}
