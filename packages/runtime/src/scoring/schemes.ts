import type { Expression, NumericExpression, ResponseDeclaration } from "../asi/index.js";
import { DataError } from "../errors.js";
import type { AreasKey, ExpressionKey, FollowThrough, KeyLimits, NumberKey, TextKey } from "../keys/index.js";
import { buildOperatorCall, OPERATOR_DEFINITIONS } from "../operators/index.js";
import {
  checkKeyLimits,
  type NumberKeyData,
  type PreparedText,
  readAreasKey,
  readExpressionKey,
  readNumberKey,
  readTextKey,
} from "../operators/internal.js";
import type { CustomOperatorExpression } from "../processing/index.js";
import type { InteractionAttributes } from "./item-scoring.js";
import {
  chain,
  compare,
  containerSize,
  correct,
  equal,
  float,
  identifier,
  index,
  integer,
  isNull,
  mapResponse,
  mapResponsePoint,
  max,
  or,
  ordered,
  product,
  type Rules,
  setOutcome,
  setPoints,
  subtract,
  sum,
  variable,
} from "./qti.js";
import type {
  ChoiceKeyData,
  ChoiceMappingKeyData,
  ChoiceMarkingKeyData,
  MappedAreasKeyData,
  OrderKeyData,
  PairsKeyData,
} from "./schemas.js";

/** How a key scores: rules that set an outcome to the key's points, or the share of them that an operator gives. */
type Scoring =
  | {
      readonly kind: "points";
      /** Sets the outcome to the key's points, never NULL. */
      readonly rules: (outcome: string) => Rules;
    }
  | {
      readonly kind: "share";
      /** The call of the operator, which gives a share from 0 to 1 or NULL. */
      readonly call: CustomOperatorExpression;
      /** The definition of the operator, which a host registers. */
      readonly definition: string;
    };

/** What a key compiles to, before the response's points and weight scale it. */
export interface Scheme {
  readonly declaration: ResponseDeclaration;
  readonly interactions: InteractionAttributes;
  /** The key's own maximum, above 0. */
  readonly maximum: number;
  /** The key's least points: 0, or below 0 for a negative mark. */
  readonly minimum: number;
  readonly scoring: Scoring;
}

/** The declaration of a response, with a correct response when it has values. */
function declare(
  response: string,
  cardinality: "single" | "multiple" | "ordered",
  baseType: "identifier" | "pair" | "directedPair" | "point" | "string" | "float",
  values: readonly string[],
  tables: Pick<ResponseDeclaration, "mapping" | "areaMapping"> = {},
): ResponseDeclaration {
  const kept = cardinality === "single" ? values.slice(0, 1) : values;
  return {
    kind: "response-declaration",
    identifier: response,
    cardinality,
    baseType,
    ...(kept.length === 0
      ? {}
      : { correctResponse: { kind: "correct-response", values: kept.map((value) => ({ kind: "value", value })) } }),
    ...tables,
  };
}

/** The mapping of a key: the points of each value, the default of others, and the bounds of a container's sum. */
function mapping(
  entries: readonly (readonly [string, number])[],
  defaultValue: number,
  bounds?: { readonly lower: number; readonly upper: number },
): NonNullable<ResponseDeclaration["mapping"]> {
  return {
    kind: "mapping",
    defaultValue,
    ...(bounds === undefined ? {} : { lowerBound: bounds.lower, upperBound: bounds.upper }),
    mapEntries: entries.map(([mapKey, mappedValue]) => ({ kind: "map-entry", mapKey, mappedValue })),
  };
}

/** Rules that set the outcome to 1 when a test holds, and to 0 otherwise. */
function rightOrWrong(test: Expression): (outcome: string) => Rules {
  return (outcome) => [chain([[test, [setOutcome(outcome, integer(1))]]], [setOutcome(outcome, integer(0))])];
}

/** Rules that count the tests that hold, a point each. */
function counted(tests: readonly Expression[]): (outcome: string) => Rules {
  return (outcome) => [
    setOutcome(outcome, integer(0)),
    ...tests.map((test) => chain([[test, [setOutcome(outcome, sum([variable(outcome), integer(1)]))]]])),
  ];
}

/** The `max(0, …)` of an expression, the floor of a share. */
function floored(expression: NumericExpression): NumericExpression {
  return max([integer(0), expression]);
}

/** The sum of the `count` highest positive values. */
function bestSum(values: readonly number[], count: number): number {
  return [...values]
    .filter((value) => value > 0)
    .sort((a, b) => b - a)
    .slice(0, count)
    .reduce((total, value) => total + value, 0);
}

/** The entries with the `count` highest positive points, the highest first and in their order among equals. */
function bestEntries<T>(entries: readonly (readonly [T, number])[], count: number): T[] {
  return entries
    .map(([value, points], at) => ({ value, points, at }))
    .filter(({ points }) => points > 0)
    .sort((a, b) => b.points - a.points || a.at - b.at)
    .slice(0, count)
    .map(({ value }) => value);
}

/** A key scored all or nothing: `qti-match` of the response and its correct response. */
function allOrNothing(response: string, declaration: ResponseDeclaration, interactions: InteractionAttributes): Scheme {
  return {
    declaration,
    interactions,
    maximum: 1,
    minimum: 0,
    scoring: { kind: "points", rules: rightOrWrong(compare("match", variable(response), correct(response))) },
  };
}

/** A choice scored by its mapping, floored at 0. */
function mappedChoice(response: string, declaration: ResponseDeclaration, maxChoices: number, maximum: number): Scheme {
  return {
    declaration,
    interactions: { maxChoices },
    maximum,
    minimum: 0,
    scoring: { kind: "points", rules: (outcome) => setPoints(outcome, floored(mapResponse(response))) },
  };
}

/** A `DataError` about a field of a key, naming its path. */
function keyError(field: string, message: string): DataError {
  return new DataError(`The key is invalid at ${field}: ${message}`);
}

/** The maximum of a key, refused when nothing earns points. */
function positiveMaximum(maximum: number, field: string): number {
  if (!(maximum > 0)) throw keyError(field, "no response earns points.");
  return maximum;
}

/**
 * `choice`: `all-or-nothing` matches the correct response; `partial` and `per-key` map each key to 1, and each other option
 * to −1 or 0, floored at 0.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-match and qti-map-response}
 */
export function choiceScheme(response: string, key: ChoiceKeyData): Scheme {
  const maxChoices = key.maxChoices ?? key.keys.length;
  const cardinality = maxChoices === 1 ? "single" : "multiple";
  if (key.scheme === "all-or-nothing") {
    if (maxChoices < key.keys.length)
      throw keyError(
        "maxChoices",
        `maxChoices ${maxChoices} is below the ${key.keys.length} keys, so no response is right.`,
      );
    return allOrNothing(response, declare(response, cardinality, "identifier", key.keys), { maxChoices });
  }
  const maximum = Math.min(key.keys.length, maxChoices);
  const other = key.scheme === "partial" ? -1 : 0;
  const table = mapping(
    key.keys.map((value) => [value, 1]),
    other,
    { lower: 0, upper: maximum },
  );
  const declaration = declare(response, cardinality, "identifier", key.keys.slice(0, maximum), { mapping: table });
  return mappedChoice(response, declaration, maxChoices, maximum);
}

/**
 * `choice-mapping`: QTI's `qti-map-response` of the options' points, floored at 0; its maximum is the best sum within
 * `maxChoices`.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-map-response}
 */
export function choiceMappingScheme(response: string, key: ChoiceMappingKeyData): Scheme {
  const entries = [...key.points];
  const maximum = positiveMaximum(
    bestSum(
      entries.map(([, points]) => points),
      key.maxChoices,
    ),
    "points",
  );
  const declaration = declare(
    response,
    key.maxChoices === 1 ? "single" : "multiple",
    "identifier",
    bestEntries(entries, key.maxChoices),
    { mapping: mapping(entries, 0, { lower: 0, upper: maximum }) },
  );
  return mappedChoice(response, declaration, key.maxChoices, maximum);
}

/**
 * `choice-marking`: `blank` with nothing selected, else `correct` for each key and `wrong` for each other option selected, by
 * QTI's `qti-map-response`, not floored.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-map-response}
 */
export function choiceMarkingScheme(response: string, key: ChoiceMarkingKeyData): Scheme {
  const maxChoices = key.maxChoices ?? key.keys.length;
  const maximum = key.correct * Math.min(key.keys.length, maxChoices);
  const lowest = key.wrong < 0 ? key.wrong * maxChoices : 0;
  const table = mapping(
    key.keys.map((value) => [value, key.correct]),
    key.wrong,
  );
  return {
    declaration: declare(
      response,
      maxChoices === 1 ? "single" : "multiple",
      "identifier",
      key.keys.slice(0, maxChoices),
      {
        mapping: table,
      },
    ),
    interactions: { maxChoices },
    maximum,
    minimum: Math.min(key.blank, lowest),
    scoring: {
      kind: "points",
      rules: (outcome) => [
        chain(
          [[isNull(variable(response)), [setOutcome(outcome, float(key.blank))]]],
          [setOutcome(outcome, mapResponse(response))],
        ),
      ],
    },
  };
}

/** The text of a pair as a QTI value, and the text that is the same for both orders of an unordered pair. */
function pairTexts(pair: readonly [string, string], directed: boolean): { value: string; same: string } {
  const value = `${pair[0]} ${pair[1]}`;
  return { value, same: directed || pair[0] <= pair[1] ? value : `${pair[1]} ${pair[0]}` };
}

/**
 * `pairs`: `all-or-nothing` matches the correct response; `per-pair` and `mapping` map each key pair to its points, less
 * `surplus` for each pair past the key's count, floored at 0.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-map-response and qti-container-size}
 */
export function pairsScheme(response: string, key: PairsKeyData): Scheme {
  const count = key.pairs.length;
  const texts = key.pairs.map((pair, at) => {
    if (pair[0] === pair[1]) throw keyError(`pairs[${at}]`, `a pair joins two choices, found ${pair[0]} twice.`);
    return pairTexts(pair, key.directed);
  });
  const seen = new Set<string>();
  texts.forEach(({ same }, at) => {
    if (seen.has(same)) throw keyError(`pairs[${at}]`, `the pair ${same} is given twice.`);
    seen.add(same);
  });
  if ((key.scheme === "mapping") !== (key.points !== undefined))
    throw keyError("points", "points are given with the scheme mapping, and with it alone.");
  if (key.points !== undefined && key.points.length !== count)
    throw keyError(
      "points",
      `the scheme mapping gives points to each of the ${count} pairs, found ${key.points.length}.`,
    );
  const maxPairs = key.maxPairs ?? count;
  const interactions: InteractionAttributes = {
    maxAssociations: maxPairs,
    matchMax: {
      source: key.maxPerSource ?? 0,
      target: key.maxPerTarget ?? (key.reuse ? 0 : 1),
      ...(key.none === undefined ? {} : { none: 0 }),
    },
  };
  const baseType = key.directed ? "directedPair" : "pair";
  const values = texts.map(({ value }) => value);
  if (key.scheme === "all-or-nothing") {
    if (maxPairs < count)
      throw keyError("maxPairs", `maxPairs ${maxPairs} is below the ${count} pairs, so no response is right.`);
    return allOrNothing(response, declare(response, "multiple", baseType, values), interactions);
  }
  const points = key.points ?? values.map(() => 1);
  const entries = values.map((value, at): [string, number] => [value, points[at] ?? 0]);
  const maximum = positiveMaximum(bestSum(points, maxPairs), "points");
  const mapped = mapResponse(response);
  const surplus = subtract(
    mapped,
    product([float(key.surplus), max([integer(0), subtract(containerSize(variable(response)), integer(count))])]),
  );
  return {
    declaration: declare(response, "multiple", baseType, bestEntries(entries, maxPairs), {
      mapping: mapping(entries, 0, { lower: 0, upper: maximum }),
    }),
    interactions,
    maximum,
    minimum: 0,
    scoring: {
      kind: "points",
      rules: (outcome) => setPoints(outcome, key.surplus > 0 ? floored(surplus) : mapped),
    },
  };
}

/**
 * `order`: `all-or-nothing` matches the correct response; `per-position` counts the positions whose choice is the key's, by
 * `qti-index`; `adjacent-pairs` counts the key's neighbors that stand next to each other in order, by `qti-contains` of an
 * ordered pair, which holds for a contiguous run.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-index and qti-contains}
 */
export function orderScheme(response: string, key: OrderKeyData): Scheme {
  const declaration = declare(response, "ordered", "identifier", key.order);
  const answered = variable(response);
  switch (key.scheme) {
    case "all-or-nothing":
      return allOrNothing(response, declaration, {});
    case "per-position":
      return {
        declaration,
        interactions: {},
        maximum: key.order.length,
        minimum: 0,
        scoring: {
          kind: "points",
          rules: counted(key.order.map((choice, at) => compare("match", index(answered, at + 1), identifier(choice)))),
        },
      };
    case "adjacent-pairs": {
      if (key.order.length < 2) throw keyError("order", "adjacent pairs need an order of at least two choices.");
      const tests = key.order
        .slice(1)
        .map((after, at) =>
          compare("contains", answered, ordered([identifier(key.order[at] ?? ""), identifier(after)])),
        );
      return {
        declaration,
        interactions: {},
        maximum: tests.length,
        minimum: 0,
        scoring: { kind: "points", rules: counted(tests) },
      };
    }
  }
}

/**
 * `areas` with `mapping`: QTI's `qti-map-response-point` over an area mapping, each area counted once, up to the best sum
 * of `select` areas.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-map-response-point}
 */
export function mappedAreasScheme(response: string, key: MappedAreasKeyData): Scheme {
  const select = key.select ?? key.areas.length;
  if (select > key.areas.length) throw keyError("select", `select ${select} is above the ${key.areas.length} areas.`);
  const maximum = positiveMaximum(
    bestSum(
      key.areas.map(({ points }) => points),
      select,
    ),
    "areas",
  );
  return {
    declaration: declare(response, "multiple", "point", [], {
      areaMapping: {
        kind: "area-mapping",
        defaultValue: 0,
        lowerBound: 0,
        upperBound: maximum,
        areaMapEntries: key.areas.map(({ shape, coords, points }) => ({
          kind: "area-map-entry",
          shape,
          coords: coords.join(","),
          mappedValue: points,
        })),
      },
    }),
    interactions: { maxChoices: select },
    maximum,
    minimum: 0,
    scoring: { kind: "points", rules: (outcome) => setPoints(outcome, mapResponsePoint(response)) },
  };
}

/** A tolerance of `qti-equal` in percent, from a share, read from its shortest decimal form so that 0.05 is 5. */
function percentOf(share: number): number {
  const [mantissa = "0", exponent = "0"] = String(share).split("e");
  return Number(`${mantissa}e${Number(exponent) + 2}`);
}

/** Whether a number key is what QTI's own `qti-equal` scores: a value and a tolerance, with no other field. */
function isPlainNumber(key: NumberKeyData, followThrough: FollowThrough | undefined): boolean {
  return (
    followThrough === undefined &&
    key.decimalSeparator === "." &&
    key.units.size === 0 &&
    !key.fractions &&
    key.significantFigures === null &&
    key.credit.length === 0 &&
    key.intervals === null &&
    key.components === null
  );
}

/** A number as a response writes it, with the key's decimal mark. */
function written(value: number, separator: "." | ","): string {
  return separator === "," ? String(value).replace(".", ",") : String(value);
}

/** A plain number: QTI's `qti-equal` of the value and a float response, with the tolerance's ranges joined by `qti-or`. */
function plainNumberScheme(response: string, read: NumberKeyData): Scheme {
  const value = float(read.value);
  const { absolute, relative } = read.tolerance;
  const tests = [
    ...(absolute === null ? [] : [equal(value, variable(response), "absolute", absolute)]),
    ...(relative === null ? [] : [equal(value, variable(response), "relative", percentOf(relative))]),
  ];
  const [only] = tests;
  const test = only === undefined ? equal(value, variable(response), "exact") : tests.length === 1 ? only : or(tests);
  return {
    declaration: declare(response, "single", "float", [String(read.value)]),
    interactions: {},
    maximum: 1,
    minimum: 0,
    scoring: { kind: "points", rules: rightOrWrong(test) },
  };
}

/** The correct response of a number key that an operator scores: its components, or its value, none with intervals. */
function numberValues(read: NumberKeyData): string[] {
  if (read.components !== null) return read.components.map((component) => written(component, read.decimalSeparator));
  return read.intervals === null ? [written(read.value, read.decimalSeparator)] : [];
}

/**
 * `number`: QTI's `qti-equal` of the value and a float response, with the tolerance's absolute and relative ranges, when
 * the key has no other field; else `number-equivalent`.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-equal}
 */
export function numberScheme(
  response: string,
  key: NumberKey,
  followThrough: FollowThrough | undefined,
  limits: KeyLimits,
): Scheme {
  const read = readNumberKey(key, followThrough);
  checkKeyLimits(read, "key", limits);
  if (isPlainNumber(read, followThrough)) return plainNumberScheme(response, read);
  return {
    declaration: declare(response, read.components === null ? "single" : "ordered", "string", numberValues(read)),
    interactions: read.components === null ? {} : { maxStrings: read.components.length },
    maximum: 1,
    minimum: 0,
    scoring: {
      kind: "share",
      call: buildOperatorCall(
        { operator: "number-equivalent", key, ...(followThrough && { followThrough }) },
        response,
      ),
      definition: OPERATOR_DEFINITIONS["number-equivalent"],
    },
  };
}

/** The first text of each of the `count` answers of most points, when each has a text. */
function bestTexts(prepared: PreparedText): string[] {
  const best = prepared.key.answers
    .map((answer, at) => ({ answer, at }))
    .sort((a, b) => b.answer.points - a.answer.points || a.at - b.at)
    .slice(0, prepared.key.count)
    .map(({ answer }) => answer.texts[0]);
  return best.every((text) => text !== undefined) ? best.flatMap((text) => text ?? []) : [];
}

/** `text`: `text-equivalent`, whose share is of the points of the `count` answers of most points. */
export function textScheme(response: string, key: TextKey, limits: KeyLimits): Scheme {
  const prepared = readTextKey(key);
  checkKeyLimits(prepared.key, "key", limits);
  const several = prepared.key.scheme === "forms" && prepared.key.count > 1;
  return {
    declaration: declare(response, several ? "multiple" : "single", "string", bestTexts(prepared)),
    interactions: several ? { maxStrings: prepared.key.count } : {},
    maximum: prepared.maximum,
    minimum: 0,
    scoring: {
      kind: "share",
      call: buildOperatorCall({ operator: "text-equivalent", key }, response),
      definition: OPERATOR_DEFINITIONS["text-equivalent"],
    },
  };
}

/** `expression`: `expression-equivalent`, right or wrong. */
export function expressionScheme(
  response: string,
  key: ExpressionKey,
  followThrough: FollowThrough | undefined,
  limits: KeyLimits,
): Scheme {
  checkKeyLimits(readExpressionKey(key, followThrough), "key", limits);
  const call = buildOperatorCall(
    { operator: "expression-equivalent", key, ...(followThrough && { followThrough }) },
    response,
  );
  return {
    declaration: declare(response, "single", "string", [key.expression]),
    interactions: {},
    maximum: 1,
    minimum: 0,
    scoring: { kind: "share", call, definition: OPERATOR_DEFINITIONS["expression-equivalent"] },
  };
}

/** `areas` with `keyed`: `hotspot-matching`, whose share is of `select` areas, a point each. */
export function keyedAreasScheme(response: string, key: AreasKey, limits: KeyLimits): Scheme {
  const read = readAreasKey(key);
  checkKeyLimits(read, "key", limits);
  return {
    declaration: declare(response, read.select === 1 ? "single" : "multiple", "point", []),
    interactions: { maxChoices: read.select },
    maximum: read.select,
    minimum: 0,
    scoring: {
      kind: "share",
      call: buildOperatorCall({ operator: "hotspot-matching", key: { ...key, scheme: "keyed" } }, response),
      definition: OPERATOR_DEFINITIONS["hotspot-matching"],
    },
  };
}
