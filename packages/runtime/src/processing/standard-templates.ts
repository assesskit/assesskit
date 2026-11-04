import type { Expression, ResponseProcessing, ResponseRule } from "../asi/index.js";

/**
 * The address of the standard response processing templates, before their file names.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
const TEMPLATE_BASE = "https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/";

/**
 * The file name of each standard template.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
type TemplateName =
  | "match_correct"
  | "map_response"
  | "map_response_point"
  | "CC2_match"
  | "CC2_match_basic"
  | "CC2_map_response";

/**
 * The templates that QTI 2.x template URIs name: the three algorithms of QTI 2.x.
 *
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
 */
const QTI2_TEMPLATES: readonly TemplateName[] = ["match_correct", "map_response", "map_response_point"];

/**
 * A QTI 3.0 template URI: `http` or `https`, the address of 1EdTech's purl or of its earlier question area, a file name
 * and `.xml` or nothing (as the 1EdTech examples write them).
 */
const QTI3_URI =
  /^https?:\/\/(?:purl\.imsglobal\.org\/spec\/qti\/v3p0\/rptemplates|www\.imsglobal\.org\/question\/qti_v3p0\/rptemplates)\/([A-Za-z0-9_]+?)(?:\.xml)?$/;

/**
 * A QTI 2.0, 2.1 or 2.2 template URI.
 *
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
 */
const QTI2_URI = /^https?:\/\/www\.imsglobal\.org\/question\/qti_v2p[012]\/rptemplates\/([A-Za-z0-9_]+?)(?:\.xml)?$/;

const variable = (identifier: string): Expression => ({ kind: "variable", identifier });
const float = (value: string): Expression => ({ kind: "base-value", baseType: "float", value });
const identifier = (value: string): Expression => ({ kind: "base-value", baseType: "identifier", value });
const set = (outcome: string, expression: Expression): ResponseRule => ({
  kind: "set-outcome-value",
  identifier: outcome,
  expression,
});
const isNull = (operand: Expression): Expression => ({ kind: "is-null", operand });
const responseMatches: Expression = {
  kind: "match",
  operands: [variable("RESPONSE"), { kind: "correct", identifier: "RESPONSE" }],
};

/** `if (condition) then; else otherwise` as a response condition. */
function ifElse(
  condition: Expression,
  then: readonly ResponseRule[],
  otherwise: readonly ResponseRule[],
): ResponseRule {
  return {
    kind: "response-condition",
    responseIf: { kind: "response-if", condition, rules: then },
    responseElseIfs: [],
    responseElse: { kind: "response-else", rules: otherwise },
  };
}

const processing = (rules: readonly ResponseRule[]): ResponseProcessing => ({ kind: "response-processing", rules });

/** The rules of each template, as the published files give them. */
const TEMPLATES: ReadonlyMap<TemplateName, ResponseProcessing> = new Map<TemplateName, ResponseProcessing>([
  ["match_correct", processing([ifElse(responseMatches, [set("SCORE", float("1"))], [set("SCORE", float("0"))])])],
  [
    "map_response",
    processing([
      ifElse(
        isNull(variable("RESPONSE")),
        [set("SCORE", float("0.0"))],
        [set("SCORE", { kind: "map-response", identifier: "RESPONSE" })],
      ),
    ]),
  ],
  [
    "map_response_point",
    processing([
      ifElse(
        isNull(variable("RESPONSE")),
        [set("SCORE", float("0"))],
        [set("SCORE", { kind: "map-response-point", identifier: "RESPONSE" })],
      ),
    ]),
  ],
  ["CC2_match", processing([ifElse(responseMatches, [set("SCORE", float("1"))], [set("SCORE", float("0"))])])],
  [
    "CC2_match_basic",
    processing([
      ifElse(
        responseMatches,
        [set("SCORE", variable("MAXSCORE")), set("FEEDBACKBASIC", identifier("correct"))],
        [set("FEEDBACKBASIC", identifier("incorrect"))],
      ),
    ]),
  ],
  [
    "CC2_map_response",
    processing([
      ifElse(
        isNull(variable("RESPONSE")),
        [set("SCORE", float("0.0"))],
        [set("SCORE", { kind: "map-response", identifier: "RESPONSE" })],
      ),
      ifElse(
        { kind: "equal", toleranceMode: "exact", operands: [variable("MAXSCORE"), variable("SCORE")] },
        [set("FEEDBACK", identifier("correct"))],
        [set("FEEDBACK", identifier("incorrect"))],
      ),
    ]),
  ],
]);

/**
 * The six standard response processing templates, by their URIs
 * `https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/<name>.xml`: `match_correct`, `map_response`,
 * `map_response_point`, `CC2_match`, `CC2_match_basic` and `CC2_map_response`.
 *
 * @remarks
 * Each is the model of the published file.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export const STANDARD_TEMPLATES: ReadonlyMap<string, ResponseProcessing> = new Map(
  [...TEMPLATES].map(([name, template]) => [`${TEMPLATE_BASE}${name}.xml`, template]),
);

function isTemplateName(name: string | undefined, names: Iterable<TemplateName>): name is TemplateName {
  return [...names].some((known) => known === name);
}

/**
 * Returns the key in {@link STANDARD_TEMPLATES} of a URI that names a standard template, `undefined` for any other URI:
 * `http` or `https`, `purl.imsglobal.org/spec/qti/v3p0/rptemplates/` or
 * `www.imsglobal.org/question/qti_v3p0/rptemplates/`, and the file name with `.xml` or without.
 *
 * @remarks
 * A QTI 2.0, 2.1 or 2.2 URI such as `http://www.imsglobal.org/question/qti_v2p1/rptemplates/match_correct` names the
 * template of the same algorithm.
 *
 * @param uri - The URI of a response processing template.
 * @returns The key, or `undefined`.
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
 */
export function findStandardTemplate(uri: string): string | undefined {
  const qti3 = QTI3_URI.exec(uri)?.[1];
  const qti2 = QTI2_URI.exec(uri)?.[1];
  const name = isTemplateName(qti3, TEMPLATES.keys()) ? qti3 : isTemplateName(qti2, QTI2_TEMPLATES) ? qti2 : undefined;
  return name === undefined ? undefined : `${TEMPLATE_BASE}${name}.xml`;
}

/**
 * Returns whether a URI is the address of a QTI 2.0, 2.1 or 2.2 response processing template, such as
 * `http://www.imsglobal.org/question/qti_v2p1/rptemplates/match_correct`, whose algorithm the runtime applies from the
 * standard templates.
 *
 * @param uri - The URI of a response processing template.
 * @returns `true` for a URI of QTI 2.
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
 */
export function isQti2TemplateUri(uri: string): boolean {
  return findStandardTemplate(uri) !== undefined && QTI2_URI.test(uri);
}
