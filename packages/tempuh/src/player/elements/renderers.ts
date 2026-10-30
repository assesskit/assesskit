import type { Interaction } from "@luthfanwakan/olah/asi";
import { describe } from "../../checks.js";
import { DataError } from "../../errors.js";
import type { BodyRenderer, InteractionRenderer, InteractionRenderers } from "../content/index.js";
import { renderMedia } from "../media/media.js";
import { renderAssociate } from "./associate.js";
import { renderChoice } from "./choice.js";
import { renderCustom } from "./custom.js";
import { defineElements } from "./define.js";
import { renderDrawing } from "./drawing.js";
import { renderEndAttempt } from "./end-attempt.js";
import { renderExtendedText } from "./extended-text.js";
import { renderGapMatch } from "./gap-match.js";
import { renderGraphicAssociate } from "./graphic-associate.js";
import { renderGraphicGapMatch } from "./graphic-gap-match.js";
import { renderGraphicOrder } from "./graphic-order.js";
import { renderHotspot } from "./hotspot.js";
import { renderHotText } from "./hottext.js";
import { renderInlineChoice } from "./inline-choice.js";
import { renderMatch } from "./match.js";
import { type InteractionOptions, type InteractionSettings, readInteractionOptions } from "./options.js";
import { renderOrder } from "./order.js";
import { renderPositionObject } from "./position-object.js";
import { renderSelectPoint } from "./select-point.js";
import { renderSlider } from "./slider.js";
import { renderTextEntry } from "./text-entry.js";
import { renderUpload } from "./upload.js";

/** Returns whether a node is an interaction of the kind. */
function isKind<TKind extends Interaction["kind"]>(
  node: Interaction,
  kind: TKind,
): node is Extract<Interaction, { kind: TKind }> {
  return node.kind === kind;
}

/** Makes the renderer of a kind from a function that gets the node of that kind. */
function forKind<TKind extends Interaction["kind"]>(
  kind: TKind,
  render: (
    node: Extract<Interaction, { kind: TKind }>,
    renderer: BodyRenderer,
    settings: InteractionSettings,
  ) => Element,
  settings: InteractionSettings,
): readonly [TKind, InteractionRenderer] {
  return [
    kind,
    (node, renderer) => {
      if (!isKind(node, kind)) throw new DataError(`The renderer of ${kind} got ${describe(node.kind)}.`);
      return render(node, renderer, settings);
    },
  ];
}

/**
 * Creates the renderers of the interactions, to pass as the `interactions` option of the content root. It defines the
 * elements first. The renderers draw the content and the controls of the interaction; the host gives each element its
 * descriptor, its value and whether it is disabled, and listens for the responses ([InteractionElement]).
 *
 * @param options - See {@link InteractionOptions}.
 * @throws `DataError` when an option is not of its type.
 */
export function createInteractionRenderers(options: InteractionOptions): InteractionRenderers {
  const settings = readInteractionOptions(options);
  defineElements();
  return new Map([
    forKind(
      "associate-interaction",
      (node, renderer, { messages }) => renderAssociate(node, renderer, messages),
      settings,
    ),
    forKind("choice-interaction", (node, renderer, { messages }) => renderChoice(node, renderer, messages), settings),
    forKind(
      "custom-interaction",
      (node, renderer, { messages, customInteraction }) => renderCustom(node, renderer, messages, customInteraction),
      settings,
    ),
    forKind(
      "drawing-interaction",
      (node, renderer, { messages, files }) => renderDrawing(node, renderer, messages, files),
      settings,
    ),
    forKind(
      "end-attempt-interaction",
      (node, renderer, { messages }) => renderEndAttempt(node, renderer, messages),
      settings,
    ),
    forKind(
      "extended-text-interaction",
      (node, renderer, { messages }) => renderExtendedText(node, renderer, messages),
      settings,
    ),
    forKind(
      "gap-match-interaction",
      (node, renderer, { messages }) => renderGapMatch(node, renderer, messages),
      settings,
    ),
    forKind(
      "graphic-associate-interaction",
      (node, renderer, { messages }) => renderGraphicAssociate(node, renderer, messages),
      settings,
    ),
    forKind(
      "graphic-gap-match-interaction",
      (node, renderer, { messages }) => renderGraphicGapMatch(node, renderer, messages),
      settings,
    ),
    forKind(
      "graphic-order-interaction",
      (node, renderer, { messages }) => renderGraphicOrder(node, renderer, messages),
      settings,
    ),
    forKind("hotspot-interaction", (node, renderer, { messages }) => renderHotspot(node, renderer, messages), settings),
    forKind("hottext-interaction", (node, renderer, { messages }) => renderHotText(node, renderer, messages), settings),
    forKind(
      "inline-choice-interaction",
      (node, renderer, { messages }) => renderInlineChoice(node, renderer, messages),
      settings,
    ),
    forKind("match-interaction", (node, renderer, { messages }) => renderMatch(node, renderer, messages), settings),
    forKind("media-interaction", (node, renderer, { messages }) => renderMedia(node, renderer, messages), settings),
    forKind("order-interaction", (node, renderer, { messages }) => renderOrder(node, renderer, messages), settings),
    forKind(
      "position-object-interaction",
      (node, renderer, { messages }) => renderPositionObject(node, renderer, messages),
      settings,
    ),
    forKind(
      "select-point-interaction",
      (node, renderer, { messages }) => renderSelectPoint(node, renderer, messages),
      settings,
    ),
    forKind("slider-interaction", (node, renderer, { messages }) => renderSlider(node, renderer, messages), settings),
    forKind(
      "text-entry-interaction",
      (node, renderer, { messages }) => renderTextEntry(node, renderer, messages),
      settings,
    ),
    forKind(
      "upload-interaction",
      (node, renderer, { messages, files, workletUrl, record }) =>
        renderUpload(node, renderer, messages, { files, workletUrl, record }),
      settings,
    ),
  ]);
}
