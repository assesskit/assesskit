import { type AssessmentItem, type BodyNode, readAsi } from "@assesskit/runtime/asi";
import { describeInteractions, type InteractionDescriptor } from "@assesskit/runtime/interactions";
import type { Value } from "@assesskit/runtime/values";
import { inject } from "vitest";
import { EN_MESSAGES } from "../src/index.js";
import {
  createBodyRenderer,
  createInteractionRenderers,
  InteractionElement,
  type InteractionOptions,
  type ResponseDetail,
} from "../src/player/index.js";
import { type ContentRoot, mount } from "./css-fixture.js";
import { NO_RECORDING } from "./files-fixture.js";

/** The asset origin, under a token of this file, serves the package files of the content tests. */
export const ASSETS = `${inject("fixtures").asset}/content/${crypto.randomUUID()}/`;

const NAMESPACES = 'xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0"';

/** A file that every reference of an example resolves to, so that the page asks for nothing that the server lacks. */
const IMAGE = "items/q1/images/dot.png";

/** The path in the package of the fixture items, against which their relative references resolve. */
const ITEM_PATH = "items/q1/item.xml";

/** The state of an interaction fixture. */
export interface Scene extends ContentRoot {
  /** The item that was read, for its declarations and descriptors. */
  readonly item: AssessmentItem;
  /** The descriptors of the item, by response identifier. */
  readonly descriptors: ReadonlyMap<string, InteractionDescriptor>;
  /** The responses that the interactions gave, in order. */
  readonly responses: ResponseDetail[];
  /** Returns the element of an interaction by its response identifier, or the first one. */
  interaction(responseIdentifier?: string): InteractionElement;
  /** Sets the property `value` of an interaction, as the host does with the view. */
  setValue(responseIdentifier: string, value: Value | null): void;
}

/** What a scene is made of. */
export interface SceneOptions {
  /** The options of the renderers; the messages and the files have defaults. Default: none. */
  readonly options?: Partial<InteractionOptions>;
  /** Whether the descriptors are set on the interactions, as the host does after rendering. Default: `true`. */
  readonly describe?: boolean;
  /** Whether media are withheld because a hazard remains. Default: `false`. */
  readonly withholdMedia?: boolean;
  /** The path in the package of the document, against which relative references resolve. Default: that of the fixtures. */
  readonly base?: string;
}

/** Files that upload nothing and fail when asked: a test that uploads passes its own. */
const NO_FILES: InteractionOptions["files"] = {
  upload: () => Promise.reject(new Error("The fixture has no upload.")),
  url: () => "",
  ...NO_RECORDING,
};

/** The URL under which the fixture serves the static files of the player. */
export const STATIC_URL = `${inject("fixtures").asset}/static/`;

/** Reads an item from the markup of its declarations and its body. */
function readItem(declarations: string, body: string): AssessmentItem {
  const document = readAsi(
    `<qti-assessment-item ${NAMESPACES} identifier="fixture" title="Fixture" adaptive="false" time-dependent="false">${declarations}<qti-item-body>${body}</qti-item-body></qti-assessment-item>`,
  );
  if (document.kind !== "item") throw new Error("The fixture is not an item.");
  return document.item;
}

/** Renders the item written as its declarations and its body: see {@link mountItem}. */
export function mountScene(declarations: string, body: string, scene: SceneOptions = {}): Scene {
  return mountItem(readItem(declarations, body), scene);
}

/**
 * Renders the body of an item with the renderers of the interactions into a content root of the page, and sets the
 * descriptors of the runtime on the interactions, as the host does.
 */
export function mountItem(item: AssessmentItem, scene: SceneOptions = {}): Scene {
  const descriptors = new Map(
    describeInteractions(item).map((descriptor) => [descriptor.responseIdentifier, descriptor]),
  );
  const renderer = createBodyRenderer({
    messages: EN_MESSAGES,
    assets: (path) => `${ASSETS}${scene.base === undefined ? path : IMAGE}`,
    base: scene.base ?? ITEM_PATH,
    withholdMedia: scene.withholdMedia ?? false,
    interactions: createInteractionRenderers({
      messages: EN_MESSAGES,
      files: NO_FILES,
      staticUrl: STATIC_URL,
      ...scene.options,
    }),
  });
  const content = mount("");
  const nodes: readonly BodyNode[] = item.body?.children ?? [];
  content.root.append(...renderer.nodes(nodes));
  const responses: ResponseDetail[] = [];
  content.root.addEventListener("ak-response", (event) => {
    responses.push(event.detail);
  });
  const elements = (): InteractionElement[] =>
    [...content.root.querySelectorAll("*")].filter((element) => element instanceof InteractionElement);
  const find = (responseIdentifier?: string): InteractionElement => {
    const found = elements().find(
      (element) => responseIdentifier === undefined || element.responseIdentifier === responseIdentifier,
    );
    if (found === undefined) throw new Error(`The fixture has no interaction ${responseIdentifier ?? ""}.`);
    return found;
  };
  if (scene.describe !== false) {
    for (const element of elements()) {
      const descriptor = descriptors.get(element.responseIdentifier);
      if (descriptor !== undefined) element.descriptor = descriptor;
    }
  }
  return {
    ...content,
    item,
    descriptors,
    responses,
    interaction: find,
    setValue: (id, value) => {
      find(id).value = value;
    },
  };
}
