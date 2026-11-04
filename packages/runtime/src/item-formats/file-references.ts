// The files that the HTML of a question names, as a writer writes that HTML: in the attributes `src`, `href`, `data` and
// `poster`, escaped as `body-html.ts` escapes them.

/** A reference in an attribute of the HTML that `writeHtml` writes, with the attribute's quotes. */
const REFERENCE = /\b(?:src|href|data|poster)="([^"]*)"/g;

function unescapeAttribute(value: string): string {
  return value.replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

/** Whether a reference names a file beside the item: no scheme, no fragment alone, no path from a root. */
export function isRelative(reference: string): boolean {
  return (
    reference !== "" &&
    !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(reference) &&
    !reference.startsWith("#") &&
    !reference.startsWith("/")
  );
}

/** The references of the HTML of a text, in order, each once. */
export function listReferences(html: string): string[] {
  return [...new Set([...html.matchAll(REFERENCE)].map((match) => unescapeAttribute(match[1] ?? "")))];
}

/** Replaces each reference of the HTML of a text that `rename` gives a new name, in every attribute that holds it. */
export function renameReferences(html: string, rename: (reference: string) => string | undefined): string {
  return html.replaceAll(REFERENCE, (whole, value: string) => {
    const renamed = rename(unescapeAttribute(value));
    return renamed === undefined
      ? whole
      : whole.replace(`"${value}"`, `"${renamed.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"`);
  });
}
