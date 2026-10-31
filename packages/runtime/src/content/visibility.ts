import { checkChoice, checkString } from "../checks.js";
import { normalizeValue, type Value } from "../values/index.js";

/** Returns whether a value of base type identifier is the identifier or, as a container, holds it. */
function names(value: Value | null, identifier: string): boolean {
  if (value === null || value.cardinality === "record" || value.baseType !== "identifier") return false;
  return value.cardinality === "single" ? value.value === identifier : value.values.includes(identifier);
}

/**
 * Returns whether content is visible given the variable that controls it (INFO §5.93.2, §5.132.4). With `show` the
 * content is hidden by default and shown only when the variable matches, or contains, its identifier; with `hide` it is
 * shown by default and hidden when the variable matches or contains the identifier. This holds for feedback, which an
 * outcome controls, and for template blocks, template inlines and choices, which a template variable controls. A
 * variable that is NULL, or has another base type than identifier, names nothing.
 *
 * @param showHide - The `show-hide` of the content. Absent means `show`, the default of the schema.
 * @param identifier - The `identifier` of the content.
 * @param value - The value of the controlling variable: a single or multiple identifier, or `null`.
 * @throws `DataError` when an argument has the wrong type.
 */
export function isShown(showHide: "hide" | "show" | undefined, identifier: string, value: Value | null): boolean {
  if (showHide !== undefined) checkChoice(showHide, "The show-hide", ["show", "hide"]);
  checkString(identifier, "The identifier");
  const named = names(value === null ? null : normalizeValue(value), identifier);
  return showHide === "hide" ? !named : named;
}
