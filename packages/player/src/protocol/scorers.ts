import type { Scorer } from "@assesskit/runtime/delivery";

/**
 * The scorers of a scoring request: a human rater or an external machine.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, external-scored}
 */
export const SCORERS: readonly Scorer[] = ["human", "externalMachine"];
