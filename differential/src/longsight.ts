import type { Random } from "@assesskit/runtime";
import { createItemSession, parseQtiXml, type QtiDiagnostic, type QtiDocument } from "@longsightgroup/qti3-core";
import type { Implementation, ItemCase, Observed, SessionCase, TurnObservation } from "./model.ts";

/** The multiplier and increment of the oracle's generator, a linear congruential generator (Numerical Recipes). */
const LCG_MULTIPLIER = 1664525;
const LCG_INCREMENT = 1013904223;
const TWO_TO_32 = 2 ** 32;

/**
 * Returns the generator that the oracle draws template values with for a numeric seed (`seededRandom` of its
 * `processing-random.js`), as a runtime `Random`, so that the runtime can draw the values that the oracle draws.
 */
export function longsightRandom(seed: number): Random {
  let state = seed >>> 0;
  return {
    uniform: () => {
      state = (LCG_MULTIPLIER * state + LCG_INCREMENT) >>> 0;
      return state / TWO_TO_32;
    },
  };
}

/** Parses an item with the oracle, or returns why it does not accept it. */
function parse(xml: string): QtiDocument | string {
  const parsed = parseQtiXml(xml);
  const errors = parsed.diagnostics.filter((diagnostic: QtiDiagnostic) => diagnostic.severity === "error");
  if (!parsed.ok || !parsed.document)
    return errors.map((diagnostic) => diagnostic.message).join("; ") || "The item does not parse.";
  return parsed.document;
}

/**
 * Returns the correct responses of an item by response identifier, as the oracle reads them from the item's response
 * declarations.
 *
 * @returns `undefined` when the oracle does not accept the item.
 */
export function correctResponses(xml: string, seed: number): Record<string, Observed> | undefined {
  const document = parse(xml);
  return typeof document === "string"
    ? undefined
    : createItemSession(document, undefined, { randomSeed: seed }).correctResponses();
}

/** The code of the oracle's diagnostic for an action on an adaptive item that completed. */
const COMPLETED_CODE = "session.completed";

/** Longsight `qti3-core`: the oracle that the runtime's item processing is compared with. */
export const longsight: Implementation = {
  name: "Longsight qti3-core",
  run: ({ xml, responses, seed }: ItemCase) => {
    const document = parse(xml);
    if (typeof document === "string") return { accepted: false, reason: document };
    const session = createItemSession(document, undefined, { randomSeed: seed });
    for (const [identifier, value] of Object.entries(responses)) session.respond(identifier, value);
    const { outcomes, state } = session.score();
    return { accepted: true, observation: { outcomes, templateValues: state.templateValues ?? {} } };
  },
  play: ({ xml, turns, seed }: SessionCase) => {
    const document = parse(xml);
    if (typeof document === "string") return { accepted: false, reason: document };
    const session = createItemSession(document, undefined, { randomSeed: seed });
    const { adaptive } = document.item;
    return {
      accepted: true,
      turns: turns.map(({ responses, endAttempt }): TurnObservation => {
        const responded = Object.entries(responses).flatMap(([identifier, value]) =>
          session.respond(identifier, value),
        );
        const { outcomes, state, diagnostics } = session.score(
          endAttempt === undefined ? {} : { endAttemptResponseIdentifier: endAttempt },
        );
        return {
          accepted: ![...responded, ...diagnostics].some(({ code }) => code === COMPLETED_CODE),
          outcomes,
          numAttempts: state.builtInVariables?.numAttempts ?? 0,
          closed: adaptive && state.status === "completed",
        };
      }),
    };
  },
};
