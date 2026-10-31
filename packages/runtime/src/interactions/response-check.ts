import { compileXsdRegex, normalizeValue, type Pair, type Primitive, type Value } from "../values/index.js";
import { checkDescriptor } from "./check-descriptor.js";
import type { ChoiceDescriptor, InteractionDescriptor } from "./descriptor.js";
import type { ResponseStatus } from "./response-status.js";

/**
 * A rule of validity that a response breaks:
 *
 * | Reason             | The response …                                                                        |
 * | ------------------ | ------------------------------------------------------------------------------------- |
 * | `binding`          | has a cardinality or base type that the interaction or the declaration does not allow |
 * | `unknown-choice`   | names an identifier that is not a choice, or pairs choices that cannot be paired      |
 * | `repeated-choice`  | names a choice twice where a choice can be given once                                 |
 * | `min-choices`      | has fewer choices, hotspots or points than `min-choices` (all of them for an order)   |
 * | `max-choices`      | has more than `max-choices`                                                           |
 * | `min-associations` | has fewer associations than `min-associations`                                        |
 * | `max-associations` | has more than `max-associations`                                                      |
 * | `match-min`        | uses a choice fewer times than its `match-min`                                        |
 * | `match-max`        | uses a choice more times than its `match-max`, or a gap more than once                |
 * | `match-group`      | pairs a choice with one that its `match-group` leaves out                             |
 * | `required`         | leaves out a choice that `required` demands, or a gap that must be filled             |
 * | `min-strings`      | has fewer strings than `min-strings`                                                  |
 * | `max-strings`      | has more strings than `max-strings`                                                   |
 * | `pattern-mask`     | has a string that the `pattern-mask` does not match                                   |
 * | `bounds`           | is outside the bounds of a slider                                                     |
 * | `step`             | is not on a step of a slider                                                          |
 * | `min-plays`        | counts fewer plays than `min-plays`                                                   |
 * | `max-plays`        | counts more plays than `max-plays`                                                    |
 * | `mime-type`        | is a file of a type that the upload does not accept                                   |
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export type ResponseViolation =
  | "binding"
  | "bounds"
  | "match-group"
  | "match-max"
  | "match-min"
  | "max-associations"
  | "max-choices"
  | "max-plays"
  | "max-strings"
  | "mime-type"
  | "min-associations"
  | "min-choices"
  | "min-plays"
  | "min-strings"
  | "pattern-mask"
  | "repeated-choice"
  | "required"
  | "step"
  | "unknown-choice";

/** The verdict on a response: its answered status and the rules it breaks. */
export interface ResponseCheck {
  /** `presented` for NULL, else `answered` when no rule is broken and `attempted` when one is. */
  readonly status: ResponseStatus;
  /** The rules the response breaks, each once; empty when it is valid. */
  readonly reasons: readonly ResponseViolation[];
}

/** The relative slack of the step test of a slider, for the rounding error of dividing floats. */
const STEP_TOLERANCE = 1e-9;

/**
 * The most that a gap takes: "each gap can have at most one choice associated with it".
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
const GAP_CAPACITY = 1;

/** Returns the primitives of a response: none for NULL, the value for a single value, the values of a container. */
function primitivesOf(value: Value | null): readonly Primitive[] {
  if (value === null || value.cardinality === "record") return [];
  return value.cardinality === "single" ? [value.value] : value.values;
}

/** Returns the elements of the list that are strings. */
const stringsOf = (primitives: readonly Primitive[]): string[] =>
  primitives.filter((primitive) => typeof primitive === "string");

/** Returns the elements of the list that are pairs of identifiers. */
function pairsOf(primitives: readonly Primitive[]): Pair[] {
  const pairs: Pair[] = [];
  for (const primitive of primitives) {
    if (!Array.isArray(primitive)) continue;
    const [first, second] = primitive;
    if (typeof first === "string" && typeof second === "string") pairs.push([first, second]);
  }
  return pairs;
}

function bounds(
  count: number,
  min: number | undefined,
  max: number | undefined,
  below: ResponseViolation,
  above: ResponseViolation,
): ResponseViolation[] {
  return [...(min !== undefined && count < min ? [below] : []), ...(max !== undefined && count > max ? [above] : [])];
}

/** Returns whether a response has a type that the descriptor allows and the declaration states. */
function fits(descriptor: InteractionDescriptor, value: Value): boolean {
  const allowed = descriptor.bindings.some(
    ({ cardinality, baseTypes }) =>
      cardinality === value.cardinality && (value.cardinality === "record" || baseTypes.includes(value.baseType)),
  );
  const { declaration } = descriptor;
  const declared =
    declaration === undefined ||
    (declaration.cardinality === value.cardinality &&
      (value.cardinality === "record" || declaration.baseType === value.baseType));
  return allowed && declared;
}

/**
 * Checks the choices, hotspots or hot texts that a response names: the identifiers.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
function selectionViolations(descriptor: InteractionDescriptor, value: Value | null): ResponseViolation[] {
  const identifiers = stringsOf(primitivesOf(value));
  const known = new Set(descriptor.choices.map((choice) => choice.identifier));
  const { minChoices, maxChoices, required } = descriptor.constraints;
  // An order without min-choices orders every choice, and its max-choices does not count; with it, the
  // candidate orders between min-choices and max-choices of them, up to all.
  const ordered = descriptor.kind === "order-interaction" || descriptor.kind === "graphic-order-interaction";
  const total = descriptor.choices.length;
  const min = ordered ? (minChoices ?? total) : minChoices;
  const max = ordered ? (minChoices === undefined ? total : (maxChoices ?? total)) : maxChoices;
  const violations: ResponseViolation[] = [];
  if (identifiers.some((identifier) => !known.has(identifier))) violations.push("unknown-choice");
  if (new Set(identifiers).size !== identifiers.length) violations.push("repeated-choice");
  if (required === true && identifiers.length === 0) violations.push("required");
  return [...violations, ...bounds(identifiers.length, min, max, "min-choices", "max-choices")];
}

/**
 * Checks the points of a select point or position object interaction.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
function pointViolations(descriptor: InteractionDescriptor, value: Value | null): ResponseViolation[] {
  const { minChoices, maxChoices } = descriptor.constraints;
  return bounds(primitivesOf(value).length, minChoices, maxChoices, "min-choices", "max-choices");
}

/** Returns whether the match group of a choice, when it has one, allows the identifier. */
const allows = (choice: ChoiceDescriptor | undefined, identifier: string): boolean =>
  choice?.matchGroup === undefined || choice.matchGroup.includes(identifier);

/**
 * Checks the associations of a response: the pairs, how often each choice is used, and the match groups.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
function pairViolations(descriptor: InteractionDescriptor, value: Value | null): ResponseViolation[] {
  const pairs = pairsOf(primitivesOf(value));
  const [sources, targets] = descriptor.matchSets ?? [descriptor.choices, descriptor.choices];
  const identifiersOf = (set: readonly ChoiceDescriptor[] | undefined): Set<string> =>
    new Set((set ?? []).map((choice) => choice.identifier));
  const fromSet = identifiersOf(sources);
  const toSet = identifiersOf(targets);
  const byIdentifier = new Map(descriptor.choices.map((choice) => [choice.identifier, choice]));
  const uses = new Map<string, number>();
  for (const [first, second] of pairs) {
    for (const identifier of [first, second]) uses.set(identifier, (uses.get(identifier) ?? 0) + 1);
  }
  const gaps = descriptor.kind === "gap-match-interaction" ? toSet : new Set<string>();
  const violations: ResponseViolation[] = [];
  if (pairs.some(([first, second]) => !(fromSet.has(first) && toSet.has(second)))) violations.push("unknown-choice");
  violations.push(
    ...bounds(
      pairs.length,
      descriptor.constraints.minAssociations,
      descriptor.constraints.maxAssociations,
      "min-associations",
      "max-associations",
    ),
  );
  const overused = descriptor.choices.some((choice) => {
    const limit = gaps.has(choice.identifier) ? GAP_CAPACITY : choice.matchMax;
    return limit !== undefined && (uses.get(choice.identifier) ?? 0) > limit;
  });
  if (overused) violations.push("match-max");
  if (
    descriptor.choices.some(
      (choice) => choice.matchMin !== undefined && (uses.get(choice.identifier) ?? 0) < choice.matchMin,
    )
  ) {
    violations.push("match-min");
  }
  if (
    pairs.some(
      ([first, second]) => !(allows(byIdentifier.get(first), second) && allows(byIdentifier.get(second), first)),
    )
  ) {
    violations.push("match-group");
  }
  if (descriptor.choices.some((choice) => choice.required === true && (uses.get(choice.identifier) ?? 0) < 1)) {
    violations.push("required");
  }
  return violations;
}

/**
 * Returns the strings a text response holds and how many entries it has: a record is one entry.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
function textEntries(value: Value | null): { readonly texts: readonly string[]; readonly count: number } {
  if (value === null) return { texts: [], count: 0 };
  if (value.cardinality === "record") {
    const text = value.fields.get("stringValue");
    return { texts: typeof text?.value === "string" ? [text.value] : [], count: 1 };
  }
  const primitives = primitivesOf(value);
  return { texts: stringsOf(primitives), count: primitives.length };
}

/**
 * Checks the strings of a text entry or an extended text: their number and the pattern mask.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
function textViolations(descriptor: InteractionDescriptor, value: Value | null): ResponseViolation[] {
  const { minStrings, maxStrings, patternMask } = descriptor.constraints;
  const { texts, count } = textEntries(value);
  const violations = bounds(count, minStrings, maxStrings, "min-strings", "max-strings");
  if (patternMask !== undefined) {
    const pattern = compileXsdRegex(patternMask);
    if (!texts.every((text) => pattern.matches(text))) violations.push("pattern-mask");
  }
  return violations;
}

/**
 * Checks the number of a slider against its bounds and its step.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
function sliderViolations(descriptor: InteractionDescriptor, value: Value | null): ResponseViolation[] {
  const [number] = primitivesOf(value);
  if (typeof number !== "number") return [];
  const { lowerBound, upperBound, step } = descriptor.constraints;
  const violations: ResponseViolation[] = [];
  if ((lowerBound !== undefined && number < lowerBound) || (upperBound !== undefined && number > upperBound)) {
    violations.push("bounds");
  }
  if (step !== undefined && step > 0) {
    const steps = (number - (lowerBound ?? 0)) / step;
    if (Math.abs(steps - Math.round(steps)) > STEP_TOLERANCE * Math.max(1, Math.abs(steps))) violations.push("step");
  }
  return violations;
}

/**
 * Checks the number of plays of a media interaction.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
function playViolations(descriptor: InteractionDescriptor, value: Value | null): ResponseViolation[] {
  const [plays] = primitivesOf(value);
  const { minPlays, maxPlays } = descriptor.constraints;
  return bounds(typeof plays === "number" ? plays : 0, minPlays, maxPlays, "min-plays", "max-plays");
}

/** Returns the MIME type of a file without its parameters, in lower case: types are case-insensitive (RFC 2045). */
const essenceOf = (mimeType: string): string => (mimeType.split(";")[0] ?? "").trim().toLowerCase();

/**
 * Checks the type of an uploaded file.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
function uploadViolations(descriptor: InteractionDescriptor, value: Value | null): ResponseViolation[] {
  const [file] = primitivesOf(value);
  const { mimeTypes } = descriptor.constraints;
  if (typeof file !== "object" || !("mimeType" in file) || mimeTypes === undefined) return [];
  return mimeTypes.map(essenceOf).includes(essenceOf(file.mimeType)) ? [] : ["mime-type"];
}

function violationsOf(descriptor: InteractionDescriptor, value: Value | null): ResponseViolation[] {
  if (value !== null && !fits(descriptor, value)) return ["binding"];
  switch (descriptor.kind) {
    case "choice-interaction":
    case "graphic-order-interaction":
    case "hotspot-interaction":
    case "hottext-interaction":
    case "inline-choice-interaction":
    case "order-interaction":
      return selectionViolations(descriptor, value);
    case "position-object-interaction":
    case "select-point-interaction":
      return pointViolations(descriptor, value);
    case "associate-interaction":
    case "gap-match-interaction":
    case "graphic-associate-interaction":
    case "graphic-gap-match-interaction":
    case "match-interaction":
      return pairViolations(descriptor, value);
    case "extended-text-interaction":
    case "text-entry-interaction":
      return textViolations(descriptor, value);
    case "slider-interaction":
      return sliderViolations(descriptor, value);
    case "media-interaction":
      return playViolations(descriptor, value);
    case "upload-interaction":
      return uploadViolations(descriptor, value);
    default:
      return [];
  }
}

/**
 * Checks a response against what its interaction demands of a valid one: the minimum and maximum of choices,
 * associations, strings and plays; that identifiers and pairs name the choices of the interaction; `match-min` and
 * `match-max` of each choice, where 0 is no limit; the `match-group`s; `required` gaps and inline choices; the
 * `pattern-mask`; the bounds and step of a slider; and the types an upload accepts.
 *
 * @remarks
 * `describeInteractions` gives the descriptor, and {@link presentChoices} one without the hidden choices, which is the
 * descriptor to check against.
 *
 * A text interaction bound to a number is checked for the number of entries but not for its `pattern-mask`, because the
 * text is not in the value (it is in the variable of `string-identifier`).
 *
 * @param descriptor - The descriptor of the interaction.
 * @param response - The response, or `null` for none.
 * @returns The status and the rules that the response breaks. NULL is `presented`, with the rules that a missing
 * response breaks, such as a `min-choices` of 1; it is never `notpresented`, which is for an item that was not shown.
 * @throws `DataError` when `descriptor` is not a descriptor or `response` is neither NULL nor a value.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 * @see {@link https://www.imsglobal.org/sites/default/files/spec/qti/v3/rr-bind/index.html | QTI 3.0 Results Reporting}
 */
export function checkResponse(descriptor: InteractionDescriptor, response: Value | null): ResponseCheck {
  checkDescriptor(descriptor);
  const value = response === null ? null : normalizeValue(response);
  const reasons = [...new Set(violationsOf(descriptor, value))];
  const status = value === null ? "presented" : reasons.length === 0 ? "answered" : "attempted";
  return { status, reasons };
}
