import type { VariableType } from "./assign.js";

/**
 * The built-in response variable that counts the attempts.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export const NUM_ATTEMPTS = "numAttempts";

/**
 * The built-in response variable that holds the time spent, in seconds.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export const DURATION = "duration";

/**
 * The built-in outcome that says whether the item is completed.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export const COMPLETION_STATUS = "completionStatus";

/**
 * The built-in context variable, a record of string fields.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export const QTI_CONTEXT = "QTI_CONTEXT";

/**
 * The value `completionStatus` starts with.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export const NOT_ATTEMPTED = "not_attempted";

/**
 * The values `completionStatus` may have.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export const COMPLETION_STATUSES: readonly string[] = ["completed", "incomplete", NOT_ATTEMPTED, "unknown"];

/**
 * The fields of `QTI_CONTEXT`, each a string.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export const QTI_CONTEXT_FIELDS: readonly string[] = ["testIdentifier", "candidateIdentifier", "environmentIdentifier"];

/**
 * The built-in response variables and their types: `numAttempts` a single integer and `duration` a single duration (the
 * duration operators and Results Reporting give `duration` base type duration).
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, built-in variables}
 */
export const BUILT_IN_RESPONSES: ReadonlyMap<string, VariableType> = new Map([
  [NUM_ATTEMPTS, { cardinality: "single", baseType: "integer" }],
  [DURATION, { cardinality: "single", baseType: "duration" }],
]);

/**
 * The built-in outcomes and their types.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export const BUILT_IN_OUTCOMES: ReadonlyMap<string, VariableType> = new Map([
  [COMPLETION_STATUS, { cardinality: "single", baseType: "identifier" }],
]);

/**
 * The built-in context variables and their types.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export const BUILT_IN_CONTEXTS: ReadonlyMap<string, VariableType> = new Map([[QTI_CONTEXT, { cardinality: "record" }]]);
