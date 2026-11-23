// Focus helpers shared by the components.

const CANDIDATES = [
  "a[href]", "area[href]", "button", "input:not([type=hidden])", "select", "textarea",
  "iframe", "audio[controls]", "video[controls]", "summary", "[contenteditable]:not([contenteditable=false])",
  "[tabindex]",
].join(",");

/** True if the element can be reached with Tab: not disabled, not inert, rendered, tabindex >= 0. */
export function isTabbable(el) {
  if (el.matches(":disabled") || el.closest("[inert]")) return false;
  if (el.tabIndex < 0) return false;
  if (el.closest("[hidden]")) return false;
  // getClientRects() is empty for display:none (and anything inside it).
  if (el.getClientRects().length === 0) return false;
  return getComputedStyle(el).visibility !== "hidden";
}

/**
 * Tabbable elements inside `root`, in Tab order. Positive tabindex values are
 * deliberately not reordered: they are an accessibility anti-pattern and none
 * of these components create them.
 */
export function tabbables(root) {
  return [...root.querySelectorAll(CANDIDATES)].filter(isTabbable);
}

/** Focus an element without scrolling the page under a fixed overlay. */
export function focusElement(el) {
  el.focus({ preventScroll: true });
}

let counter = 0;
/** Give an element an id if it has none, and return the id. */
export function ensureId(el, prefix = "ac") {
  if (!el.id) {
    do counter++; while (document.getElementById(`${prefix}-${counter}`));
    el.id = `${prefix}-${counter}`;
  }
  return el.id;
}
