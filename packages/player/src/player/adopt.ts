/** Returns the root a node is in, which holds the stylesheets that apply to it, or `null` for a node outside a document. */
function styleRoot(node: Node): Document | ShadowRoot | null {
  const root = node.getRootNode();
  return root instanceof Document || root instanceof ShadowRoot ? root : null;
}

/**
 * Makes the function that returns a constructed stylesheet of a text, built when it is first asked for.
 *
 * @param css - The text of the stylesheet.
 * @returns A function that returns the same sheet on every call.
 */
export function lazyStyleSheet(css: string): () => CSSStyleSheet {
  let sheet: CSSStyleSheet | undefined;
  return () => {
    if (sheet === undefined) {
      sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
    }
    return sheet;
  };
}

/**
 * Makes the function that adopts a stylesheet into the document or shadow root that holds a node, for a component that
 * lives outside a content root: the chrome and the tools.
 *
 * @remarks
 * The sheet is built when the first component needs it, and a root keeps it until the last component that uses it is
 * gone.
 *
 * @param css - The text of the stylesheet.
 * @returns A function that adopts the sheet for a node and returns the function that releases it.
 */
export function createStyleAdopter(css: string): (node: Node) => () => void {
  const sheetOf = lazyStyleSheet(css);
  const users = new Map<Document | ShadowRoot, number>();
  return (node) => {
    const root = styleRoot(node);
    if (root === null) return () => undefined;
    const adopted = sheetOf();
    const count = users.get(root) ?? 0;
    users.set(root, count + 1);
    if (count === 0) root.adoptedStyleSheets = [...root.adoptedStyleSheets, adopted];
    return () => {
      const remaining = (users.get(root) ?? 1) - 1;
      if (remaining > 0) {
        users.set(root, remaining);
        return;
      }
      users.delete(root);
      root.adoptedStyleSheets = root.adoptedStyleSheets.filter((other) => other !== adopted);
    };
  };
}
