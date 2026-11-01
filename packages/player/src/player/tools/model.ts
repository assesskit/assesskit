import type {
  CalculatorInfo,
  CalculatorTypeElement,
  CompanionMaterialsInfo,
  DigitalMaterial,
} from "@assesskit/runtime/asi";
import type { SupportView } from "@assesskit/runtime/delivery";
import type { SupportName } from "@assesskit/runtime/pnp";
import { TOOL_EXTENSIONS } from "../supports/internal.js";

/**
 * The calculator types of QTI, as the runtime's `qti-calculator-type` has them.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, calculator type}
 */
export const CALCULATOR_TYPES = [
  "basic",
  "standard",
  "scientific",
  "graphing",
] as const satisfies readonly CalculatorTypeElement["value"][];

/** A type of calculator that an item asks for. */
export type CalculatorType = (typeof CALCULATOR_TYPES)[number];

/** The types of calculator that the player builds in: the host provides the others. */
export type BuiltInCalculator = Extract<CalculatorType, "basic" | "standard">;

/**
 * A file of the package that the item offers to the candidate: a digital material, or the file of a calculator.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, digital material}
 */
export type FileMaterial = DigitalMaterial | CalculatorInfo;

/**
 * The units of length of a rule: SI and US, spelled as the schema spells them.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, units of length}
 */
export const LENGTH_UNITS = ["Millimeter", "Centimeter", "Meter", "Kilometer", "Inch", "Foot", "Yard", "Mile"] as const;

/** A unit of length. */
export type LengthUnit = (typeof LENGTH_UNITS)[number];

/**
 * The units of angle of a protractor: SI and US, spelled as the schema spells them.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, units of angle}
 */
export const ANGLE_UNITS = ["Radian", "Degree", "Minute", "Second"] as const;

/** A unit of angle. */
export type AngleUnit = (typeof ANGLE_UNITS)[number];

/**
 * A step of a rule: a length in a unit.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, rule system}
 */
export interface LengthIncrement {
  /** The length, in `unit`. */
  readonly value: number;
  /** The unit of `value`. */
  readonly unit: LengthUnit;
}

/**
 * A step of a protractor: an angle in a unit.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, protractor}
 */
export interface AngleIncrement {
  /** The angle, in `unit`. */
  readonly value: number;
  /** The unit of `value`. */
  readonly unit: AngleUnit;
}

/**
 * What a rule of the item asks for, with the lengths as numbers.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, rule}
 */
export interface RuleSpec {
  /** The least length of the rule, in the unit of `majorIncrement`. */
  readonly minimumLength: number;
  /**
   * The distance between the minor ticks.
   *
   * @defaultValue No minor ticks
   */
  readonly minorIncrement?: LengthIncrement;
  /** The distance between the major ticks, which carry the numbers. */
  readonly majorIncrement: LengthIncrement;
}

/**
 * What a protractor of the item asks for, with the angles as numbers.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, protractor}
 */
export interface ProtractorSpec {
  /**
   * The angle between the minor ticks.
   *
   * @defaultValue No minor ticks
   */
  readonly minorIncrement?: AngleIncrement;
  /** The angle between the major ticks, which carry the numbers. */
  readonly majorIncrement: AngleIncrement;
}

/**
 * The supports of a candidate's profile that put a tool on the screen.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, tools}
 */
export const TOOL_SUPPORT_NAMES = [
  "line-reader",
  "answer-masking",
  "calculator-on-screen",
  "dictionary-on-screen",
  "thesaurus-on-screen",
  "homophone-checker-on-screen",
  "note-taking-on-screen",
  "visual-organizer-on-screen",
  "outliner-on-screen",
  "peer-interaction-on-screen",
  "spell-checker-on-screen",
  ...TOOL_EXTENSIONS,
] as const satisfies readonly SupportName[];

/** The name of a support that puts a tool on the screen. */
export type ToolSupportName = (typeof TOOL_SUPPORT_NAMES)[number];

/** What decides the tools in force for an item: its companion materials, the candidate's supports and the content shown. */
export interface ToolsInput {
  /**
   * The companion materials of the item as the runtime reads them, or `null` for an item without them.
   *
   * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, companion materials info}
   */
  readonly companion: CompanionMaterialsInfo | null;
  /** The supports of the view; those that put no tool on the screen are ignored. */
  readonly supports: readonly SupportView[];
  /**
   * Names the content shown, so that what the highlighter and the answer eliminator keep comes back with it: the marks of a
   * passage that several items share stay with the passage.
   *
   * @defaultValue `null`: the marks last until the next `update`
   */
  readonly content?: {
    /** Names the item presented: the same name when the item comes again, a different one for another item. */
    readonly item: string;
    /** Names the stimuli the item shares, in the order they are shown: the same name for the same stimulus in any item. */
    readonly stimuli: readonly string[];
  } | null;
}

/** The names of the content shown, as {@link ToolsInput.content} gives them. */
export type ToolContent = NonNullable<ToolsInput["content"]>;

/** The tools that the host provides in place of built-in ones, by name. */
export const SLOT_TOOLS = [
  "scientific-calculator",
  "graphing-calculator",
  "dictionary",
  "thesaurus",
  "homophone-checker",
  "note-taking",
  "visual-organizer",
  "outliner",
  "peer-interaction",
  "spell-checker",
] as const;

/** The name of a tool that the host provides. */
export type SlotTool = (typeof SLOT_TOOLS)[number];

/** A tool in force, without the means to show it. */
export type ToolSpec =
  | { readonly kind: "rule"; readonly rule: RuleSpec }
  | { readonly kind: "protractor"; readonly protractor: ProtractorSpec }
  | { readonly kind: "line-reader"; readonly highlightColor: string | null }
  | { readonly kind: "answer-masking" }
  | { readonly kind: "highlighter" }
  | { readonly kind: "eliminator" }
  | { readonly kind: "calculator"; readonly type: BuiltInCalculator }
  | { readonly kind: "slot"; readonly tool: SlotTool }
  | { readonly kind: "digital"; readonly material: DigitalMaterial };

/** A tool in force. */
export interface ToolEntry {
  /** Identifies the tool among the tools of the item: equal keys are the same tool, whichever input they came from. */
  readonly key: string;
  /** The tool. */
  readonly spec: ToolSpec;
  /** What the author says the tool offers, or `null`. */
  readonly description: string | null;
  /**
   * The file at which the item says that a calculator is available, or `null`.
   *
   * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, calculator info}
   */
  readonly file: CalculatorInfo | null;
  /**
   * The support that puts the tool on the screen, or `null` for a tool that only the item asks for.
   *
   * @remarks
   * The tool follows its `active` flag when its state is `option`, because only an option can be turned on and off with
   * a `support` action.
   */
  readonly support: SupportView | null;
}

/** The tools in force for an item and the candidate. */
export interface ToolSet {
  /** The tools, in the order of the toolbar: the item's rules, protractors and calculators, the digital materials, then the candidate's supports. */
  readonly tools: readonly ToolEntry[];
  /** The physical materials that the candidate supplies. */
  readonly physical: readonly string[];
}
