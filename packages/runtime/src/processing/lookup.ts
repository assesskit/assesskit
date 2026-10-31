import type { OutcomeDeclaration } from "../asi/index.js";
import { ProcessingError } from "../errors.js";
import type { Value } from "../values/index.js";
import { describeType } from "./assign.js";
import { readSingle } from "./declared-value.js";
import { asNumber, primitiveOf } from "./operands.js";

/**
 * `qti-lookup-outcome-value` (INFO §5.87, §5.78, §5.90): the value the outcome's lookup table gives a number. An
 * interpolation table takes the first entry whose `source-value` is at most the number, or below it when
 * `include-boundary` is false; a match table takes the first entry whose `source-value` is the integer. Without such an
 * entry, or for a NULL number, the value is the table's `default-value`, else NULL. The target is read as a value of the
 * outcome's base type.
 *
 * @throws `ProcessingError` when the outcome has no lookup table or is not single, the number is not a single integer,
 * float or duration (an integer for a match table), or a target is not a value of the outcome's base type.
 */
export function lookUp(declaration: OutcomeDeclaration, source: Value | null): Value | null {
  const { identifier, lookupTable: table, baseType } = declaration;
  if (table === undefined || declaration.cardinality !== "single" || baseType === undefined) {
    throw new ProcessingError(
      `The rule qti-lookup-outcome-value sets ${identifier}, which is not a single outcome with a lookup table.`,
      identifier,
    );
  }
  const accepted = table.kind === "match-table" ? ["integer"] : ["integer", "float", "duration"];
  if (source !== null && (source.cardinality !== "single" || !accepted.includes(source.baseType))) {
    throw new ProcessingError(
      `The rule qti-lookup-outcome-value for ${identifier} needs a single ${accepted.join(", ")}, found ${describeType(source)}.`,
      identifier,
    );
  }
  const x = source === null ? undefined : asNumber(primitiveOf(source));
  const target =
    x === undefined
      ? undefined
      : table.kind === "match-table"
        ? table.matchTableEntries.find((entry) => entry.sourceValue === x)?.targetValue
        : table.interpolationTableEntries.find((entry) =>
            entry.includeBoundary === false ? entry.sourceValue < x : entry.sourceValue <= x,
          )?.targetValue;
  const text = target ?? table.defaultValue;
  return text === undefined ? null : readSingle(text, baseType, `The lookup table of ${identifier}`);
}
