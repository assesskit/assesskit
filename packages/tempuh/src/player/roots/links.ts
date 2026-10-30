/**
 * Makes the links to an `id` in the root work inside the shadow root. The browser looks for the target of `#note` in the
 * document, which does not see into a shadow root, so a click would only change the address of the page. The handler
 * moves the focus to the element instead, which scrolls it into view and tells a screen reader where it went.
 */
export function followFragmentLinks(root: ShadowRoot): () => void {
  const onClick = (event: Event): void => {
    const link = event.composedPath().find((target) => target instanceof HTMLAnchorElement);
    const href = link instanceof HTMLAnchorElement ? link.getAttribute("href") : null;
    if (href === null || !href.startsWith("#")) return;
    event.preventDefault();
    const target = root.getElementById(href.slice(1));
    if (target === null) return;
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus();
  };
  root.addEventListener("click", onClick);
  return () => root.removeEventListener("click", onClick);
}
