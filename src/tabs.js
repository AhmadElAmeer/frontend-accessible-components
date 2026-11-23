// Tabs, following the WAI-ARIA Authoring Practices "Tabs" pattern.
//
// Progressive enhancement: the page ships plain sections with headings,
// which read well with no JavaScript at all:
//
//   <div data-tabs aria-label="Project">
//     <section><h3>Overview</h3> …</section>
//     <section><h3>Install</h3> …</section>
//     <section data-disabled><h3>Changelog</h3> …</section>
//   </div>
//
// new Tabs(el) turns each heading into a tab and each section into a tabpanel.
//
// Keyboard (focus on a tab):
//   Left/Right (horizontal) or Up/Down (vertical): previous/next tab, wrapping.
//     Under dir="rtl" Left and Right swap, so Left still moves "forward".
//   Home/End: first/last tab.
//   Enter/Space: select the focused tab (only needed in manual mode).
// Disabled tabs are skipped by the arrows and can't be selected.
// Tab order: one tab stop for the whole tab list (roving tabindex on the
// selected tab), then the active panel.

import { ensureId } from "./focus.js";

export class Tabs {
  /**
   * @param {HTMLElement} root  element containing the sections
   * @param {{activation?: "automatic"|"manual", orientation?: "horizontal"|"vertical", selected?: number}} options
   */
  constructor(root, options = {}) {
    this.root = root;
    this.activation = options.activation ?? root.dataset.activation ?? "automatic";
    this.orientation = options.orientation ?? root.dataset.orientation ?? "horizontal";
    const sections = [...root.children].filter((el) => el.matches("section"));
    if (sections.length === 0) throw new Error("Tabs: no <section> children to turn into tabs");

    this.tablist = document.createElement("div");
    this.tablist.setAttribute("role", "tablist");
    this.tablist.className = "tabs-list";
    if (this.orientation === "vertical") this.tablist.setAttribute("aria-orientation", "vertical");
    for (const attr of ["aria-label", "aria-labelledby"]) {
      if (root.hasAttribute(attr)) this.tablist.setAttribute(attr, root.getAttribute(attr));
    }

    this.tabs = [];
    this.panels = [];
    for (const section of sections) {
      const heading = section.querySelector("h1,h2,h3,h4,h5,h6");
      if (!heading) throw new Error("Tabs: every section needs a heading for its tab label");
      const tab = document.createElement("button");
      tab.type = "button";
      tab.setAttribute("role", "tab");
      tab.className = "tabs-tab";
      tab.textContent = heading.textContent.trim();
      ensureId(tab, "tab");
      heading.hidden = true; // the tab now carries the name; avoid announcing it twice

      section.setAttribute("role", "tabpanel");
      section.classList.add("tabs-panel");
      ensureId(section, "tabpanel");
      section.setAttribute("aria-labelledby", tab.id);
      // The panel is focusable so keyboard users can reach text-only panels.
      section.tabIndex = 0;
      tab.setAttribute("aria-controls", section.id);
      if (section.hasAttribute("data-disabled")) tab.setAttribute("aria-disabled", "true");

      this.tablist.append(tab);
      this.tabs.push(tab);
      this.panels.push(section);
    }
    root.prepend(this.tablist);
    root.classList.add("tabs", `tabs--${this.orientation}`);

    this.tablist.addEventListener("keydown", (e) => this.#onKeydown(e));
    this.tablist.addEventListener("click", (e) => {
      const tab = e.target.closest("[role=tab]");
      if (tab) this.select(this.tabs.indexOf(tab), { focus: true });
    });

    const wanted = options.selected ?? Number(root.dataset.selected ?? 0);
    const first = this.#enabled(wanted) ? wanted : this.tabs.findIndex((_, i) => this.#enabled(i));
    if (first === -1) throw new Error("Tabs: every tab is disabled");
    this.selectedIndex = -1;
    this.select(first);
  }

  #enabled(i) {
    return i >= 0 && i < this.tabs.length && this.tabs[i].getAttribute("aria-disabled") !== "true";
  }

  /** Select tab `index`; returns false if it can't be selected (disabled or out of range). */
  select(index, { focus = false } = {}) {
    if (!this.#enabled(index)) return false;
    const changed = index !== this.selectedIndex;
    this.tabs.forEach((tab, i) => {
      const on = i === index;
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
      this.panels[i].hidden = !on;
    });
    this.selectedIndex = index;
    if (focus) this.tabs[index].focus();
    if (changed) {
      this.root.dispatchEvent(new CustomEvent("tabchange", { bubbles: true, detail: { index, tab: this.tabs[index] } }));
    }
    return true;
  }

  /** Next enabled tab index from `from`, stepping by `step` (+1/-1) with wrap-around. */
  #step(from, step) {
    const n = this.tabs.length;
    for (let k = 1; k <= n; k++) {
      const i = (((from + step * k) % n) + n) % n;
      if (this.#enabled(i)) return i;
    }
    return from;
  }

  #onKeydown(e) {
    const current = this.tabs.indexOf(e.target.closest("[role=tab]"));
    if (current === -1 || e.altKey || e.ctrlKey || e.metaKey) return;
    const rtl = getComputedStyle(this.tablist).direction === "rtl";
    const horizontal = this.orientation === "horizontal";
    const keys = horizontal
      ? { [rtl ? "ArrowLeft" : "ArrowRight"]: 1, [rtl ? "ArrowRight" : "ArrowLeft"]: -1 }
      : { ArrowDown: 1, ArrowUp: -1 };

    let target;
    if (e.key in keys) target = this.#step(current, keys[e.key]);
    else if (e.key === "Home") target = this.#step(-1, 1);
    else if (e.key === "End") target = this.#step(this.tabs.length, -1);
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      this.select(current);
      return;
    } else return;

    e.preventDefault(); // arrows and Home/End must not scroll the page
    this.tabs[target].focus();
    if (this.activation === "automatic") this.select(target);
  }
}
