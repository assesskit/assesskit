import type { Catalog, ModelNode } from "@assesskit/runtime/asi";
import { selectCard } from "@assesskit/runtime/content";
import type { SupportName } from "@assesskit/runtime/pnp";
import type { BodyRenderer } from "../content/index.js";

/**
 * Renders the card of a catalog for a support, as the candidate asks for it.
 *
 * @remarks
 * `selectCard` of the runtime chooses the card and, in it, the entry by language. The HTML content of the entry is
 * rendered like any content, and each of its files is embedded like an `object` of the media type that the entry gives.
 *
 * @param catalogs - The catalogs of the item.
 * @param idref - The `data-catalog-idref` of the element that the candidate asks about.
 * @param support - The support that the candidate turned on, such as `glossary-on-screen`.
 * @param language - The language of the candidate's PNP, such as the `item-translation` language; `undefined` selects the
 * default entry of the card.
 * @param renderer - The renderer of content.
 * @returns The content of the card, or `undefined` when no catalog has the id or its card has no entry that fits.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, catalogs}
 */
export function renderCard(
  catalogs: readonly Catalog[],
  idref: string,
  support: SupportName,
  language: string | undefined,
  renderer: BodyRenderer,
): DocumentFragment | undefined {
  const catalog = catalogs.find(({ id }) => id === idref);
  const content = catalog === undefined ? undefined : selectCard(catalog, support, language);
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
  fragment.append(...renderer.nodes(files));
  return fragment;
}
