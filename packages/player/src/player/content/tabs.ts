/** The tab that each tablist the root has shown has selected, by the identifier of its first tab: the index of the tab. */
export type SelectedTabs = Map<string, number>;

/** Returns whether the author marked a tab as the selected one. */
const isAuthoredSelected = (tab: Element): boolean => tab.getAttribute("aria-selected") === "true";

/** Returns the `tabpanel` that a `tab` names with `aria-controls`, or `undefined` when none of the container has that id. */
function panelOf(container: Element, tab: Element): HTMLElement | undefined {
  const id = tab.getAttribute("aria-controls");
  if (id === null || id === "") return undefined;
  const panel = container.querySelector(`[role="tabpanel"][id="${CSS.escape(id)}"]`);
  return panel instanceof HTMLElement ? panel : undefined;
}

/**
 * Returns the index of the tab that a key goes to, or `undefined` for a key that does not move the selection.
 *
 * @remarks
 * Right goes to the next tab and Left to the previous one, both wrapping, and the other way round where the text runs from
 * right to left.
 */
function targetOf(key: string, index: number, count: number, rtl: boolean): number | undefined {
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  const step = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
  return step === 0 ? undefined : (index + (rtl ? -step : step) + count) % count;
}

/**
 * Gives each tablist of rendered content its behavior: one panel shown, the arrow keys, Home and End.
 *
 * @remarks
 * A tablist whose every tab names a tabpanel of the container is managed. Its first tab with `aria-selected="true"`, else
 * the first, is selected, unless the tablist was shown before: `selected` keeps the choice of the candidate by the
 * identifier of the first tab, so that a stimulus shared by several items keeps its tab. The panels that are not selected
 * get `hidden`, and the tabs `aria-selected` and a `tabindex` that is 0 for the selected tab alone. A tablist with a tab
 * that has no panel stays as authored, so every panel shows.
 *
 * @param container - The rendered content.
 * @param selected - The selection that earlier content left, which this call updates.
 * @see {@link https://www.w3.org/WAI/ARIA/apg/patterns/tabs/ | WAI-ARIA Authoring Practices, Tabs}
 */
export function enableTabs(container: Element, selected: SelectedTabs): void {
  for (const tablist of container.querySelectorAll<HTMLElement>('[role="tablist"]')) {
    const tabs = [...tablist.querySelectorAll<HTMLElement>('[role="tab"]')];
    const panels = tabs.flatMap((tab) => panelOf(container, tab) ?? []);
    const [first] = tabs;
    if (first === undefined || panels.length !== tabs.length) continue;
    const select = (index: number): void => {
      for (const [at, tab] of tabs.entries()) {
        tab.setAttribute("aria-selected", String(at === index));
        tab.tabIndex = at === index ? 0 : -1;
      }
      for (const panel of panels) panel.hidden = panel !== panels[index];
      if (first.id !== "") selected.set(first.id, index);
    };
    const kept = selected.get(first.id);
    select(kept !== undefined && kept < tabs.length ? kept : Math.max(0, tabs.findIndex(isAuthoredSelected)));
    tablist.classList.add("ak-tablist");
    tablist.addEventListener("click", (event) => {
      const index = tabs.findIndex((tab) => event.target instanceof Node && tab.contains(event.target));
      if (index >= 0) select(index);
    });
    tablist.addEventListener("keydown", (event) => {
      const index = event.target instanceof HTMLElement ? tabs.indexOf(event.target) : -1;
      if (index < 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const next = targetOf(event.key, index, tabs.length, getComputedStyle(tablist).direction === "rtl");
      if (next === undefined) return;
      event.preventDefault();
      select(next);
      tabs[next]?.focus();
    });
  }
}
