import { checkRecord, describe } from "../../checks.js";
import { DataError } from "../../errors.js";

/**
 * The look that a candidate's supports ask for, as the attributes and the custom properties that `player.css` reads
 * (see the styling guide). `presentationOf` builds it. Both maps hold only what the supports set; a name that is absent has its default.
 */
export interface Presentation {
  /** The attributes `data-tempuh-*`, by name; a flag has the value `""`. */
  readonly attributes: ReadonlyMap<string, string>;
  /** The custom properties `--tempuh-*`, by name. */
  readonly properties: ReadonlyMap<string, string>;
}

/** Every attribute that a presentation may set. */
const PRESENTATION_ATTRIBUTES = [
  "data-tempuh-polarity",
  "data-tempuh-contrast",
  "data-tempuh-single-column",
  "data-tempuh-keyword-emphasis",
  "data-tempuh-uniform-font",
  "data-tempuh-wrapping",
] as const;

/** Every custom property that a presentation may set. */
const PRESENTATION_PROPERTIES = [
  "--tempuh-fg",
  "--tempuh-bg",
  "--tempuh-font-scale",
  "--tempuh-font-family",
  "--tempuh-line-height",
  "--tempuh-line-spacing",
  "--tempuh-letter-spacing",
  "--tempuh-word-spacing",
  "--tempuh-text-zoom",
] as const;

/**
 * Checks a presentation, as a host passes it from JavaScript: two maps, with the names that {@link presentationOf} can
 * set and text for values.
 *
 * @param label - Names the presentation in the error message, such as `The option presentation`.
 * @throws `DataError` when it is not one.
 */
export function checkPresentation(value: unknown, label: string): asserts value is Presentation {
  checkRecord(value, `${label} must be an object with the maps attributes and properties`);
  const maps: readonly [string, readonly string[]][] = [
    ["attributes", PRESENTATION_ATTRIBUTES],
    ["properties", PRESENTATION_PROPERTIES],
  ];
  for (const [part, known] of maps) {
    const map = value[part];
    if (!(map instanceof Map)) throw new DataError(`${label} property ${part} must be a Map, found ${describe(map)}.`);
    for (const [name, text] of map) {
      if (typeof name !== "string" || !known.includes(name)) {
        throw new DataError(`${label} property ${part} has the names ${known.join(", ")}, found ${describe(name)}.`);
      }
      if (typeof text !== "string") {
        throw new DataError(
          `${label} property ${part} must map ${describe(name)} to a string, found ${describe(text)}.`,
        );
      }
    }
  }
}

/**
 * Sets a presentation on an element and takes off what an earlier one set: the host of a content root, or the `html`
 * element of a frame. Only the names of {@link presentationOf} are touched, so the other attributes and properties of
 * the element stay.
 *
 * @throws `DataError` when `target` is not an element or `presentation` is not valid.
 */
export function applyPresentation(target: HTMLElement, presentation: Presentation): void {
  if (!(target instanceof HTMLElement))
    throw new DataError(`The target must be an element, found ${describe(target)}.`);
  checkPresentation(presentation, "The presentation");
  for (const name of PRESENTATION_ATTRIBUTES) {
    const value = presentation.attributes.get(name);
    if (value === undefined) target.removeAttribute(name);
    else target.setAttribute(name, value);
  }
  for (const name of PRESENTATION_PROPERTIES) {
    const value = presentation.properties.get(name);
    if (value === undefined) target.style.removeProperty(name);
    else target.style.setProperty(name, value);
  }
}
