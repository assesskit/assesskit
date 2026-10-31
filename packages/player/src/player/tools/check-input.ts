import * as v from "valibot";
import { looseRecord, nonEmptyStringSchema, parseWith, positiveSchema, strictRecord } from "../../checks.js";
import { checkSupportViews } from "../supports/internal.js";
import { ANGLE_UNITS, CALCULATOR_TYPES, LENGTH_UNITS, type ToolsInput } from "./model.js";

const optionalString = v.optional(v.string());

/** An element of the runtime's model that holds a text: `{ kind, value }`. */
const textSchema = looseRecord({ value: v.string() });

/** A decimal that the runtime keeps as written, such as `"0.5"`, and that is greater than 0. */
const decimalSchema = v.pipe(
  v.string(),
  v.check(
    (text) => text.trim() !== "" && Number.isFinite(Number(text)) && Number(text) > 0,
    (issue) => `expected a decimal greater than 0, found ${issue.received}`,
  ),
);

/** The increment of a rule or of a protractor: `{ unit, value }`, with the value as a decimal in text. */
const incrementSchema = (units: readonly string[]) => looseRecord({ unit: v.picklist(units), value: decimalSchema });

const optionalIncrement = (units: readonly string[]) => v.optional(incrementSchema(units));

const descriptionSchema = looseRecord({ value: v.string() });

const ruleSchema = looseRecord({
  description: descriptionSchema,
  ruleSystem: looseRecord({
    minimumLength: looseRecord({ value: positiveSchema }),
    minorIncrement: optionalIncrement(LENGTH_UNITS),
    majorIncrement: incrementSchema(LENGTH_UNITS),
  }),
});

const protractorSchema = looseRecord({
  description: descriptionSchema,
  increment: looseRecord({
    minorIncrement: optionalIncrement(ANGLE_UNITS),
    majorIncrement: incrementSchema(ANGLE_UNITS),
  }),
});

const digitalSchema = looseRecord({
  fileHref: looseRecord({ value: nonEmptyStringSchema }),
  label: optionalString,
  mimeType: optionalString,
  resourceIcon: v.optional(textSchema),
});

const calculatorSchema = looseRecord({
  calculatorType: looseRecord({ value: v.picklist(CALCULATOR_TYPES) }),
  description: descriptionSchema,
  calculatorInfo: v.optional(digitalSchema),
});

const companionSchema = looseRecord({
  calculators: v.array(calculatorSchema),
  rules: v.array(ruleSchema),
  protractors: v.array(protractorSchema),
  digitalMaterials: v.array(digitalSchema),
  physicalMaterials: v.array(textSchema),
});

// The supports are checked by `checkSupportViews`, which names the list in its messages.
const toolsInputSchema = strictRecord({ companion: v.nullable(companionSchema), supports: v.unknown() });

/**
 * Checks the input of the tools: the companion materials of an item, or `null`, and the supports of the candidate.
 *
 * @param value - The value to check.
 * @throws `DataError` when the input, a material or a support has the wrong type, an unknown property or a value out of
 * range.
 */
export function checkToolsInput(value: unknown): asserts value is ToolsInput {
  const { supports } = parseWith(toolsInputSchema, value, "The tools input");
  checkSupportViews(supports, "The property supports");
}
