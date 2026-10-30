import {
  checkArray,
  checkBoolean,
  checkChoice,
  checkNonEmptyString,
  checkPositive,
  checkProperties,
  checkRecord,
  checkString,
  describe,
} from "../../checks.js";
import { DataError } from "../../errors.js";
import {
  ANGLE_UNITS,
  CALCULATOR_TYPES,
  LENGTH_UNITS,
  SUPPORT_STATES,
  TOOL_SUPPORT_NAMES,
  type ToolsInput,
} from "./model.js";

/** The colors of the profile are `#RGB` or `#RRGGBB` (PNP XSD `HexDType`). */
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/iu;

function checkOptionalString(value: unknown, label: string): void {
  if (value !== undefined) checkString(value, label);
}

/** Checks an element of olah's model that holds a text, and returns the text: `{ kind, value }`. */
function textOf(element: unknown, label: string): unknown {
  checkRecord(element, `${label} must be an element of olah's model`);
  return element.value;
}

/** Checks a decimal that olah keeps as written, such as `"0.5"`, and that is greater than 0. */
function checkDecimal(value: unknown, label: string): void {
  checkString(value, label);
  if (value.trim() === "" || !(Number.isFinite(Number(value)) && Number(value) > 0)) {
    throw new DataError(`${label} must be a decimal greater than 0, found ${describe(value)}.`);
  }
}

/** Checks the increment of a rule or of a protractor: `{ unit, value }`, with the value as a decimal in text. */
function checkIncrement(element: unknown, label: string, units: readonly string[]): void {
  checkRecord(element, `${label} must be an element of olah's model`);
  checkChoice(element.unit, `${label}.unit`, units);
  checkDecimal(element.value, `${label}.value`);
}

function checkOptionalIncrement(element: unknown, label: string, units: readonly string[]): void {
  if (element !== undefined) checkIncrement(element, label, units);
}

function checkDescription(parent: Readonly<Record<string, unknown>>, label: string): void {
  checkString(textOf(parent.description, `${label}.description`), `${label}.description.value`);
}

function checkRule(rule: unknown, label: string): void {
  checkRecord(rule, `${label} must be an element of olah's model`);
  checkDescription(rule, label);
  const { ruleSystem } = rule;
  checkRecord(ruleSystem, `${label}.ruleSystem must be an element of olah's model`);
  const system = `${label}.ruleSystem`;
  checkPositive(textOf(ruleSystem.minimumLength, `${system}.minimumLength`), `${system}.minimumLength.value`);
  checkOptionalIncrement(ruleSystem.minorIncrement, `${system}.minorIncrement`, LENGTH_UNITS);
  checkIncrement(ruleSystem.majorIncrement, `${system}.majorIncrement`, LENGTH_UNITS);
}

function checkProtractor(protractor: unknown, label: string): void {
  checkRecord(protractor, `${label} must be an element of olah's model`);
  checkDescription(protractor, label);
  const { increment } = protractor;
  checkRecord(increment, `${label}.increment must be an element of olah's model`);
  checkOptionalIncrement(increment.minorIncrement, `${label}.increment.minorIncrement`, ANGLE_UNITS);
  checkIncrement(increment.majorIncrement, `${label}.increment.majorIncrement`, ANGLE_UNITS);
}

function checkCalculator(calculator: unknown, label: string): void {
  checkRecord(calculator, `${label} must be an element of olah's model`);
  checkChoice(
    textOf(calculator.calculatorType, `${label}.calculatorType`),
    `${label}.calculatorType.value`,
    CALCULATOR_TYPES,
  );
  checkDescription(calculator, label);
  if (calculator.calculatorInfo !== undefined) checkDigital(calculator.calculatorInfo, `${label}.calculatorInfo`);
}

function checkDigital(material: unknown, label: string): void {
  checkRecord(material, `${label} must be an element of olah's model`);
  checkNonEmptyString(textOf(material.fileHref, `${label}.fileHref`), `${label}.fileHref.value`);
  checkOptionalString(material.label, `${label}.label`);
  checkOptionalString(material.mimeType, `${label}.mimeType`);
  if (material.resourceIcon !== undefined) {
    checkString(textOf(material.resourceIcon, `${label}.resourceIcon`), `${label}.resourceIcon.value`);
  }
}

/** Checks each item of a list with `check`, naming the item by its place in the list. */
function checkEach(value: unknown, label: string, check: (item: unknown, itemLabel: string) => void): void {
  checkArray(value, `${label} must be an array`);
  value.forEach((item, index) => {
    check(item, `${label}[${index}]`);
  });
}

function checkCompanion(value: unknown): void {
  const label = "The property companion";
  checkRecord(value, `${label} must be the companion materials of olah's model or null`);
  checkEach(value.calculators, `${label}.calculators`, checkCalculator);
  checkEach(value.rules, `${label}.rules`, checkRule);
  checkEach(value.protractors, `${label}.protractors`, checkProtractor);
  checkEach(value.digitalMaterials, `${label}.digitalMaterials`, checkDigital);
  checkEach(value.physicalMaterials, `${label}.physicalMaterials`, (item, itemLabel) =>
    checkString(textOf(item, itemLabel), `${itemLabel}.value`),
  );
}

function checkSupport(value: unknown, label: string): void {
  checkRecord(value, `${label} must be an object`);
  checkProperties(value, label, ["name", "state", "active", "highlightColor", "calculatorType"]);
  checkChoice(value.name, `${label} property name`, TOOL_SUPPORT_NAMES);
  checkChoice(value.state, `${label} property state`, SUPPORT_STATES);
  checkBoolean(value.active, `${label} property active`);
  checkOptionalString(value.calculatorType, `${label} property calculatorType`);
  if (value.highlightColor === undefined) return;
  checkString(value.highlightColor, `${label} property highlightColor`);
  if (!HEX_COLOR.test(value.highlightColor)) {
    throw new DataError(
      `${label} property highlightColor must be a color as #RGB or #RRGGBB, found ${describe(value.highlightColor)}.`,
    );
  }
}

/**
 * Checks the input of the tools: the companion materials of an item, or `null`, and the supports of the candidate.
 *
 * @throws `DataError` when the input, a material or a support has the wrong type, an unknown property or a value out of range.
 */
export function checkToolsInput(value: unknown): asserts value is ToolsInput {
  checkRecord(value, "The tools input must be an object");
  checkProperties(value, "The tools input", ["companion", "supports"]);
  if (value.companion !== null) checkCompanion(value.companion);
  checkEach(value.supports, "The property supports", checkSupport);
}
