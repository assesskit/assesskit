import type { OutcomeDeclaration } from "../asi/index.js";
import { QTI_CONTEXT } from "../processing/index.js";
import { COMPLETION_STATUS, DURATION, fitValue, NUM_ATTEMPTS } from "../processing/internal.js";
import type { OutcomeVariable } from "../results/index.js";
import type { Value } from "../values/index.js";
import type { CatSession } from "./cat-session.js";
import type { DeliveryState } from "./delivery-state.js";
import { type ItemKey, sameKey } from "./plan.js";

/**
 * How the engine takes an outcome that a CAT engine reported: into a declaration, as an extra, or not at all.
 *
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/impl/ | 1EdTech Computer Adaptive Testing 1.0}
 */
export type OutcomeFate =
  | { readonly fate: "declared"; readonly identifier: string; readonly value: Value }
  | { readonly fate: "extra" }
  | { readonly fate: "ignored" };

/**
 * The variables of a test or an item that a CAT outcome may not take the name of.
 *
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/impl/ | 1EdTech Computer Adaptive Testing 1.0}
 */
export interface Declared {
  /** The declared outcomes. */
  readonly outcomes: readonly OutcomeDeclaration[];
  /** The identifiers of the other variables: context, template and response variables, and the built-ins. */
  readonly others: ReadonlySet<string>;
}

/**
 * The built-in variables of an item, which an engine may not report.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
const BUILT_INS: readonly string[] = [NUM_ATTEMPTS, DURATION, COMPLETION_STATUS, QTI_CONTEXT];

/** Returns the identifiers that an item declares besides its outcomes, and the built-ins. */
export function otherIdentifiers(
  declarations: readonly (readonly { readonly identifier: string }[])[],
): ReadonlySet<string> {
  return new Set([...BUILT_INS, ...declarations.flat().map(({ identifier }) => identifier)]);
}

/**
 * Decides what the engine does with an outcome a CAT engine reported.
 *
 * @remarks
 * A declared outcome with `external-scored="externalMachine"` takes it, by its own identifier or by its
 * `variable-identifier-ref`, if the value fits. The same name as a context, template or response variable, or as an
 * outcome without that attribute, is ignored. Any other outcome is accepted as if it were declared, and kept for the
 * report.
 *
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/impl/ | 1EdTech Computer Adaptive Testing 1.0}
 */
export function outcomeFate(reported: OutcomeVariable, declared: Declared): OutcomeFate {
  const { identifier, value } = reported;
  if (value === null) return { fate: "ignored" };
  const mapped = declared.outcomes.find(
    (declaration) =>
      declaration.externalScored === "externalMachine" && declaration.variableIdentifierRef === identifier,
  );
  const own = declared.outcomes.find((declaration) => declaration.identifier === identifier);
  const target = mapped ?? own;
  if (target !== undefined) {
    if (target.externalScored !== "externalMachine") return { fate: "ignored" };
    const fitted = fitValue(value, target);
    return fitted === undefined
      ? { fate: "ignored" }
      : { fate: "declared", identifier: target.identifier, value: fitted };
  }
  return declared.others.has(identifier) ? { fate: "ignored" } : { fate: "extra" };
}

/**
 * Whether another session of the test already holds an outcome with this identifier for this scope.
 *
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/impl/ | 1EdTech Computer Adaptive Testing 1.0}
 */
export function heldByOther(state: DeliveryState, session: CatSession, identifier: string, item?: ItemKey): boolean {
  return state.cat.some(
    (other) =>
      other !== session &&
      other.outcomes.some(
        (outcome) =>
          outcome.identifier === identifier &&
          (item === undefined ? outcome.item === undefined : outcome.item !== undefined && sameKey(outcome.item, item)),
      ),
  );
}

/**
 * Returns the values that CAT engines gave the external-scored outcomes of the test: their reset values.
 *
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
 */
export function catTestOutcomes(state: DeliveryState): Map<string, Value> {
  const values = new Map<string, Value>();
  for (const session of state.cat) {
    for (const outcome of session.outcomes) {
      if (outcome.item === undefined && outcome.declared) values.set(outcome.identifier, outcome.value);
    }
  }
  return values;
}
