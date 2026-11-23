// Modal dialog, following the WAI-ARIA Authoring Practices "Dialog (Modal)" pattern.
//
//   <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="t" hidden>
//     <h2 id="t">Delete project?</h2> …
//     <button data-close="cancel">Cancel</button>
//     <button data-close="delete">Delete</button>
//   </div>
//
// While open:
//   - everything outside the dialog is `inert`: not clickable, not focusable,
//     and hidden from assistive technology (this is what aria-modal promises);
//   - Tab and Shift+Tab cycle through the dialog's controls, wrapping;
//   - Escape closes the topmost dialog (dialogs can stack), unless a "cancel"
//     listener calls preventDefault();
//   - the page behind doesn't scroll.
// On open, focus goes to the element marked [data-autofocus], else to the
// first focusable control, else to the dialog itself. On close, focus returns
// to the element that opened it.

import { ensureId, focusElement, tabbables } from "./focus.js";

const stack = []; // open dialogs, topmost last

export class Dialog {
  /**
   * @param {HTMLElement} el  the [role=dialog] element
   * @param {{closeOnBackdrop?: boolean}} options
   */
  constructor(el, options = {}) {
    if (!["dialog", "alertdialog"].includes(el.getAttribute("role"))) {
      throw new Error('Dialog: element needs role="dialog" or role="alertdialog"');
    }
    if (!el.hasAttribute("aria-labelledby") && !el.hasAttribute("aria-label")) {
      throw new Error("Dialog: element needs an accessible name (aria-labelledby or aria-label)");
    }
    this.el = el;
    this.closeOnBackdrop = options.closeOnBackdrop ?? el.dataset.closeOnBackdrop !== "false";
    this.fallbackFocus = options.fallbackFocus ?? null; // used when the opener no longer exists
    this.opener = null;
    this.returnValue = "";
    el.setAttribute("aria-modal", "true");
    el.hidden = true;
    ensureId(el, "dialog");

    // The backdrop wraps the dialog and is a direct child of <body>, so making
    // every other child of <body> inert covers the whole page.
    this.backdrop = document.createElement("div");
    this.backdrop.className = "dialog-backdrop";
    this.backdrop.hidden = true;
    el.replaceWith(this.backdrop);
    this.backdrop.append(el);
    document.body.append(this.backdrop);

    this.backdrop.addEventListener("click", (e) => {
      if (e.target === this.backdrop && this.closeOnBackdrop) this.close("backdrop");
    });
    el.addEventListener("click", (e) => {
      const closer = e.target.closest("[data-close]");
      if (closer && this.el.contains(closer)) this.close(closer.dataset.close);
    });
    el.addEventListener("keydown", (e) => this.#onKeydown(e));
  }

  get isOpen() {
    return stack.includes(this);
  }

  open(opener = document.activeElement) {
    if (this.isOpen) return;
    this.opener = opener instanceof HTMLElement && opener !== document.body ? opener : null;
    this.returnValue = "";

    if (stack.length === 0) lockScroll();
    // Make everything else inert, remembering what was inert already so that
    // closing restores the page exactly (a nested dialog's parent included).
    this.inerted = [];
    for (const child of document.body.children) {
      if (child !== this.backdrop && !child.inert) {
        child.inert = true;
        this.inerted.push(child);
      }
    }
    // A dialog opened from another dialog was made inert by its parent: lift that.
    this.backdropWasInert = this.backdrop.inert;
    this.backdrop.inert = false;
    stack.push(this);
    this.backdrop.hidden = false;
    this.el.hidden = false;

    const target = this.el.querySelector("[data-autofocus]") ?? tabbables(this.el)[0];
    if (target) focusElement(target);
    else {
      this.el.tabIndex = -1;
      focusElement(this.el);
    }
    this.el.dispatchEvent(new CustomEvent("open", { bubbles: true }));
  }

  close(returnValue = "") {
    if (!this.isOpen) return;
    if (stack[stack.length - 1] !== this) {
      // Closing a dialog underneath another closes the ones above it first.
      while (stack[stack.length - 1] !== this) stack[stack.length - 1].close("parent-closed");
    }
    stack.pop();
    this.returnValue = returnValue;
    this.el.hidden = true;
    this.backdrop.hidden = true;
    for (const child of this.inerted) child.inert = false;
    this.inerted = [];
    this.backdrop.inert = this.backdropWasInert;
    if (stack.length === 0) unlockScroll();

    const back = this.opener;
    if (back && back.isConnected && !back.closest("[inert]")) focusElement(back);
    else if (stack.length) focusElement(tabbables(stack[stack.length - 1].el)[0] ?? stack[stack.length - 1].el);
    else if (this.el.contains(document.activeElement)) {
      // The opener is gone: don't leave focus on an element inside a hidden dialog.
      const fallback = this.fallbackFocus?.isConnected ? this.fallbackFocus : null;
      if (fallback) focusElement(fallback);
      else document.activeElement.blur();
    }
    this.el.dispatchEvent(new CustomEvent("close", { bubbles: true, detail: { returnValue } }));
  }

  #onKeydown(e) {
    if (stack[stack.length - 1] !== this) return;
    if (e.key === "Escape") {
      // A component inside (e.g. an open combobox) can claim Escape first.
      if (e.defaultPrevented) return;
      e.preventDefault();
      e.stopPropagation();
      // Like the native <dialog>, Escape fires a cancelable "cancel" event first,
      // so a form with unsaved changes can ask before closing.
      const cancel = new CustomEvent("cancel", { cancelable: true });
      if (this.el.dispatchEvent(cancel)) this.close("escape");
    } else if (e.key === "Tab") {
      const items = tabbables(this.el);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !this.el.contains(active) || active === this.el)) {
        e.preventDefault();
        focusElement(last);
      } else if (!e.shiftKey && (active === last || !this.el.contains(active))) {
        e.preventDefault();
        focusElement(first);
      }
    }
  }
}

/** The dialog on top of the stack, if any (used by the tests' invariant checker). */
export function topDialog() {
  return stack[stack.length - 1] ?? null;
}

let saved = null;
function lockScroll() {
  const root = document.documentElement;
  const scrollbar = window.innerWidth - root.clientWidth;
  saved = { overflow: root.style.overflow, paddingRight: root.style.paddingRight };
  root.style.overflow = "hidden";
  // Keep the layout from jumping sideways when the scrollbar disappears.
  if (scrollbar > 0) root.style.paddingRight = `${scrollbar}px`;
}

function unlockScroll() {
  const root = document.documentElement;
  root.style.overflow = saved.overflow;
  root.style.paddingRight = saved.paddingRight;
  saved = null;
}
