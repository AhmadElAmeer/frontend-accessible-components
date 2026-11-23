// Editable combobox with list autocomplete, following the WAI-ARIA Authoring
// Practices "Combobox" pattern (list autocomplete, manual selection).
//
//   <label for="country">Country</label>
//   <input id="country" data-combobox>
//
// new Combobox(input, { source }) adds the listbox and a status region.
// `source` is an array of strings/objects, or an async function
// (query, { signal }) => items for server-side search.
//
// DOM focus always stays in the text box; the "active" option is shown with
// aria-activedescendant, so screen readers announce it while typing continues
// to work.
//
// Keyboard (focus in the text box):
//   typing          filter; the list opens if anything matches; no option is active
//   Down            closed: open and activate the first option (Alt+Down: open only)
//                   open: next option, wrapping
//   Up              closed: open and activate the last option; open: previous, wrapping
//   Enter           accept the active option (sets the value, closes the list)
//   Alt+Up          accept the active option if any, and close
//   Escape          open: close the list; closed: clear the text box
//   Home/End/Left/Right   move the caret; the active option is cleared
// Mouse: clicking an option accepts it. Leaving the field closes the list.

import { filterItems, segments } from "./filter.js";
import { ensureId } from "./focus.js";

export class Combobox {
  /**
   * @param {HTMLInputElement} input
   * @param {{
   *   source: Array<any> | ((query: string, ctx: {signal: AbortSignal}) => Promise<Array<any>>),
   *   getLabel?: (item: any) => string,
   *   delay?: number,          // debounce for async sources, ms (default 200)
   *   onSelect?: (item: any) => void,
   * }} options
   */
  constructor(input, options) {
    if (!options?.source) throw new Error("Combobox: a source (array or function) is required");
    this.input = input;
    this.source = options.source;
    this.getLabel = options.getLabel ?? ((item) => (typeof item === "string" ? item : item.label));
    this.async = typeof options.source === "function";
    this.delay = options.delay ?? (this.async ? 200 : 0);
    this.onSelect = options.onSelect ?? (() => {});

    this.results = [];      // [{item, label, ranges}]
    this.activeIndex = -1;
    this.isOpen = false;
    this.selected = null;   // last accepted item
    this.request = 0;       // sequence number of the latest search
    this.controller = null; // aborts the previous async search
    this.timer = 0;

    const id = ensureId(input, "combobox");
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("autocomplete", "off");
    input.setAttribute("autocapitalize", "none");
    input.spellcheck = false;

    this.wrapper = document.createElement("div");
    this.wrapper.className = "combobox";
    input.replaceWith(this.wrapper);

    this.listbox = document.createElement("ul");
    this.listbox.setAttribute("role", "listbox");
    this.listbox.id = `${id}-listbox`;
    this.listbox.className = "combobox-listbox";
    this.listbox.hidden = true;
    const label = input.labels?.[0];
    if (label) this.listbox.setAttribute("aria-labelledby", ensureId(label, "label"));
    input.setAttribute("aria-controls", this.listbox.id);

    // Result counts and loading/error states are announced through a polite
    // live region, since nothing else tells a screen reader user the list changed.
    this.status = document.createElement("div");
    this.status.setAttribute("role", "status");
    this.status.className = "visually-hidden";
    this.status.id = `${id}-status`;

    this.wrapper.append(input, this.listbox, this.status);

    input.addEventListener("input", () => this.#search(this.input.value, { open: true, activate: null }));
    input.addEventListener("keydown", (e) => this.#onKeydown(e));
    input.addEventListener("blur", () => this.close());
    // Keep focus in the text box when an option is pressed, then accept it on click.
    this.listbox.addEventListener("mousedown", (e) => e.preventDefault());
    this.listbox.addEventListener("click", (e) => {
      const option = e.target.closest("[role=option]");
      if (option) this.accept(Number(option.dataset.index));
    });
  }

  /** Run a search; `activate` is "first", "last" or null once results arrive. */
  #search(query, { open, activate }) {
    const seq = ++this.request;
    clearTimeout(this.timer);
    this.controller?.abort();
    this.controller = null;

    if (!this.async) {
      // Typing into an empty box closes the list; Down on an empty box shows everything.
      if (query.trim() === "" && activate === null) {
        this.#setResults([], { open: false, activate });
        return;
      }
      this.#setResults(filterItems(query, this.source, this.getLabel), { open, activate });
      return;
    }

    if (query.trim() === "") {
      this.#setResults([], { open: false, activate });
      return;
    }
    this.#setState("loading", "Loading results…");
    this.timer = setTimeout(async () => {
      const controller = (this.controller = new AbortController());
      try {
        const items = await this.source(query, { signal: controller.signal });
        // A slower, older request can finish after a newer one: ignore it.
        // close() (blur, Escape, accept) also bumps the sequence number, so an
        // answer that arrives after the user has moved on never reopens the list.
        if (seq !== this.request) return;
        this.#setResults(filterItems(query, items, this.getLabel), { open, activate });
      } catch (err) {
        if (seq !== this.request || err?.name === "AbortError") return;
        this.close();
        this.#setState("error", "Couldn't load results. Keep typing to try again.");
      }
    }, this.delay);
  }

  #setState(state, message) {
    this.wrapper.dataset.state = state;
    this.status.textContent = message;
  }

  #setResults(results, { open, activate }) {
    this.results = results;
    this.listbox.replaceChildren(
      ...results.map((r, i) => {
        const li = document.createElement("li");
        li.setAttribute("role", "option");
        li.id = `${this.listbox.id}-${i}`;
        li.dataset.index = String(i);
        li.setAttribute("aria-selected", "false");
        for (const seg of segments(r.label, r.ranges)) {
          li.append(seg.mark ? Object.assign(document.createElement("mark"), { textContent: seg.text })
                             : document.createTextNode(seg.text));
        }
        return li;
      }),
    );
    const n = results.length;
    if (this.input.value.trim() === "" && n === 0) this.#setState("idle", "");
    else this.#setState(n ? "results" : "empty", n === 0 ? "No results." : n === 1 ? "1 result available." : `${n} results available.`);

    if (open && n > 0) {
      this.#show(true);
      this.#activate(activate === "first" ? 0 : activate === "last" ? n - 1 : -1);
    } else {
      this.#show(false);
      this.#activate(-1);
    }
  }

  #show(on) {
    this.isOpen = on;
    this.listbox.hidden = !on;
    this.input.setAttribute("aria-expanded", String(on));
  }

  #activate(index) {
    const prev = this.listbox.children[this.activeIndex];
    prev?.setAttribute("aria-selected", "false");
    prev?.classList.remove("is-active");
    this.activeIndex = index;
    const next = this.listbox.children[index];
    if (next) {
      next.setAttribute("aria-selected", "true");
      next.classList.add("is-active");
      this.input.setAttribute("aria-activedescendant", next.id);
      next.scrollIntoView({ block: "nearest" });
    } else {
      this.input.removeAttribute("aria-activedescendant");
    }
  }

  /** Accept result `index`: put its label in the box and close the list. */
  accept(index) {
    const r = this.results[index];
    if (!r) return;
    this.input.value = r.label;
    this.selected = r.item;
    this.close();
    this.#setState("selected", `${r.label} selected.`);
    this.onSelect(r.item);
    this.input.dispatchEvent(new CustomEvent("select-item", { bubbles: true, detail: { item: r.item } }));
  }

  close() {
    // Any search still in flight is now stale: it must not reopen the list.
    clearTimeout(this.timer);
    this.request++;
    this.controller?.abort();
    this.controller = null;
    if (this.isOpen) {
      this.#show(false);
      this.#activate(-1);
    }
  }

  #move(step) {
    const n = this.results.length;
    if (n === 0) return;
    const from = this.activeIndex;
    const next = from === -1 ? (step > 0 ? 0 : n - 1) : (from + step + n) % n;
    this.#activate(next);
  }

  #onKeydown(e) {
    if (e.ctrlKey || e.metaKey || e.isComposing) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!this.isOpen) this.#search(this.input.value, { open: true, activate: e.altKey ? "none" : "first" });
        else if (!e.altKey) this.#move(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (e.altKey) {
          if (this.isOpen && this.activeIndex >= 0) this.accept(this.activeIndex);
          else this.close();
        } else if (!this.isOpen) this.#search(this.input.value, { open: true, activate: "last" });
        else this.#move(-1);
        break;
      case "Enter":
        if (this.isOpen && this.activeIndex >= 0) {
          e.preventDefault(); // don't submit the form when picking an option
          this.accept(this.activeIndex);
        }
        break;
      case "Escape":
        if (this.isOpen) {
          e.preventDefault();
          this.close();
        } else if (this.input.value !== "") {
          e.preventDefault();
          this.input.value = "";
          this.selected = null;
          this.#search("", { open: false, activate: null });
        }
        break;
      case "Home": case "End": case "ArrowLeft": case "ArrowRight":
        if (this.isOpen) this.#activate(-1); // the caret moves; the default action is kept
        break;
    }
  }
}
