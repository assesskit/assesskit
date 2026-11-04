import type { Catalog, ModelNode } from "@assesskit/runtime/asi";
import { selectCard } from "@assesskit/runtime/content";
import type { Braille, SupportName } from "@assesskit/runtime/pnp";
import type { BodyRenderer } from "../content/index.js";
import { appendAll } from "../internal.js";

/**
 * Renders the card of a catalog for a support, as the candidate asks for it.
 *
 * @remarks
 * `selectCard` of the runtime chooses the card and, in it, the entry by language and the preferences of braille. The HTML content of the entry is
 * rendered like any content, and each of its files is embedded like an `object` of the media type that the entry gives.
 *
 * @param catalogs - The catalogs of the item.
 * @param idref - The `data-catalog-idref` of the element that the candidate asks about.
 * @param support - The support that the candidate turned on, such as `glossary-on-screen`.
 * @param preferences - The language of the candidate's PNP, such as the `item-translation` language, whose absence selects
 * the default entry of the card, and the settings of `braille` while it is on.
 * @param renderer - The renderer of content.
 * @returns The content of the card, or `undefined` when no catalog has the id or its card has no entry that fits.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, catalogs}
 */
export function renderCard(
  catalogs: readonly Catalog[],
  idref: string,
  support: SupportName,
  preferences: { readonly language: string | undefined; readonly braille: Braille | undefined },
  renderer: BodyRenderer,
): DocumentFragment | undefined {
  const catalog = catalogs.find(({ id }) => id === idref);
  const { language, braille } = preferences;
  const content = catalog === undefined ? undefined : selectCard(catalog, support, { language, braille });
  if (content === undefined) return undefined;
  const fragment = document.createDocumentFragment();
  const { htmlContent } = content;
  if (htmlContent !== undefined) {
    fragment.append(renderer.element("qti-html-content", htmlContent, renderer.nodes(htmlContent.children)));
  }
  const files: ModelNode[] = content.fileHrefs.map((file) => ({
    kind: "object",
    data: file.value,
    type: "mimeType" in file ? file.mimeType : "",
    children: [],
  }));
  appendAll(fragment, renderer.nodes(files));
  return fragment;
}
