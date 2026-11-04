import { normalizeValue, type Value } from "../values/index.js";
import type { InteractionDescriptor } from "./descriptor.js";

/**
 * Returns the response an interaction starts with, given the default value of its response variable.
 *
 * @remarks
 * The interactions start from the default, with two exceptions: a choice interaction "is always initialized with no
 * choices selected" and an end attempt interaction ignores its default. The default of an order interaction overrides
 * the initial order of its choices, so an engine shuffles the choices of an order only when the default is NULL; a hot
 * text interaction starts from its default.
 *
 * @param descriptor - A descriptor that `describeInteractions` returned.
 * @param defaultValue - The default value of the response variable, or `null` for none.
 * @returns The value to start with, or `null` for NULL.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export function startingResponse(descriptor: InteractionDescriptor, defaultValue: Value | null): Value | null {
  const ignored = descriptor.kind === "choice-interaction" || descriptor.kind === "end-attempt-interaction";
  return ignored || defaultValue === null ? null : normalizeValue(defaultValue);
}
