import type { OutcomeDeclaration, ResponseDeclaration } from "../asi/index.js";
import { checkArray, describe, parseWith } from "../checks.js";
import { DataError, SecurityError } from "../errors.js";
import { DEFAULT_KEY_LIMITS, type ExpressionKey, type NumberKey, type ScoredResponse } from "../keys/index.js";
import { deriveEarlierReading } from "../operators/internal.js";
import { BUILT_IN_CONTEXTS, BUILT_IN_OUTCOMES, BUILT_IN_RESPONSES } from "../processing/internal.js";
import type { CompileScoringOptions, InteractionAttributes, ItemScoring } from "./item-scoring.js";
import {
  and,
  chain,
  compare,
  divide,
  float,
  identifier,
  integer,
  isNull,
  max,
  multiple,
  product,
  type Rules,
  setOutcome,
  setPoints,
  sum,
  variable,
} from "./qti.js";
import {
  type CompileOptionsData,
  choiceKeySchema,
  choiceMappingKeySchema,
  choiceMarkingKeySchema,
  compileScoringOptionsSchema,
  mappedAreasKeySchema,
  orderKeySchema,
  pairsKeySchema,
  type ScoredResponseData,
  scoredResponseSchema,
} from "./schemas.js";
import {
  choiceMappingScheme,
  choiceMarkingScheme,
  choiceScheme,
  expressionScheme,
  keyedAreasScheme,
  mappedAreasScheme,
  numberScheme,
  orderScheme,
  pairsScheme,
  type Scheme,
  textScheme,
} from "./schemes.js";

/** The outcomes that `compileScoring` declares, which no response may take as its identifier. */
const SCORE = "SCORE";
const MAXSCORE = "MAXSCORE";
const FEEDBACK = "FEEDBACK";
/** The prefix of the outcome of each response when an item has several. */
const SCORE_PREFIX = "SCORE_";
/**
 * The most characters of a response's identifier when an item has several, so that `SCORE_<identifier>` keeps to the 32
 * characters of an identifier that `validate` warns past (`assesskit/validate/identifier-style`).
 */
const MAX_PART_IDENTIFIER = 32 - SCORE_PREFIX.length;
/**
 * The share of its maximum at which a response earns the whole of it: a sum of floats, such as the points of a mapping,
 * may fall short of the maximum in its last bits.
 */
const FULL = 1 - 1e-12;

/** A response compiled: its scheme, the outcome that holds its points, and its points scaled to `maxPoints` and `weight`. */
interface Part {
  readonly identifier: string;
  readonly scheme: Scheme;
  readonly outcome: string;
  /** The points of the response at the key's maximum. */
  readonly maximum: number;
  /** The least points of the response. */
  readonly minimum: number;
  /** Whether a host supplies the outcome, in the portable form of an operator's key. */
  readonly external: boolean;
}

/** Throws when a count passes a limit. */
function checkLimit(count: number, what: string, limit: "responses" | "entries"): void {
  const maximum = DEFAULT_KEY_LIMITS[limit];
  if (count > maximum)
    throw new SecurityError(`${what} ${count}, over the limit ${limit} of ${maximum}.`, limit, maximum);
}

/** The entries of a key that QTI scores, counted before it is read: its keys, options, pairs, choices or areas. */
function entriesOf(key: Readonly<Record<string, unknown>>): number {
  const length = (value: unknown) => (Array.isArray(value) ? value.length : 0);
  switch (key.kind) {
    case "choice":
    case "choice-marking":
      return length(key.keys);
    case "choice-mapping":
      return typeof key.points === "object" && key.points !== null ? Object.keys(key.points).length : 0;
    case "pairs":
      return Math.max(length(key.pairs), length(key.points));
    case "order":
      return length(key.order);
    case "areas":
      return Array.isArray(key.areas)
        ? key.areas.reduce<number>(
            (total, area: unknown) =>
              total + 1 + (typeof area === "object" && area !== null ? length(Reflect.get(area, "coords")) / 4 : 0),
            0,
          )
        : 0;
    default:
      return 0;
  }
}

/**
 * Compiles the key of a response by its kind, reading it with the schema of the kind; a follow-through reads its earlier
 * response as the key of that response reads it.
 */
function compileKey(
  response: ScoredResponseData,
  original: ScoredResponse,
  label: string,
  earlier: ReadonlyMap<string, ScoredResponse["key"]>,
): Scheme {
  const { identifier: id, key } = response;
  const followThrough = original.followThrough;
  if (followThrough !== undefined && key.kind !== "number" && key.kind !== "expression")
    throw new DataError(`${label}: followThrough is for a number or an expression key alone.`);
  const from = followThrough === undefined ? undefined : earlier.get(followThrough.from);
  const reading = from === undefined ? null : deriveEarlierReading(from);
  switch (key.kind) {
    case "choice":
      return choiceScheme(id, parseWith(choiceKeySchema, key, `The key of ${label}`));
    case "choice-mapping":
      return choiceMappingScheme(id, parseWith(choiceMappingKeySchema, key, `The key of ${label}`));
    case "choice-marking":
      return choiceMarkingScheme(id, parseWith(choiceMarkingKeySchema, key, `The key of ${label}`));
    case "pairs":
      return pairsScheme(id, parseWith(pairsKeySchema, key, `The key of ${label}`));
    case "order":
      return orderScheme(id, parseWith(orderKeySchema, key, `The key of ${label}`));
    case "areas":
      return key.scheme === "keyed"
        ? keyedAreasScheme(id, original.key as Extract<ScoredResponse["key"], { kind: "areas" }>)
        : mappedAreasScheme(id, parseWith(mappedAreasKeySchema, key, `The key of ${label}`));
    case "text":
      return textScheme(id, original.key as Extract<ScoredResponse["key"], { kind: "text" }>);
    case "number":
      return numberScheme(id, original.key as NumberKey, followThrough, reading);
    case "expression":
      return expressionScheme(id, original.key as ExpressionKey, followThrough, reading);
  }
}

/** Adds the response to an error of its key, keeping the error's class, limit and cause. */
function withResponse(error: unknown, label: string): unknown {
  if (error instanceof SecurityError)
    return new SecurityError(`${label}: ${error.message}`, error.limit, error.maximum, { cause: error });
  if (error instanceof DataError && !error.message.startsWith(label))
    return new DataError(`${label}: ${error.message}`, { cause: error });
  return error;
}

/** Checks the identifier of a response against the outcomes and the other responses. */
function checkIdentifier(id: string, label: string, taken: ReadonlySet<string>, several: boolean): void {
  if (
    id === SCORE ||
    id === MAXSCORE ||
    id === FEEDBACK ||
    BUILT_IN_RESPONSES.has(id) ||
    BUILT_IN_OUTCOMES.has(id) ||
    BUILT_IN_CONTEXTS.has(id)
  )
    throw new DataError(`${label} takes the identifier ${id}, which is an outcome of the item or a built-in variable.`);
  if (taken.has(id)) throw new DataError(`${label} takes the identifier ${id}, which another response has.`);
  if (several && id.length > MAX_PART_IDENTIFIER)
    throw new DataError(
      `${label} has the identifier ${id} of ${id.length} characters; with several responses an identifier has at most ${MAX_PART_IDENTIFIER}, so that ${SCORE_PREFIX}${id} keeps to 32.`,
    );
}

/** Checks a follow-through: from an earlier response whose key is a number without units or an expression. */
function checkFollowThrough(
  response: ScoredResponse,
  label: string,
  earlier: ReadonlyMap<string, ScoredResponse["key"]>,
): void {
  const { followThrough } = response;
  if (followThrough === undefined) return;
  const from: unknown = followThrough.from;
  const key = typeof from === "string" ? earlier.get(from) : undefined;
  if (key === undefined)
    throw new DataError(`${label} follows through from ${String(from)}, which is no earlier response of the item.`);
  const single =
    key.kind === "number" && Object.keys(key.units ?? {}).length === 0 && (key.components ?? null) === null;
  if (!single && key.kind !== "expression")
    throw new DataError(
      `${label} follows through from ${String(from)}, whose key is not an expression or a number without units or components, so its response does not read as an expression.`,
    );
}

/** Rules that add a value to `FEEDBACK`. */
function addFeedback(value: string): Rules {
  return [setOutcome(FEEDBACK, multiple([variable(FEEDBACK), identifier(value)]))];
}

/** The rules of `FEEDBACK` for a response: blank, else correct, partial or incorrect by its points. */
function feedbackRules(part: Part): Rules {
  const blank = isNull(variable(part.identifier));
  if (part.external) return [chain([[blank, addFeedback(`${part.identifier}-blank`)]])];
  const points = variable(part.outcome);
  return [
    chain(
      [
        [blank, addFeedback(`${part.identifier}-blank`)],
        [compare("gte", points, float(part.maximum * FULL)), addFeedback(`${part.identifier}-correct`)],
        [compare("gt", points, integer(0)), addFeedback(`${part.identifier}-partial`)],
      ],
      addFeedback(`${part.identifier}-incorrect`),
    ),
  ];
}

/** The rules that set a response's outcome to its points, scaled from the key's maximum to the response's. */
function scoreRules(part: Part): Rules {
  if (part.external) return [];
  const { scoring, maximum: own } = part.scheme;
  if (scoring.kind === "share")
    return setPoints(part.outcome, part.maximum === 1 ? scoring.call : product([scoring.call, float(part.maximum)]));
  const scaled = divide(product([variable(part.outcome), float(part.maximum)]), float(own));
  return [...scoring.rules(part.outcome), ...(part.maximum === own ? [] : [setOutcome(part.outcome, scaled)])];
}

/** The declaration of an outcome of points: a float, its normal range, and whether a host supplies it. */
function pointsOutcome(id: string, maximum: number, minimum: number, external: boolean): OutcomeDeclaration {
  return {
    kind: "outcome-declaration",
    identifier: id,
    cardinality: "single",
    baseType: "float",
    normalMaximum: maximum,
    ...(minimum < 0 ? { normalMinimum: minimum } : {}),
    ...(external ? { externalScored: "externalMachine" } : {}),
  };
}

/** The rules of the item's total: the sum of several responses, all parts, and the floor. */
function totalRules(parts: readonly Part[], options: CompileOptionsData, maximum: number): Rules {
  const total = parts.length > 1 ? [setOutcome(SCORE, sum(parts.map(({ outcome }) => variable(outcome))))] : [];
  const allParts = options.allParts
    ? [
        chain(
          [
            [
              and(parts.map((part) => compare("gte", variable(part.outcome), float(part.maximum * FULL)))),
              [setOutcome(SCORE, float(maximum))],
            ],
          ],
          [setOutcome(SCORE, integer(0))],
        ),
      ]
    : [];
  const floor = options.floor === undefined ? [] : [setOutcome(SCORE, max([float(options.floor), variable(SCORE)]))];
  return [...total, ...allParts, ...floor];
}

/**
 * Compiles the keys of an item's responses into its response declarations, outcomes and response processing: QTI's own
 * expressions where they score a key exactly (a match, a mapping, an area mapping, an index, a contiguous `qti-contains`, an
 * equality with a tolerance), and an operator of `@assesskit/runtime/operators` where they cannot, written by
 * `buildOperatorCall`.
 *
 * Each response earns the key's share of its own maximum, scaled to `maxPoints` and multiplied by `weight`; with several
 * responses each has `SCORE_<identifier>`, and `SCORE` is their sum. `MAXSCORE` is the sum of the maxima. With `allParts` the
 * item earns its maximum only when every response earns its own, and `floor` bounds `SCORE` from below.
 *
 * @param responses - The scored responses of the item, in order; a follow-through names an earlier one.
 * @param options - The portable form, the floor and all parts.
 * @returns The declarations, the response processing, the attributes each interaction needs, and the operators called.
 * @throws `DataError` for a key that its scheme or its operator refuses, a response identifier that is not a QTI identifier,
 *   is taken twice or names an outcome or a built-in variable, a follow-through on another kind or from a response that is
 *   not earlier or reads as no expression, a floor above the maximum, or options that do not parse.
 * @throws `SecurityError` past the limits: responses an item, entries a key, characters a pattern.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, response processing}
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, SCORE and MAXSCORE}
 */
export function compileScoring(responses: readonly ScoredResponse[], options?: CompileScoringOptions): ItemScoring {
  const read = parseWith(compileScoringOptionsSchema, options, "The options of compileScoring");
  checkArray(responses, `The responses must be an array of scored responses, found ${describe(responses)}.`);
  checkLimit(responses.length, "compileScoring was given responses:", "responses");
  if (responses.length === 0) throw new DataError("compileScoring scores at least one response.");
  const several = responses.length > 1;
  const taken = new Set<string>();
  const earlier = new Map<string, ScoredResponse["key"]>();
  const parts = responses.map((original, at): Part => {
    const label = `The response at responses[${at}]`;
    const response = parseWith(scoredResponseSchema, original, label);
    const named = `The response ${response.identifier} at responses[${at}]`;
    checkIdentifier(response.identifier, named, taken, several);
    checkLimit(entriesOf(response.key), `${named} has a key of entries:`, "entries");
    checkFollowThrough(original, named, earlier);
    let scheme: Scheme;
    try {
      scheme = compileKey(response, original, named, earlier);
    } catch (error) {
      throw withResponse(error, named);
    }
    taken.add(response.identifier);
    earlier.set(response.identifier, original.key);
    const ownMaximum = response.maxPoints ?? scheme.maximum;
    const maximum = ownMaximum * response.weight;
    return {
      identifier: response.identifier,
      scheme,
      outcome: several ? `${SCORE_PREFIX}${response.identifier}` : SCORE,
      maximum,
      minimum: (scheme.minimum / scheme.maximum) * maximum,
      external: read.portable && scheme.scoring.kind === "share",
    };
  });
  if (several)
    for (const { outcome } of parts)
      if (taken.has(outcome))
        throw new DataError(`The response ${outcome} takes the identifier of the outcome of another response.`);
  const maximum = parts.reduce((total, part) => total + part.maximum, 0);
  if (read.floor !== undefined && read.floor > maximum)
    throw new DataError(`The option floor ${read.floor} is above the item's maximum of ${maximum}.`);
  const sumOfMinima = parts.reduce((total, part) => total + part.minimum, 0);
  const minimum = read.allParts ? 0 : Math.max(read.floor ?? sumOfMinima, sumOfMinima);
  const externalTotal = parts.some(({ external }) => external);
  const outcomes: OutcomeDeclaration[] = [
    pointsOutcome(SCORE, maximum, minimum, externalTotal),
    {
      kind: "outcome-declaration",
      identifier: MAXSCORE,
      cardinality: "single",
      baseType: "float",
      defaultValue: { kind: "default-value", values: [{ kind: "value", value: String(maximum) }] },
    },
    ...(several ? parts.map((part) => pointsOutcome(part.outcome, part.maximum, part.minimum, part.external)) : []),
    { kind: "outcome-declaration", identifier: FEEDBACK, cardinality: "multiple", baseType: "identifier" },
  ];
  const rules: Rules = [
    ...parts.flatMap(scoreRules),
    ...parts.flatMap(feedbackRules),
    ...(externalTotal ? [] : totalRules(parts, read, maximum)),
  ];
  const operators = new Set(
    parts.flatMap(({ scheme, external }) =>
      scheme.scoring.kind === "share" && !external ? [scheme.scoring.definition] : [],
    ),
  );
  const interactions = new Map<string, InteractionAttributes>(
    parts.map(({ identifier: id, scheme }) => [id, scheme.interactions]),
  );
  const declarations: ResponseDeclaration[] = parts.map(({ scheme }) => scheme.declaration);
  return {
    responseDeclarations: declarations,
    outcomeDeclarations: outcomes,
    responseProcessing: { kind: "response-processing", rules: [...rules] },
    interactions,
    operators: [...operators],
  };
}
