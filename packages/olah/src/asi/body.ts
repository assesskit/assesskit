import type { XmlElement } from "../xml/index.js";
import type { ELEMENT_TYPES } from "./element-table.js";
import type { ElementModel, TextNode } from "./model.js";
import type { AcceptDef, ForeignDef } from "./table.js";

type Types = typeof ELEMENT_TYPES;

/** Every place in the content of the types of the table where child elements go. */
type Slots = Extract<Types[keyof Types]["content"], { kind: "slots" }>["slots"][number];

/** Every element of the ASI namespace that some place accepts, with its type. */
type Accepts = Slots["accepts"][number];

/** The model of an element that a place accepts. */
type Accepted<TAccept extends AcceptDef> = TAccept extends AcceptDef
  ? ElementModel<TAccept["type"] & keyof Types, TAccept["element"]>
  : never;

/** The model of an element named `TElement`; an element that occurs in several places can have a type in each. */
type ElementOf<TElement extends string> = Accepted<Extract<Accepts, { element: TElement }>>;

/** The places that hold flow content: those that take text, MathML or SSML. */
type FlowSlots = Extract<Slots, { text: true } | { foreign: readonly ForeignDef[] }>;

/** An element that a place accepts, when its name is that of an HTML element. */
type HtmlAccept<TAccept extends AcceptDef> = TAccept extends AcceptDef
  ? TAccept["element"] extends `qti-${string}`
    ? never
    : TAccept
  : never;

/** An element that a place accepts, when its name is that of an interaction. */
type InteractionAccept<TAccept extends AcceptDef> = TAccept extends AcceptDef
  ? TAccept["element"] extends `qti-${string}-interaction`
    ? TAccept
    : never
  : never;

/**
 * A node of flow content, the content of a body, a prompt, a choice or a paragraph: an element that some flow content
 * accepts, text, or an `XmlElement` for MathML, SSML or an `xi:include`, which the model keeps as XML. An element accepts
 * a part of this union (INFO §2.3, §5.79, §5.137).
 */
export type BodyNode = Accepted<FlowSlots["accepts"][number]> | XmlElement | TextNode;

/**
 * An HTML element of the ASI schema (INFO §2.3.1): the 76 elements of the rows H1 to H76. Narrow it by `kind`, which is
 * the name of the element, such as `"p"` or `"img"`. The attributes the schema gives the element are properties; a
 * `data-*` attribute is in `extensions`.
 */
export type HtmlElement = Accepted<HtmlAccept<Accepts>>;

/** An interaction: an element that presents a task and binds a response variable (INFO §2.4). */
export type Interaction = Accepted<InteractionAccept<Accepts>>;

/** A `qti-associate-interaction`: the candidate pairs the choices (INFO §5.8). */
export type AssociateInteraction = ElementOf<"qti-associate-interaction">;

/** A `qti-choice-interaction`: the candidate selects one or more choices (INFO §5.30). */
export type ChoiceInteraction = ElementOf<"qti-choice-interaction">;

/** A `qti-custom-interaction`: an interaction that the delivery system defines, with content of its own (INFO §5.36). */
export type CustomInteraction = ElementOf<"qti-custom-interaction">;

/** A `qti-drawing-interaction`: the candidate draws on an image (INFO §5.44). */
export type DrawingInteraction = ElementOf<"qti-drawing-interaction">;

/** A `qti-end-attempt-interaction`: a button that ends the attempt (INFO §5.45). */
export type EndAttemptInteraction = ElementOf<"qti-end-attempt-interaction">;

/** A `qti-extended-text-interaction`: the candidate writes a longer text (INFO §5.48). */
export type ExtendedTextInteraction = ElementOf<"qti-extended-text-interaction">;

/** A `qti-gap-match-interaction`: the candidate drops choices into the gaps of a text (INFO §5.57). */
export type GapMatchInteraction = ElementOf<"qti-gap-match-interaction">;

/** A `qti-graphic-associate-interaction`: the candidate pairs the hotspots of an image (INFO §5.59). */
export type GraphicAssociateInteraction = ElementOf<"qti-graphic-associate-interaction">;

/** A `qti-graphic-gap-match-interaction`: the candidate drops choices onto the hotspots of an image (INFO §5.60). */
export type GraphicGapMatchInteraction = ElementOf<"qti-graphic-gap-match-interaction">;

/** A `qti-graphic-order-interaction`: the candidate puts the hotspots of an image in order (INFO §5.61). */
export type GraphicOrderInteraction = ElementOf<"qti-graphic-order-interaction">;

/** A `qti-hotspot-interaction`: the candidate selects areas of an image (INFO §5.68). */
export type HotspotInteraction = ElementOf<"qti-hotspot-interaction">;

/** A `qti-hottext-interaction`: the candidate selects words or phrases of a text (INFO §5.66). */
export type HotTextInteraction = ElementOf<"qti-hottext-interaction">;

/** A `qti-inline-choice-interaction`: the candidate picks from a menu inside a sentence (INFO §5.74). */
export type InlineChoiceInteraction = ElementOf<"qti-inline-choice-interaction">;

/** A `qti-match-interaction`: the candidate pairs the choices of two sets (INFO §5.89). */
export type MatchInteraction = ElementOf<"qti-match-interaction">;

/** A `qti-media-interaction`: audio or video that the candidate plays, with the plays counted (INFO §5.92). */
export type MediaInteraction = ElementOf<"qti-media-interaction">;

/** A `qti-order-interaction`: the candidate puts the choices in order (INFO §5.97). */
export type OrderInteraction = ElementOf<"qti-order-interaction">;

/** A `qti-portable-custom-interaction`: an interaction that a module delivered with the item provides (INFO §5.106). */
export type PortableCustomInteraction = ElementOf<"qti-portable-custom-interaction">;

/** A `qti-position-object-interaction`: the candidate positions an object on an image (INFO §5.107). */
export type PositionObjectInteraction = ElementOf<"qti-position-object-interaction">;

/** A `qti-position-object-stage`: the image on which position object interactions place their objects (INFO §5.108). */
export type PositionObjectStage = ElementOf<"qti-position-object-stage">;

/** A `qti-select-point-interaction`: the candidate marks points on an image (INFO §5.128). */
export type SelectPointInteraction = ElementOf<"qti-select-point-interaction">;

/** A `qti-slider-interaction`: the candidate chooses a number on a slider (INFO §5.134). */
export type SliderInteraction = ElementOf<"qti-slider-interaction">;

/** A `qti-text-entry-interaction`: the candidate types a short answer (INFO §5.162). */
export type TextEntryInteraction = ElementOf<"qti-text-entry-interaction">;

/** A `qti-upload-interaction`: the candidate uploads a file (INFO §5.165). */
export type UploadInteraction = ElementOf<"qti-upload-interaction">;

/** A `qti-associable-hotspot`: an area of an image that takes associations (INFO §5.7). */
export type AssociableHotspot = ElementOf<"qti-associable-hotspot">;

/** A `qti-gap`: a gap in the text of a gap match interaction (INFO §5.55). */
export type Gap = ElementOf<"qti-gap">;

/** A `qti-gap-img`: an image that the candidate drops into a gap (INFO §5.56). */
export type GapImg = ElementOf<"qti-gap-img">;

/** A `qti-gap-text`: a text that the candidate drops into a gap (INFO §5.58). */
export type GapText = ElementOf<"qti-gap-text">;

/** A `qti-hotspot-choice`: an area of an image that the candidate selects (INFO §5.67). */
export type HotspotChoice = ElementOf<"qti-hotspot-choice">;

/** A `qti-hottext`: a word or phrase of a text that the candidate selects (INFO §5.65). */
export type HotText = ElementOf<"qti-hottext">;

/** A `qti-inline-choice`: one entry of the menu of an inline choice interaction (INFO §5.73). */
export type InlineChoice = ElementOf<"qti-inline-choice">;

/** A `qti-label`: the label of an inline choice interaction (INFO §5.82). */
export type Label = ElementOf<"qti-label">;

/** A `qti-prompt`: the instruction that an interaction shows to the candidate (INFO §5.109). */
export type Prompt = ElementOf<"qti-prompt">;

/** A `qti-simple-associable-choice`: a choice that takes associations (INFO §5.131). */
export type SimpleAssociableChoice = ElementOf<"qti-simple-associable-choice">;

/** A `qti-simple-choice`: a choice that the candidate selects or puts in order (INFO §5.132). */
export type SimpleChoice = ElementOf<"qti-simple-choice">;

/** A `qti-simple-match-set`: one set of the choices of a match interaction (INFO §5.133). */
export type SimpleMatchSet = ElementOf<"qti-simple-match-set">;

/**
 * A `qti-context-variable`: a context variable that a portable custom interaction reads (INFO §7.8). Its name differs
 * from the element's, which `results` uses for a reported variable.
 */
export type PciContextVariable = ElementOf<"qti-context-variable">;

/** A `qti-interaction-markup`: the markup of a portable custom interaction (INFO §5.76). */
export type InteractionMarkup = ElementOf<"qti-interaction-markup">;

/** A `qti-interaction-module`: a module of a portable custom interaction (INFO §7.17). */
export type InteractionModule = ElementOf<"qti-interaction-module">;

/** A `qti-interaction-modules`: the modules of a portable custom interaction, and where their configuration is (INFO §5.77). */
export type InteractionModules = ElementOf<"qti-interaction-modules">;

/**
 * A `qti-template-variable`: a template variable that a portable custom interaction reads (INFO §7.38). Its name differs
 * from the element's, which `results` uses for a reported variable.
 */
export type PciTemplateVariable = ElementOf<"qti-template-variable">;

/** A `qti-card`: the content of one support in a catalog (INFO §5.26). */
export type Card = ElementOf<"qti-card">;

/** A `qti-card-entry`: the content of a card in one language (INFO §5.27). */
export type CardEntry = ElementOf<"qti-card-entry">;

/** A `qti-catalog`: the cards that elements refer to with `data-catalog-idref` (INFO §5.28). */
export type Catalog = ElementOf<"qti-catalog">;

/** A `qti-catalog-info`: the catalogs of an item or stimulus (INFO §5.29). */
export type CatalogInfo = ElementOf<"qti-catalog-info">;

/** A `qti-content-body`: the content of feedback, a rubric block or a template block (INFO §5.50, 5.51, 5.121, 5.123, 5.147, 5.158, 5.161). */
export type ContentBody = ElementOf<"qti-content-body">;

/** A `qti-feedback-block`: block content that an outcome's value shows or hides (INFO §5.49, 5.148). */
export type FeedbackBlock = ElementOf<"qti-feedback-block">;

/** A `qti-feedback-inline`: inline content that an outcome's value shows or hides (INFO §5.52). */
export type FeedbackInline = ElementOf<"qti-feedback-inline">;

/** A `qti-file-href`: a file of a card, by reference (INFO §7.14, 7.15). */
export type FileHref = ElementOf<"qti-file-href">;

/** A `qti-html-content`: the content of a card (INFO §5.63). */
export type HtmlContent = ElementOf<"qti-html-content">;

/** A `qti-modal-feedback`: feedback shown to the candidate after response processing (INFO §5.93). */
export type ModalFeedback = ElementOf<"qti-modal-feedback">;

/** A `qti-printed-variable`: the value of a variable, printed in the content (INFO §7.30). */
export type PrintedVariable = ElementOf<"qti-printed-variable">;

/** A `qti-rubric-block`: instructions for the people who read or score, in a body, test, part or section (INFO §5.120, 5.160). */
export type RubricBlock = ElementOf<"qti-rubric-block">;

/** A `qti-template-block`: block content that a template variable shows or hides (INFO §5.122, 5.145). */
export type TemplateBlock = ElementOf<"qti-template-block">;

/** A `qti-template-inline`: inline content that a template variable shows or hides (INFO §5.124, 5.155). */
export type TemplateInline = ElementOf<"qti-template-inline">;

/** A `qti-test-feedback`: feedback shown to the candidate during or at the end of a test (INFO §5.157). */
export type TestFeedback = ElementOf<"qti-test-feedback">;

/** A `qti-calculator`: a calculator that the candidate may use (INFO §5.24). */
export type Calculator = ElementOf<"qti-calculator">;

/** A `qti-calculator-info`: the file of a calculator (INFO §5.80). */
export type CalculatorInfo = ElementOf<"qti-calculator-info">;

/** A `qti-calculator-type`: the kind of a calculator (INFO §5.24). `pnp` names the terms `CalculatorType`. */
export type CalculatorTypeElement = ElementOf<"qti-calculator-type">;

/** A `qti-companion-materials-info`: the materials that go with an item (INFO §5.33). */
export type CompanionMaterialsInfo = ElementOf<"qti-companion-materials-info">;

/** A `qti-description`: a description of a calculator, protractor or rule (INFO §5.24, 5.110, 5.126). */
export type Description = ElementOf<"qti-description">;

/** A `qti-digital-material`: a digital material, by reference (INFO §5.80). */
export type DigitalMaterial = ElementOf<"qti-digital-material">;

/** A `qti-increment-si`: the increments of a protractor in SI units (INFO §5.70). */
export type IncrementSi = ElementOf<"qti-increment-si">;

/** A `qti-increment-us`: the increments of a protractor in US units (INFO §5.71). */
export type IncrementUs = ElementOf<"qti-increment-us">;

/** A `qti-major-increment`: the major increment of a ruler or protractor (INFO §7.31, 7.32, 7.35, 7.42). */
export type MajorIncrement = ElementOf<"qti-major-increment">;

/** A `qti-minimum-length`: the shortest length that a rule measures (INFO §5.127, 5.164). */
export type MinimumLength = ElementOf<"qti-minimum-length">;

/** A `qti-minor-increment`: the minor increment of a ruler or protractor (INFO §7.31, 7.32, 7.35, 7.42). */
export type MinorIncrement = ElementOf<"qti-minor-increment">;

/** A `qti-physical-material`: a physical material (INFO §5.33). */
export type PhysicalMaterial = ElementOf<"qti-physical-material">;

/** A `qti-protractor`: a protractor that the candidate may use (INFO §5.110). */
export type Protractor = ElementOf<"qti-protractor">;

/** A `qti-resource-icon`: the icon of a digital material or calculator (INFO §5.80). */
export type ResourceIcon = ElementOf<"qti-resource-icon">;

/** A `qti-rule`: a ruler that the candidate may use (INFO §5.126). */
export type Rule = ElementOf<"qti-rule">;

/** A `qti-rule-system-si`: the SI units of a ruler (INFO §5.127). */
export type RuleSystemSi = ElementOf<"qti-rule-system-si">;

/** A `qti-rule-system-us`: the US units of a ruler (INFO §5.164). */
export type RuleSystemUs = ElementOf<"qti-rule-system-us">;
