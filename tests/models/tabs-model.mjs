// A pure model of the tab list's keyboard behaviour (WAI-ARIA APG "Tabs"):
// which tab has focus and which is selected after each key.

/**
 * @param {{n: number, disabled: Set<number>, manual: boolean, vertical: boolean, rtl: boolean}} cfg
 */
export function makeTabsModel(cfg) {
  const enabled = (i) => !cfg.disabled.has(i);
  const next = (from, dir) => {
    for (let k = 1; k <= cfg.n; k++) {
      const i = (((from + dir * k) % cfg.n) + cfg.n) % cfg.n;
      if (enabled(i)) return i;
    }
    return from;
  };
  const forward = cfg.vertical ? "ArrowDown" : cfg.rtl ? "ArrowLeft" : "ArrowRight";
  const backward = cfg.vertical ? "ArrowUp" : cfg.rtl ? "ArrowRight" : "ArrowLeft";

  return function step({ focus, selected }, key) {
    let target = null;
    if (key === forward) target = next(focus, 1);
    else if (key === backward) target = next(focus, -1);
    else if (key === "Home") target = next(-1, 1);
    else if (key === "End") target = next(cfg.n, -1);
    else if (key === "Enter" || key === " ") return { focus, selected: enabled(focus) ? focus : selected };
    else return { focus, selected }; // other keys (e.g. the cross-axis arrows) do nothing
    return { focus: target, selected: cfg.manual ? selected : target };
  };
}
