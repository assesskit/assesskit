import type { CalculatorInfo, CompanionMaterialsInfo } from "@assesskit/runtime/asi";
import type { SupportView } from "@assesskit/runtime/delivery";
import type { SupportName } from "@assesskit/runtime/pnp";
import {
  type AngleIncrement,
  type AngleUnit,
  CALCULATOR_TYPES,
  type CalculatorType,
  type LengthIncrement,
  type LengthUnit,
  type SlotTool,
  type ToolEntry,
  type ToolSet,
  type ToolSpec,
  type ToolsInput,
} from "./model.js";

/** The tools that the host provides, by the support that asks for them (BPIG §5.2.9). */
const SLOT_OF_SUPPORT: ReadonlyMap<SupportName, SlotTool> = new Map([
  ["dictionary-on-screen", "dictionary"],
  ["thesaurus-on-screen", "thesaurus"],
  ["homophone-checker-on-screen", "homophone-checker"],
  ["note-taking-on-screen", "note-taking"],
  ["visual-organizer-on-screen", "visual-organizer"],
  ["outliner-on-screen", "outliner"],
  ["peer-interaction-on-screen", "peer-interaction"],
  ["spell-checker-on-screen", "spell-checker"],
]);

/** The calculator type of a profile that names none: the plainest, since the profile asks for any calculator (CERT A-12). */
const DEFAULT_CALCULATOR_TYPE: CalculatorType = "basic";

function isCalculatorType(value: string): value is CalculatorType {
  return CALCULATOR_TYPES.some((type) => type === value);
}

/** The tool for a calculator type: the built-in basic and standard calculators, and a slot for the others (the player design D1). */
function calculatorSpec(type: CalculatorType): ToolSpec {
  return type === "basic" || type === "standard"
    ? { kind: "calculator", type }
    : { kind: "slot", tool: `${type}-calculator` };
}

/** Adds a tool; a tool that is in force already keeps its place and takes the support when it had none. */
type Add = (spec: ToolSpec, description: string | null, support: SupportView | null, file?: CalculatorInfo) => void;

/** Reads an increment of a rule: the runtime keeps the decimal as written, which is text. */
function lengthIncrement({ value, unit }: { readonly value: string; readonly unit: LengthUnit }): LengthIncrement {
  return { value: Number(value), unit };
}

/** Reads an increment of a protractor. */
function angleIncrement({ value, unit }: { readonly value: string; readonly unit: AngleUnit }): AngleIncrement {
  return { value: Number(value), unit };
}

function addCompanion(add: Add, companion: CompanionMaterialsInfo, prohibitsCalculators: boolean): void {
  for (const { description, ruleSystem } of companion.rules) {
    const { minimumLength, minorIncrement, majorIncrement } = ruleSystem;
    const rule = {
      minimumLength: minimumLength.value,
      minorIncrement: minorIncrement === undefined ? undefined : lengthIncrement(minorIncrement),
      majorIncrement: lengthIncrement(majorIncrement),
    };
    add({ kind: "rule", rule }, description.value, null);
  }
  for (const { description, increment } of companion.protractors) {
    const { minorIncrement, majorIncrement } = increment;
    const protractor = {
      minorIncrement: minorIncrement === undefined ? undefined : angleIncrement(minorIncrement),
      majorIncrement: angleIncrement(majorIncrement),
    };
    add({ kind: "protractor", protractor }, description.value, null);
  }
  if (!prohibitsCalculators) {
    for (const { calculatorType, description, calculatorInfo } of companion.calculators) {
      add(calculatorSpec(calculatorType.value), description.value, null, calculatorInfo);
    }
  }
  for (const material of companion.digitalMaterials) add({ kind: "digital", material }, null, null);
}

function addSupport(add: Add, support: SupportView): void {
  const { settings } = support;
  switch (support.name) {
    case "line-reader":
      add(
        {
          kind: "line-reader",
          highlightColor: settings?.name === "line-reader" ? (settings.highlightColor ?? null) : null,
        },
        null,
        support,
      );
      break;
    case "answer-masking":
      add({ kind: "answer-masking" }, null, support);
      break;
    case "calculator-on-screen": {
      const type =
        (settings?.name === "calculator-on-screen" ? settings.calculatorType : undefined) ?? DEFAULT_CALCULATOR_TYPE;
      // An extension term names a calculator that the player knows nothing of.
      if (isCalculatorType(type)) add(calculatorSpec(type), null, support);
      break;
    }
    default: {
      const tool = SLOT_OF_SUPPORT.get(support.name);
      if (tool !== undefined) add({ kind: "slot", tool }, null, support);
    }
  }
}

/**
 * Resolves the tools in force for an item and a candidate (the player design §2.8, [CERT] A-12): the item's companion
 * materials, plus the tools that the candidate's supports ask for, minus the prohibited supports. A calculator that both
 * name is one tool. A prohibited `calculator-on-screen` removes the item's calculators too, since the profile says that
 * the candidate may not use one (BPIG §5.2.9).
 *
 * @param input - Checked by `checkToolsInput`.
 */
export function resolveTools({ companion, supports }: ToolsInput): ToolSet {
  const tools = new Map<string, ToolEntry>();
  const add: Add = (spec, description, support, file) => {
    const key = JSON.stringify(spec);
    const earlier = tools.get(key);
    if (earlier === undefined) tools.set(key, { key, spec, description, file: file ?? null, support });
    else if (earlier.support === null) tools.set(key, { ...earlier, support });
  };
  const prohibitsCalculators = supports.some(
    ({ name, state }) => name === "calculator-on-screen" && state === "prohibited",
  );
  if (companion !== null) addCompanion(add, companion, prohibitsCalculators);
  for (const support of supports) if (support.state !== "prohibited") addSupport(add, support);
  return { tools: [...tools.values()], physical: companion?.physicalMaterials.map(({ value }) => value) ?? [] };
}
