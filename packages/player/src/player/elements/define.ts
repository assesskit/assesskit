import { AssesskitError } from "@assesskit/runtime/errors";
import { MediaInteractionElement } from "../media/media.js";
import { AssociateInteractionElement } from "./associate.js";
import { ChoiceInteractionElement } from "./choice.js";
import { CustomInteractionElement } from "./custom.js";
import { DrawingInteractionElement } from "./drawing.js";
import { EndAttemptInteractionElement } from "./end-attempt.js";
import { ExtendedTextInteractionElement } from "./extended-text.js";
import { GapMatchInteractionElement } from "./gap-match.js";
import { GraphicAssociateInteractionElement } from "./graphic-associate.js";
import { GraphicGapMatchInteractionElement } from "./graphic-gap-match.js";
import { GraphicOrderInteractionElement } from "./graphic-order.js";
import { HotspotInteractionElement } from "./hotspot.js";
import { HotTextInteractionElement } from "./hottext.js";
import { InlineChoiceInteractionElement } from "./inline-choice.js";
import { MatchInteractionElement } from "./match.js";
import { OrderInteractionElement } from "./order.js";
import { PositionObjectInteractionElement } from "./position-object.js";
import { SelectPointInteractionElement } from "./select-point.js";
import { SliderInteractionElement } from "./slider.js";
import { TextEntryInteractionElement } from "./text-entry.js";
import { UploadInteractionElement } from "./upload.js";

/** The interaction elements by the name they are defined under. */
const ELEMENTS: ReadonlyMap<string, CustomElementConstructor> = new Map<string, CustomElementConstructor>([
  ["qti-associate-interaction", AssociateInteractionElement],
  ["qti-choice-interaction", ChoiceInteractionElement],
  ["qti-custom-interaction", CustomInteractionElement],
  ["qti-drawing-interaction", DrawingInteractionElement],
  ["qti-end-attempt-interaction", EndAttemptInteractionElement],
  ["qti-extended-text-interaction", ExtendedTextInteractionElement],
  ["qti-gap-match-interaction", GapMatchInteractionElement],
  ["qti-graphic-associate-interaction", GraphicAssociateInteractionElement],
  ["qti-graphic-gap-match-interaction", GraphicGapMatchInteractionElement],
  ["qti-graphic-order-interaction", GraphicOrderInteractionElement],
  ["qti-hotspot-interaction", HotspotInteractionElement],
  ["qti-hottext-interaction", HotTextInteractionElement],
  ["qti-inline-choice-interaction", InlineChoiceInteractionElement],
  ["qti-match-interaction", MatchInteractionElement],
  ["qti-media-interaction", MediaInteractionElement],
  ["qti-order-interaction", OrderInteractionElement],
  ["qti-position-object-interaction", PositionObjectInteractionElement],
  ["qti-select-point-interaction", SelectPointInteractionElement],
  ["qti-slider-interaction", SliderInteractionElement],
  ["qti-text-entry-interaction", TextEntryInteractionElement],
  ["qti-upload-interaction", UploadInteractionElement],
]);

/**
 * Defines the custom elements of the interactions, once for the page. Calling it again does nothing.
 *
 * @throws `AssesskitError` when another class is defined under the name of an interaction.
 */
export function defineElements(): void {
  for (const [name, type] of ELEMENTS) {
    const defined = customElements.get(name);
    if (defined === undefined) customElements.define(name, type);
    else if (defined !== type) throw new AssesskitError(`The name ${name} is defined by another class.`);
  }
}
