import { type BodyNode, readAsi } from "@assesskit/runtime/asi";
import axe from "axe-core";
import { EN_MESSAGES } from "../src/index.js";
import { type BodyRenderer, type BodyRendererOptions, createBodyRenderer } from "../src/player/index.js";
import { type ContentRoot, mount } from "./css-fixture.js";

/** The namespaces that the markup of an item can use: the ASI namespace as the default, and the prefixes `m`, `ssml` and `cml`. */
const NAMESPACES =
  'xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" xmlns:m="http://www.w3.org/1998/Math/MathML" xmlns:ssml="http://www.w3.org/2001/10/synthesis" xmlns:cml="http://www.xml-cml.org/schema"';

/** The path in the package of the fixture items, against which their relative references resolve. */
export const ITEM_PATH = "items/q1/item.xml";

/**
 * Reads the body of an item written as XML with the runtime and returns its children: the typed nodes that the renderer gets from
 * the view.
 *
 * @param body - The markup between `qti-item-body` and its end tag.
 * @param declarations - Markup between the opening tag of the item and its body, such as outcome declarations.
 */
export function itemBody(body: string, declarations = ""): readonly BodyNode[] {
  const document = readAsi(
    `<qti-assessment-item ${NAMESPACES} identifier="fixture" title="Fixture" adaptive="false" time-dependent="false">${declarations}<qti-item-body>${body}</qti-item-body></qti-assessment-item>`,
  );
  if (document.kind !== "item" || document.item.body === undefined) throw new Error("The fixture is not an item.");
  return document.item.body.children;
}

/** The options of a renderer for the tests: the English messages and assets at the asset origin under a token. */
function rendererOptions(assets: string, extra: Partial<BodyRendererOptions> = {}): BodyRendererOptions {
  return { messages: EN_MESSAGES, assets: (path) => `${assets}${path}`, base: ITEM_PATH, ...extra };
}

/** Creates the renderer of the tests. */
export function testRenderer(assets: string, extra: Partial<BodyRendererOptions> = {}): BodyRenderer {
  return createBodyRenderer(rendererOptions(assets, extra));
}

/** Renders the body of an item into a content root of the page, which has `player.css`, and returns the root. */
export function renderBody(
  body: string,
  assets: string,
  extra: Partial<BodyRendererOptions> = {},
  declarations = "",
): ContentRoot {
  const content = mount("");
  content.root.append(...testRenderer(assets, extra).nodes(itemBody(body, declarations)));
  return content;
}

/**
 * Runs axe with the rules of WCAG 2.2 A and AA, and the one for 2.5.3 that axe leaves off by default (d-m8), over an
 * element and what it holds, shadow roots included.
 *
 * @returns One line for each violated rule: the rule and the targets.
 */
export async function axeViolations(scope: Element): Promise<string[]> {
  const result = await axe.run(scope, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    rules: { "label-content-name-mismatch": { enabled: true } },
  });
  return result.violations.map(({ id, nodes }) => `${id}: ${nodes.map(({ target }) => String(target)).join(" | ")}`);
}
