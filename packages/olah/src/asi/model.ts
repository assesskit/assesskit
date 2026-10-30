import type { XmlAttribute, XmlElement, XmlNode } from "../xml/index.js";
import type {
  ELEMENT_TYPES,
  EXPRESSION,
  NUMERIC_EXPRESSION,
  OUTCOME_RULES,
  RESPONSE_RULES,
  TEMPLATE_RULES,
} from "./element-table.js";
import type { AcceptDef, AttributeDef, AttributeType, SlotDef } from "./table.js";

type Types = typeof ELEMENT_TYPES;

/** The value of an attribute or of a text, by its type in the element table. */
type ValueOf<T> = T extends { kind: "string" }
  ? string
  : T extends { kind: "boolean" }
    ? boolean
    : T extends { kind: "integer" | "double" }
      ? number
      : T extends { kind: "reference" }
        ? number | string
        : T extends { kind: "enum"; terms: readonly (infer TTerm extends string)[]; extension: true }
          ? TTerm | `ext:${string}`
          : T extends { kind: "enum"; terms: readonly (infer TTerm extends string)[] }
            ? TTerm
            : T extends { kind: "list"; item: infer TItem extends AttributeType }
              ? readonly ValueOf<TItem>[]
              : never;

/** The properties that the attributes of a type give: required ones, then optional ones. */
type AttributeProperties<TAttributes extends readonly AttributeDef[]> = {
  readonly [TAttribute in TAttributes[number] as TAttribute extends { use: "required" }
    ? TAttribute["property"]
    : never]: ValueOf<TAttribute["type"]>;
} & {
  readonly [TAttribute in TAttributes[number] as TAttribute extends { use: "required" }
    ? never
    : TAttribute["property"]]?: ValueOf<TAttribute["type"]>;
};

/** The model of one element that a slot accepts. */
type Member<TAccept extends AcceptDef> = TAccept extends AcceptDef
  ? ElementModel<TAccept["type"] & keyof Types, TAccept["element"]>
  : never;

/** What one place in the model holds: the accepted elements, and `xi:include` kept as XML. */
type SlotMember<TSlot extends SlotDef> = TSlot extends { include: true }
  ? Member<TSlot["accepts"][number]> | XmlElement
  : Member<TSlot["accepts"][number]>;

/** The properties that the slots of a type give. */
type SlotProperties<TSlots extends readonly SlotDef[]> = {
  readonly [TSlotOf in TSlots[number] as TSlotOf extends { max: 1; min: 1 }
    ? TSlotOf["property"]
    : never]: SlotMember<TSlotOf>;
} & {
  readonly [TSlotOf in TSlots[number] as TSlotOf extends { max: 1; min: 0 }
    ? TSlotOf["property"]
    : never]?: SlotMember<TSlotOf>;
} & {
  readonly [TSlotOf in TSlots[number] as TSlotOf extends { max: 1 }
    ? never
    : TSlotOf["property"]]: readonly SlotMember<TSlotOf>[];
};

/** The properties that the content of a type gives. */
type ContentProperties<TContent> = TContent extends { kind: "text"; value: infer TValue extends AttributeType }
  ? {
      /** The text of the element. */
      readonly value: ValueOf<TValue>;
    }
  : TContent extends { kind: "flow" }
    ? {
        /** The content of the element, as parsed. */
        readonly children: readonly BodyNode[];
      }
    : TContent extends { kind: "slots"; slots: infer TSlots extends readonly SlotDef[] }
      ? SlotProperties<TSlots> &
          (TContent extends { wildcard: object }
            ? {
                /** The child elements of other namespaces, as parsed. */
                readonly extensionElements: readonly XmlElement[];
              }
            : unknown)
      : unknown;

/** The property for the attributes beyond the ones of the schema, when the type allows them. */
type ExtensionProperties<TType> = TType extends { attributeWildcard: object }
  ? {
      /** The attributes beyond the ones of the schema, such as `data-*` attributes, in document order. */
      readonly extensions: readonly XmlAttribute[];
    }
  : unknown;

/** The element name without the `qti-` prefix, which is the `kind` of its model. */
type KindOf<TElement extends string> = TElement extends `qti-${infer TKind}` ? TKind : TElement;

/**
 * The model of an element: the type `T` of the element table, for the element `TElement`.
 *
 * - `kind` is the name of the element without `qti-`.
 * - Each attribute is a property of its camel-case name; `xml:lang` is `language` and `xml:base` is `xmlBase`. A required
 *   attribute is a required property, and an attribute that a document omits is an omitted property.
 * - Each place for child elements is a property: an array when it holds more than one element, otherwise the element,
 *   omitted when there is none. Child elements are in schema order, except in an array that holds several kinds of
 *   elements, which keeps document order. An `xi:include` is kept as an `XmlElement`.
 * - `extensions` holds the attributes that the schema allows beyond its own, and `extensionElements` the elements of
 *   other namespaces.
 * - A text is `value`, and flow content is `children`, the nodes as parsed.
 */
export type ElementModel<T extends keyof Types, TElement extends string> = {
  /** The name of the element without `qti-`. */
  readonly kind: KindOf<TElement>;
} & AttributeProperties<Types[T]["attributes"]> &
  ContentProperties<Types[T]["content"]> &
  ExtensionProperties<Types[T]>;

/**
 * A node of body content: an element, text, CDATA section, comment or processing instruction, as parsed. Flow content is
 * text mixed with HTML, MathML and SSML elements, interactions and feedback; the model keeps it as XML.
 */
export type BodyNode = XmlNode;

/** An expression, which processing evaluates to a value or NULL: one of the 64 operators and values (INFO §2.11). */
export type Expression = Member<(typeof EXPRESSION)[number]>;

/** An expression that yields a number: the operands of `qti-sum` (INFO §6.9.8). */
export type NumericExpression = Member<(typeof NUMERIC_EXPRESSION)[number]>;

/** A rule of response processing, or an `xi:include` of one (INFO §4.6). */
export type ResponseRule = Member<(typeof RESPONSE_RULES)[number]> | XmlElement;

/** A rule of outcome processing, or an `xi:include` of one (INFO §5.102). */
export type OutcomeRule = Member<(typeof OUTCOME_RULES)[number]> | XmlElement;

/** A rule of template processing (INFO §5.156). */
export type TemplateRule = Member<(typeof TEMPLATE_RULES)[number]>;

/** A `qti-assessment-item`: one question or task, with its declarations, body and processing (INFO §4.1). */
export type AssessmentItem = ElementModel<"AssessmentItem", "qti-assessment-item">;

/** A `qti-assessment-stimulus`: material that several items share (INFO §4.3). */
export type AssessmentStimulus = ElementModel<"AssessmentStimulus", "qti-assessment-stimulus">;

/** A `qti-assessment-stimulus-ref`: the reference from an item to a stimulus (INFO §7.6). */
export type AssessmentStimulusRef = ElementModel<"AssessmentStimulusRef", "qti-assessment-stimulus-ref">;

/** A `qti-item-body`: the content of an item (INFO §5.79). */
export type ItemBody = ElementModel<"ItemBody", "qti-item-body">;

/** A `qti-stimulus-body`: the content of a stimulus (INFO §5.137). */
export type StimulusBody = ElementModel<"StimulusBody", "qti-stimulus-body">;

/** A `qti-stylesheet`: the reference to a style sheet (INFO §7.36). */
export type Stylesheet = ElementModel<"StyleSheet", "qti-stylesheet">;

/** A `qti-assessment-item-ref`: the reference from a section to an item (INFO §5.6). */
export type AssessmentItemRef = ElementModel<"AssessmentItemRef", "qti-assessment-item-ref">;

/** A `qti-assessment-section`: a group of item references and sections (INFO §4.2). */
export type AssessmentSection = ElementModel<"AssessmentSection", "qti-assessment-section">;

/** A `qti-assessment-section-ref`: the reference from a section or test part to a section document (INFO §7.5). */
export type AssessmentSectionRef = ElementModel<"AssessmentSectionRef", "qti-assessment-section-ref">;

/** A `qti-assessment-test`: items arranged in test parts and sections (INFO §4.4). */
export type AssessmentTest = ElementModel<"AssessmentTest", "qti-assessment-test">;

/** A `qti-branch-rule`: a jump to another item, section or test part when its expression is true (INFO §5.23). */
export type BranchRule = ElementModel<"BranchRule", "qti-branch-rule">;

/** A `qti-item-session-control`: the rules for attempts, feedback, review and skipping (INFO §7.19). */
export type ItemSessionControl = ElementModel<"ItemSessionControl", "qti-item-session-control">;

/** A `qti-ordering`: whether the children of a section are shuffled (INFO §5.98). */
export type Ordering = ElementModel<"Ordering", "qti-ordering">;

/** A `qti-pre-condition`: an expression that must be true for a part, section or item to be presented (INFO §5.86). */
export type PreCondition = ElementModel<"LogicSingle", "qti-pre-condition">;

/** A `qti-selection`: how many children of a section are selected (INFO §5.129). */
export type Selection = ElementModel<"Selection", "qti-selection">;

/** A `qti-template-default`: the default of a template variable that a test gives an item (INFO §5.152). */
export type TemplateDefault = ElementModel<"TemplateDefault", "qti-template-default">;

/** A `qti-test-part`: a major division of a test (INFO §5.159). */
export type TestPart = ElementModel<"TestPart", "qti-test-part">;

/** A `qti-time-limits`: the minimum and maximum time (INFO §7.40). */
export type TimeLimits = ElementModel<"TimeLimits", "qti-time-limits">;

/** A `qti-variable-mapping`: the rename of an item outcome for the test (INFO §7.48). */
export type VariableMapping = ElementModel<"VariableMapping", "qti-variable-mapping">;

/** A `qti-weight`: the weight of an item outcome in the test (INFO §7.50). */
export type Weight = ElementModel<"Weight", "qti-weight">;

/** A `qti-adaptive-engine-ref`: the reference to the engine of an adaptive section (INFO §7.3). */
export type AdaptiveEngineRef = ElementModel<"AdaptiveHref", "qti-adaptive-engine-ref">;

/** A `qti-adaptive-selection`: the selection of the items of a section by a computer adaptive testing engine (INFO §5.3). */
export type AdaptiveSelection = ElementModel<"AdaptiveSelection", "qti-adaptive-selection">;

/** A `qti-adaptive-settings-ref`: the reference to the settings of an adaptive section (INFO §7.3). */
export type AdaptiveSettingsRef = ElementModel<"AdaptiveHref", "qti-adaptive-settings-ref">;

/** A `qti-metadata-ref`: the reference to the item metadata of an adaptive section (INFO §7.3). */
export type MetadataRef = ElementModel<"AdaptiveHref", "qti-metadata-ref">;

/** A `qti-usagedata-ref`: the reference to the usage data of an adaptive section (INFO §7.3). */
export type UsageDataRef = ElementModel<"AdaptiveHref", "qti-usagedata-ref">;

/** A `qti-area-map-entry`: the mapped value of an area (INFO §7.4). */
export type AreaMapEntry = ElementModel<"AreaMapEntry", "qti-area-map-entry">;

/** A `qti-area-mapping`: the mapping from areas to values (INFO §5.5). */
export type AreaMapping = ElementModel<"AreaMapping", "qti-area-mapping">;

/** A `qti-context-declaration`: a variable that a test declares and its items read (INFO §5.34). */
export type ContextDeclaration = ElementModel<"ContextDeclaration", "qti-context-declaration">;

/** A `qti-correct-response`: the correct value of a response (INFO §5.35). */
export type CorrectResponse = ElementModel<"CorrectResponse", "qti-correct-response">;

/** A `qti-default-value`: the value a variable has before processing sets it (INFO §5.41). */
export type DefaultValue = ElementModel<"DefaultValue", "qti-default-value">;

/** A `qti-interpolation-table`: the mapping from number ranges to values (INFO §5.78). */
export type InterpolationTable = ElementModel<"InterpolationTable", "qti-interpolation-table">;

/** A `qti-interpolation-table-entry`: one range of an interpolation table (INFO §7.18). */
export type InterpolationTableEntry = ElementModel<"InterpolationTableEntry", "qti-interpolation-table-entry">;

/** A `qti-map-entry`: the mapped value of one response value (INFO §7.21). */
export type MapEntry = ElementModel<"MapEntry", "qti-map-entry">;

/** A `qti-mapping`: the mapping from response values to numbers (INFO §5.88). */
export type Mapping = ElementModel<"Mapping", "qti-mapping">;

/** A `qti-match-table`: the mapping from integers to values (INFO §5.90). */
export type MatchTable = ElementModel<"MatchTable", "qti-match-table">;

/** A `qti-match-table-entry`: one integer of a match table (INFO §7.23). */
export type MatchTableEntry = ElementModel<"MatchTableEntry", "qti-match-table-entry">;

/** A `qti-outcome-declaration`: an outcome variable (INFO §4.5). */
export type OutcomeDeclaration = ElementModel<"OutcomeDeclaration", "qti-outcome-declaration">;

/** A `qti-response-declaration`: a response variable (INFO §5.115). */
export type ResponseDeclaration = ElementModel<"ResponseDeclaration", "qti-response-declaration">;

/** A `qti-template-declaration`: a template variable (INFO §5.151). */
export type TemplateDeclaration = ElementModel<"TemplateDeclaration", "qti-template-declaration">;

/** A `qti-value`: one value of a default value or a correct response (INFO §7.46). */
export type ValueElement = ElementModel<"Value", "qti-value">;

/** A `qti-exit-response`: the end of response processing (INFO §6.39.5). */
export type ExitResponse = ElementModel<"EmptyPrimitiveType", "qti-exit-response">;

/** A `qti-exit-template`: the end of template processing (INFO §6.50.2). */
export type ExitTemplate = ElementModel<"EmptyPrimitiveType", "qti-exit-template">;

/** A `qti-exit-test`: the end of outcome processing (INFO §6.32.5). */
export type ExitTest = ElementModel<"EmptyPrimitiveType", "qti-exit-test">;

/** A `qti-lookup-outcome-value`: sets an outcome from a lookup table (INFO §5.87, §6.32.1, §6.39.6). */
export type LookupOutcomeValue = ElementModel<"LookupOutcomeValue", "qti-lookup-outcome-value">;

/** A `qti-outcome-condition`: an if, else-if and else of outcome rules (INFO §5.99, §6.32.6). */
export type OutcomeCondition = ElementModel<"OutcomeCondition", "qti-outcome-condition">;

/** A `qti-outcome-else`: the rules of an outcome condition when no expression is true (INFO §5.100). */
export type OutcomeElse = ElementModel<"OutcomeElse", "qti-outcome-else">;

/** A `qti-outcome-else-if`: an expression and the rules to run when it is true and no earlier one was (INFO §5.101). */
export type OutcomeElseIf = ElementModel<"OutcomeIf", "qti-outcome-else-if">;

/** A `qti-outcome-if`: an expression and the rules to run when it is true (INFO §5.101). */
export type OutcomeIf = ElementModel<"OutcomeIf", "qti-outcome-if">;

/** A `qti-outcome-processing`: the rules that set the outcomes of a test (INFO §5.102). */
export type OutcomeProcessing = ElementModel<"OutcomeProcessing", "qti-outcome-processing">;

/** A `qti-outcome-processing-fragment`: a group of outcome rules (INFO §5.103, §6.32.2). */
export type OutcomeProcessingFragment = ElementModel<"OutcomeProcessingFragment", "qti-outcome-processing-fragment">;

/** A `qti-response-condition`: an if, else-if and else of response rules (INFO §5.114, §6.39.2). */
export type ResponseCondition = ElementModel<"ResponseCondition", "qti-response-condition">;

/** A `qti-response-else`: the rules of a response condition when no expression is true (INFO §5.116). */
export type ResponseElse = ElementModel<"ResponseElse", "qti-response-else">;

/** A `qti-response-else-if`: an expression and the rules to run when it is true and no earlier one was (INFO §5.117). */
export type ResponseElseIf = ElementModel<"ResponseIf", "qti-response-else-if">;

/** A `qti-response-if`: an expression and the rules to run when it is true (INFO §5.117). */
export type ResponseIf = ElementModel<"ResponseIf", "qti-response-if">;

/** A `qti-response-processing`: the rules that score the responses of an item (INFO §4.6). */
export type ResponseProcessing = ElementModel<"ResponseProcessing", "qti-response-processing">;

/** A `qti-response-processing-fragment`: a group of response rules (INFO §5.118, §6.39.3). */
export type ResponseProcessingFragment = ElementModel<"ResponseProcessingFragment", "qti-response-processing-fragment">;

/** A `qti-set-correct-response`: sets the correct response of a response variable (INFO §5.130, §6.50.5). */
export type SetCorrectResponse = ElementModel<"SetValue", "qti-set-correct-response">;

/** A `qti-set-default-value`: sets the default value of a variable (INFO §5.130, §6.50.4). */
export type SetDefaultValue = ElementModel<"SetValue", "qti-set-default-value">;

/** A `qti-set-outcome-value`: sets an outcome (INFO §5.130, §6.32.3, §6.39.4). */
export type SetOutcomeValue = ElementModel<"SetValue", "qti-set-outcome-value">;

/** A `qti-set-template-value`: sets a template variable (INFO §5.130, §6.50.1). */
export type SetTemplateValue = ElementModel<"SetValue", "qti-set-template-value">;

/** A `qti-template-condition`: an if, else-if and else of template rules (INFO §5.149, §6.50.3). */
export type TemplateCondition = ElementModel<"TemplateCondition", "qti-template-condition">;

/** A `qti-template-constraint`: an expression that template processing must make true (INFO §5.150, §6.50.6). */
export type TemplateConstraint = ElementModel<"TemplateConstraint", "qti-template-constraint">;

/** A `qti-template-else`: the rules of a template condition when no expression is true (INFO §5.153). */
export type TemplateElse = ElementModel<"TemplateElse", "qti-template-else">;

/** A `qti-template-else-if`: an expression and the rules to run when it is true and no earlier one was (INFO §5.154). */
export type TemplateElseIf = ElementModel<"TemplateIf", "qti-template-else-if">;

/** A `qti-template-if`: an expression and the rules to run when it is true (INFO §5.154). */
export type TemplateIf = ElementModel<"TemplateIf", "qti-template-if">;

/** A `qti-template-processing`: the rules that set the template variables of an item (INFO §5.156). */
export type TemplateProcessing = ElementModel<"TemplateProcessing", "qti-template-processing">;

/** A `qti-rubric-block` of a test, test part or section: instructions for the people who read or score (INFO §5.160). */
export type RubricBlock = ElementModel<"TestRubricBlock", "qti-rubric-block">;
