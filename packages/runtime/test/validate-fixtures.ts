import {
  ASI_NAMESPACE,
  type AsiDocument,
  type AssessmentItem,
  type Issue,
  readAsi,
  validateAsi,
} from "../src/index.js";

/** Parses JSON text, which is how plain JavaScript passes a value of the wrong type. */
export function json<T = never>(text: string): T {
  return JSON.parse(text);
}

export const NS = `xmlns="${ASI_NAMESPACE}"`;

/** The attributes an item needs besides its identifier and title. */
export const ITEM_ATTRIBUTES = 'adaptive="false" time-dependent="false"';

export interface ItemParts {
  /** The declarations: context, response, outcome and template, in that order. */
  readonly declarations?: string;
  /** The template processing. */
  readonly template?: string;
  /** The content of `qti-item-body`. */
  readonly body?: string;
  /** The response processing element, whole. */
  readonly processing?: string;
  /** What follows the response processing: modal feedback. */
  readonly feedback?: string;
  /** More attributes of the root. */
  readonly attributes?: string;
  readonly identifier?: string;
}

/** Writes the XML of an item. */
export function itemXml({
  declarations = "",
  template = "",
  body = "<p>x</p>",
  processing = "",
  feedback = "",
  attributes = ITEM_ATTRIBUTES,
  identifier = "item",
}: ItemParts = {}): string {
  return `<qti-assessment-item ${NS} identifier="${identifier}" title="Item" ${attributes}>${declarations}${template}<qti-item-body>${body}</qti-item-body>${processing}${feedback}</qti-assessment-item>`;
}

export function read(xml: string): AsiDocument {
  return readAsi(xml);
}

export function itemOf(xml: string): AssessmentItem {
  const document = read(xml);
  if (document.kind !== "item") throw new Error("The test reads an item.");
  return document.item;
}

/** Validates an item built from parts. */
export function check(parts: ItemParts = {}, options = {}): readonly Issue[] {
  return validateAsi(read(itemXml(parts)), options);
}

export const codesOf = (issues: readonly Issue[]): string[] => issues.map(({ code }) => code);

/** The issues of the given code. */
export const only = (issues: readonly Issue[], code: string): Issue[] => issues.filter((issue) => issue.code === code);

export const response = (identifier: string, cardinality: string, baseType: string, content = ""): string =>
  `<qti-response-declaration identifier="${identifier}" cardinality="${cardinality}" base-type="${baseType}">${content}</qti-response-declaration>`;
export const outcome = (
  identifier: string,
  cardinality: string,
  baseType: string,
  attributes = "",
  content = "",
): string =>
  `<qti-outcome-declaration identifier="${identifier}" cardinality="${cardinality}" base-type="${baseType}"${attributes}>${content}</qti-outcome-declaration>`;
export const template = (identifier: string, cardinality: string, baseType: string, content = ""): string =>
  `<qti-template-declaration identifier="${identifier}" cardinality="${cardinality}" base-type="${baseType}">${content}</qti-template-declaration>`;
export const value = (text: string): string => `<qti-default-value><qti-value>${text}</qti-value></qti-default-value>`;

export const rules = (...inner: string[]): string =>
  `<qti-response-processing>${inner.join("")}</qti-response-processing>`;
export const setOutcome = (identifier: string, expression: string): string =>
  `<qti-set-outcome-value identifier="${identifier}">${expression}</qti-set-outcome-value>`;
export const base = (baseType: string, text: string): string =>
  `<qti-base-value base-type="${baseType}">${text}</qti-base-value>`;
export const variable = (identifier: string): string => `<qti-variable identifier="${identifier}"/>`;

// The rule sets of BIND §5 ----------------------------------------------------------------------------------------------

export const choice = (identifier: string): string =>
  `<qti-simple-choice identifier="${identifier}">${identifier}</qti-simple-choice>`;
const associable = (identifier: string, attributes = ' match-max="1"'): string =>
  `<qti-simple-associable-choice identifier="${identifier}"${attributes}>${identifier}</qti-simple-associable-choice>`;
const IMAGE = '<img src="a.png" alt="a" width="10" height="10"/>';
const hotspot = (identifier: string, tag = "qti-hotspot-choice", attributes = ""): string =>
  `<${tag} identifier="${identifier}" shape="rect" coords="0,0,5,5"${attributes}/>`;

/** A fixture of the rule sets B: the declarations of the item and the content of its body. */
export type Fixture = readonly [declarations: string, body: string];

/** A rule set B with an item that breaks it and one that keeps it. */
export interface AttributeRule {
  readonly code: string;
  readonly broken: Fixture;
  readonly kept: Fixture;
}

export const textEntry = (attributes: string): string =>
  `<p><qti-text-entry-interaction response-identifier="R"${attributes}/></p>`;
export const interaction = (tag: string, attributes: string, content: string): string =>
  `<${tag} response-identifier="R"${attributes}>${content}</${tag}>`;
export const single = (baseType: string): string => response("R", "single", baseType);
export const multiple = (baseType: string): string => response("R", "multiple", baseType);
const ordered = (baseType: string): string => response("R", "ordered", baseType);
const HOTTEXT = '<p>x <qti-hottext identifier="H1">one</qti-hottext></p>';
const sets = `<qti-simple-match-set>${associable("A")}</qti-simple-match-set><qti-simple-match-set>${associable("X")}</qti-simple-match-set>`;
export const GAP_TEXT = '<qti-gap-text identifier="W" match-max="1">w</qti-gap-text>';
const GAP_PARAGRAPH = '<p>a <qti-gap identifier="G1"/> b</p>';
const associableHotspot = hotspot("S1", "qti-associable-hotspot", ' match-max="1"');
const POSITION = (attributes: string): string =>
  `<qti-position-object-stage>${IMAGE}${interaction("qti-position-object-interaction", attributes, IMAGE)}</qti-position-object-stage>`;
export const MEDIA = (attributes: string): string =>
  interaction("qti-media-interaction", ` autostart="false"${attributes}`, '<object data="a.mp3" type="audio/mpeg"/>');

export const ATTRIBUTE_RULES: readonly AttributeRule[] = [
  {
    code: "RULE_SET_INTERACTION_01B",
    broken: [single("string"), textEntry(' string-identifier="R"')],
    kept: [single("string"), textEntry("")],
  },
  {
    code: "RULE_SET_INTERACTION_01B",
    broken: [single("boolean"), textEntry("")],
    kept: [single("float"), textEntry("")],
  },
  {
    code: "RULE_SET_INTERACTION_02B",
    broken: [
      multiple("identifier"),
      interaction("qti-choice-interaction", ' max-choices="1" min-choices="2"', choice("A")),
    ],
    kept: [
      multiple("identifier"),
      interaction("qti-choice-interaction", ' max-choices="2" min-choices="2"', choice("A")),
    ],
  },
  {
    code: "RULE_SET_INTERACTION_03B",
    broken: [single("string"), '<qti-extended-text-interaction response-identifier="R" string-identifier="R"/>'],
    kept: [single("string"), '<qti-extended-text-interaction response-identifier="R"/>'],
  },
  {
    code: "RULE_SET_INTERACTION_04B",
    broken: [
      multiple("identifier"),
      interaction("qti-hotspot-interaction", ' max-choices="1" min-choices="2"', `${IMAGE}${hotspot("S1")}`),
    ],
    kept: [
      multiple("identifier"),
      interaction("qti-hotspot-interaction", ' max-choices="0" min-choices="2"', `${IMAGE}${hotspot("S1")}`),
    ],
  },
  {
    code: "RULE_SET_INTERACTION_05B",
    broken: [
      ordered("identifier"),
      interaction("qti-graphic-order-interaction", ' max-choices="1" min-choices="2"', `${IMAGE}${hotspot("S1")}`),
    ],
    kept: [
      ordered("identifier"),
      interaction("qti-graphic-order-interaction", ' max-choices="2" min-choices="1"', `${IMAGE}${hotspot("S1")}`),
    ],
  },
  {
    code: "RULE_SET_INTERACTION_06B",
    broken: [multiple("point"), POSITION(' max-choices="1" min-choices="2"')],
    kept: [multiple("point"), POSITION(' max-choices="2" min-choices="2"')],
  },
  {
    code: "RULE_SET_INTERACTION_07B",
    broken: [multiple("point"), interaction("qti-select-point-interaction", ' max-choices="1" min-choices="2"', IMAGE)],
    kept: [multiple("point"), interaction("qti-select-point-interaction", ' max-choices="2" min-choices="2"', IMAGE)],
  },
  {
    code: "RULE_SET_INTERACTION_08B",
    broken: [
      ordered("identifier"),
      interaction("qti-order-interaction", ' max-choices="1" min-choices="2"', `${choice("A")}${choice("B")}`),
    ],
    kept: [
      ordered("identifier"),
      interaction("qti-order-interaction", ' max-choices="2" min-choices="2"', `${choice("A")}${choice("B")}`),
    ],
  },
  {
    code: "RULE_SET_INTERACTION_09B",
    broken: [
      multiple("identifier"),
      interaction("qti-hottext-interaction", ' max-choices="1" min-choices="2"', HOTTEXT),
    ],
    kept: [multiple("identifier"), interaction("qti-hottext-interaction", ' max-choices="2" min-choices="2"', HOTTEXT)],
  },
  {
    code: "RULE_SET_INTERACTION_10B",
    broken: [
      multiple("pair"),
      interaction(
        "qti-graphic-associate-interaction",
        ' max-associations="1" min-associations="2"',
        `${IMAGE}${associableHotspot}`,
      ),
    ],
    kept: [
      multiple("pair"),
      interaction(
        "qti-graphic-associate-interaction",
        ' max-associations="2" min-associations="2"',
        `${IMAGE}${associableHotspot}`,
      ),
    ],
  },
  {
    code: "RULE_SET_INTERACTION_11B",
    broken: [
      multiple("directedPair"),
      interaction("qti-match-interaction", ' max-associations="1" min-associations="2"', sets),
    ],
    kept: [
      multiple("directedPair"),
      interaction("qti-match-interaction", ' max-associations="2" min-associations="2"', sets),
    ],
  },
  {
    code: "RULE_SET_INTERACTION_12B",
    broken: [
      multiple("pair"),
      interaction(
        "qti-associate-interaction",
        ' max-associations="1" min-associations="2"',
        `${associable("A")}${associable("B")}`,
      ),
    ],
    kept: [
      multiple("pair"),
      interaction(
        "qti-associate-interaction",
        ' max-associations="2" min-associations="2"',
        `${associable("A")}${associable("B")}`,
      ),
    ],
  },
  {
    code: "RULE_SET_INTERACTION_13B",
    broken: [single("integer"), MEDIA(' min-plays="2" max-plays="1"')],
    kept: [single("integer"), MEDIA(' min-plays="1" max-plays="1"')],
  },
  {
    code: "RULE_SET_INTERACTION_14B",
    broken: [single("integer"), '<qti-slider-interaction response-identifier="R" lower-bound="10" upper-bound="0"/>'],
    kept: [single("integer"), '<qti-slider-interaction response-identifier="R" lower-bound="0" upper-bound="10"/>'],
  },
  {
    code: "RULE_SET_INTERACTION_15B",
    broken: [single("string"), interaction("qti-drawing-interaction", "", IMAGE)],
    kept: [single("file"), interaction("qti-drawing-interaction", "", IMAGE)],
  },
  {
    code: "RULE_SET_INTERACTION_16B",
    broken: [single("string"), '<qti-upload-interaction response-identifier="R" type="image/png"/>'],
    kept: [single("file"), '<qti-upload-interaction response-identifier="R" type="image/png"/>'],
  },
  {
    code: "RULE_SET_INTERACTION_17B",
    broken: [single("string"), '<p><qti-end-attempt-interaction response-identifier="R" title="Hint"/></p>'],
    kept: [single("boolean"), '<p><qti-end-attempt-interaction response-identifier="R" title="Hint"/></p>'],
  },
  {
    code: "RULE_SET_INTERACTION_18B",
    broken: [multiple("pair"), interaction("qti-gap-match-interaction", "", `${GAP_TEXT}${GAP_PARAGRAPH}`)],
    kept: [multiple("directedPair"), interaction("qti-gap-match-interaction", "", `${GAP_TEXT}${GAP_PARAGRAPH}`)],
  },
  {
    code: "RULE_SET_INTERACTION_18B",
    broken: [
      multiple("directedPair"),
      interaction(
        "qti-gap-match-interaction",
        ' max-associations="1" min-associations="2"',
        `${GAP_TEXT}${GAP_PARAGRAPH}`,
      ),
    ],
    kept: [
      multiple("directedPair"),
      interaction(
        "qti-gap-match-interaction",
        ' max-associations="2" min-associations="2"',
        `${GAP_TEXT}${GAP_PARAGRAPH}`,
      ),
    ],
  },
  {
    code: "RULE_SET_INTERACTION_19B",
    broken: [
      multiple("pair"),
      interaction("qti-graphic-gap-match-interaction", "", `${IMAGE}${GAP_TEXT}${associableHotspot}`),
    ],
    kept: [
      multiple("directedPair"),
      interaction("qti-graphic-gap-match-interaction", "", `${IMAGE}${GAP_TEXT}${associableHotspot}`),
    ],
  },
];

/** The interaction that each rule set `RULE_SET_INTERACTION_<nn>A` is about: it must not contain another interaction. */
export const NESTING_RULE_SETS: readonly (readonly [container: string, ruleSet: string])[] = [
  ["qti-text-entry-interaction", "RULE_SET_INTERACTION_01A"],
  ["qti-choice-interaction", "RULE_SET_INTERACTION_02A"],
  ["qti-inline-choice-interaction", "RULE_SET_INTERACTION_02A"],
  ["qti-extended-text-interaction", "RULE_SET_INTERACTION_03A"],
  ["qti-hotspot-interaction", "RULE_SET_INTERACTION_04A"],
  ["qti-graphic-order-interaction", "RULE_SET_INTERACTION_05A"],
  ["qti-position-object-interaction", "RULE_SET_INTERACTION_06A"],
  ["qti-select-point-interaction", "RULE_SET_INTERACTION_07A"],
  ["qti-order-interaction", "RULE_SET_INTERACTION_08A"],
  ["qti-hottext-interaction", "RULE_SET_INTERACTION_09A"],
  ["qti-graphic-associate-interaction", "RULE_SET_INTERACTION_10A"],
  ["qti-match-interaction", "RULE_SET_INTERACTION_11A"],
  ["qti-associate-interaction", "RULE_SET_INTERACTION_12A"],
  ["qti-media-interaction", "RULE_SET_INTERACTION_13A"],
  ["qti-slider-interaction", "RULE_SET_INTERACTION_14A"],
  ["qti-drawing-interaction", "RULE_SET_INTERACTION_15A"],
  ["qti-upload-interaction", "RULE_SET_INTERACTION_16A"],
  ["qti-end-attempt-interaction", "RULE_SET_INTERACTION_17A"],
  ["qti-gap-match-interaction", "RULE_SET_INTERACTION_18A"],
  ["qti-graphic-gap-match-interaction", "RULE_SET_INTERACTION_19A"],
  ["qti-custom-interaction", "RULE_SET_INTERACTION_20A"],
  ["qti-portable-custom-interaction", "RULE_SET_INTERACTION_20A"],
];

const GAP_IMG = (attributes: string): string =>
  `<qti-gap-img identifier="G" ${attributes}><img src="a.png" alt="a" width="10" height="10"/></qti-gap-img>`;

/** Fixtures of the rule sets about `match-max` and `match-min`: the element, and the markup for a given pair of attributes. */
export const MATCH_LIMITS: readonly (readonly [code: string, build: (limits: string) => Fixture])[] = [
  [
    "RULE_SET_INTERACTION-RELATED_1",
    (limits) => [
      multiple("directedPair"),
      interaction(
        "qti-gap-match-interaction",
        "",
        `<qti-gap-text identifier="W" ${limits}>w</qti-gap-text>${GAP_PARAGRAPH}`,
      ),
    ],
  ],
  [
    "RULE_SET_INTERACTION-RELATED_2",
    (limits) => [
      multiple("directedPair"),
      interaction("qti-graphic-gap-match-interaction", "", `${IMAGE}${GAP_IMG(limits)}${associableHotspot}`),
    ],
  ],
  [
    "RULE_SET_INTERACTION-RELATED_3",
    (limits) => [
      multiple("pair"),
      interaction(
        "qti-graphic-associate-interaction",
        "",
        `${IMAGE}${hotspot("S1", "qti-associable-hotspot", ` ${limits}`)}`,
      ),
    ],
  ],
  [
    "RULE_SET_INTERACTION-RELATED_4",
    (limits) => [
      multiple("pair"),
      interaction("qti-associate-interaction", "", `${associable("A", ` ${limits}`)}${associable("B")}`),
    ],
  ],
];
