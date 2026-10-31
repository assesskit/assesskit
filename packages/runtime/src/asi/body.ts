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
 * a part of this union.
 */
export type BodyNode = Accepted<FlowSlots["accepts"][number]> | XmlElement | TextNode;

/**
 * An HTML element of the ASI schema: the 76 elements of the HTML that the schema allows. Narrow it by `kind`, which is
 * the name of the element, such as `"p"` or `"img"`. The attributes the schema gives the element are properties; a
 * `data-*` attribute is in `extensions`.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/bind/ | QTI 3.0 ASI XML Binding, HTML elements}
 */
export type HtmlElement = Accepted<HtmlAccept<Accepts>>;

/**
 * An interaction: an element that presents a task and binds a response variable.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, interactions}
 */
export type Interaction = Accepted<InteractionAccept<Accepts>>;

/** A `qti-associate-interaction`: the candidate pairs the choices. */
export type AssociateInteraction = ElementOf<"qti-associate-interaction">;

/** A `qti-choice-interaction`: the candidate selects one or more choices. */
export type ChoiceInteraction = ElementOf<"qti-choice-interaction">;

/** A `qti-custom-interaction`: an interaction that the delivery system defines, with content of its own. */
export type CustomInteraction = ElementOf<"qti-custom-interaction">;

/** A `qti-drawing-interaction`: the candidate draws on an image. */
export type DrawingInteraction = ElementOf<"qti-drawing-interaction">;

/** A `qti-end-attempt-interaction`: a button that ends the attempt. */
export type EndAttemptInteraction = ElementOf<"qti-end-attempt-interaction">;

/** A `qti-extended-text-interaction`: the candidate writes a longer text. */
export type ExtendedTextInteraction = ElementOf<"qti-extended-text-interaction">;

/** A `qti-gap-match-interaction`: the candidate drops choices into the gaps of a text. */
export type GapMatchInteraction = ElementOf<"qti-gap-match-interaction">;

/** A `qti-graphic-associate-interaction`: the candidate pairs the hotspots of an image. */
export type GraphicAssociateInteraction = ElementOf<"qti-graphic-associate-interaction">;

/** A `qti-graphic-gap-match-interaction`: the candidate drops choices onto the hotspots of an image. */
export type GraphicGapMatchInteraction = ElementOf<"qti-graphic-gap-match-interaction">;

/** A `qti-graphic-order-interaction`: the candidate puts the hotspots of an image in order. */
export type GraphicOrderInteraction = ElementOf<"qti-graphic-order-interaction">;

/** A `qti-hotspot-interaction`: the candidate selects areas of an image. */
export type HotspotInteraction = ElementOf<"qti-hotspot-interaction">;

/** A `qti-hottext-interaction`: the candidate selects words or phrases of a text. */
export type HotTextInteraction = ElementOf<"qti-hottext-interaction">;

/** A `qti-inline-choice-interaction`: the candidate picks from a menu inside a sentence. */
export type InlineChoiceInteraction = ElementOf<"qti-inline-choice-interaction">;

/** A `qti-match-interaction`: the candidate pairs the choices of two sets. */
export type MatchInteraction = ElementOf<"qti-match-interaction">;

/** A `qti-media-interaction`: audio or video that the candidate plays, with the plays counted. */
export type MediaInteraction = ElementOf<"qti-media-interaction">;

/** A `qti-order-interaction`: the candidate puts the choices in order. */
export type OrderInteraction = ElementOf<"qti-order-interaction">;

/** A `qti-portable-custom-interaction`: an interaction that a module delivered with the item provides. */
export type PortableCustomInteraction = ElementOf<"qti-portable-custom-interaction">;

/** A `qti-position-object-interaction`: the candidate positions an object on an image. */
export type PositionObjectInteraction = ElementOf<"qti-position-object-interaction">;

/** A `qti-position-object-stage`: the image on which position object interactions place their objects. */
export type PositionObjectStage = ElementOf<"qti-position-object-stage">;

/** A `qti-select-point-interaction`: the candidate marks points on an image. */
export type SelectPointInteraction = ElementOf<"qti-select-point-interaction">;

/** A `qti-slider-interaction`: the candidate chooses a number on a slider. */
export type SliderInteraction = ElementOf<"qti-slider-interaction">;

/** A `qti-text-entry-interaction`: the candidate types a short answer. */
export type TextEntryInteraction = ElementOf<"qti-text-entry-interaction">;

/** A `qti-upload-interaction`: the candidate uploads a file. */
export type UploadInteraction = ElementOf<"qti-upload-interaction">;

/** A `qti-associable-hotspot`: an area of an image that takes associations. */
export type AssociableHotspot = ElementOf<"qti-associable-hotspot">;

/** A `qti-gap`: a gap in the text of a gap match interaction. */
export type Gap = ElementOf<"qti-gap">;

/** A `qti-gap-img`: an image that the candidate drops into a gap. */
export type GapImg = ElementOf<"qti-gap-img">;

/** A `qti-gap-text`: a text that the candidate drops into a gap. */
export type GapText = ElementOf<"qti-gap-text">;

/** A `qti-hotspot-choice`: an area of an image that the candidate selects. */
export type HotspotChoice = ElementOf<"qti-hotspot-choice">;

/** A `qti-hottext`: a word or phrase of a text that the candidate selects. */
export type HotText = ElementOf<"qti-hottext">;

/** A `qti-inline-choice`: one entry of the menu of an inline choice interaction. */
export type InlineChoice = ElementOf<"qti-inline-choice">;

/** A `qti-label`: the label of an inline choice interaction. */
export type Label = ElementOf<"qti-label">;

/** A `qti-prompt`: the instruction that an interaction shows to the candidate. */
export type Prompt = ElementOf<"qti-prompt">;

/** A `qti-simple-associable-choice`: a choice that takes associations. */
export type SimpleAssociableChoice = ElementOf<"qti-simple-associable-choice">;

/** A `qti-simple-choice`: a choice that the candidate selects or puts in order. */
export type SimpleChoice = ElementOf<"qti-simple-choice">;

/** A `qti-simple-match-set`: one set of the choices of a match interaction. */
export type SimpleMatchSet = ElementOf<"qti-simple-match-set">;

/**
 * A `qti-context-variable`: a context variable that a portable custom interaction reads. Its name differs
 * from the element's, which `results` uses for a reported variable.
 */
export type PciContextVariable = ElementOf<"qti-context-variable">;

/** A `qti-interaction-markup`: the markup of a portable custom interaction. */
export type InteractionMarkup = ElementOf<"qti-interaction-markup">;

/** A `qti-interaction-module`: a module of a portable custom interaction. */
export type InteractionModule = ElementOf<"qti-interaction-module">;

/** A `qti-interaction-modules`: the modules of a portable custom interaction, and where their configuration is. */
export type InteractionModules = ElementOf<"qti-interaction-modules">;

/**
 * A `qti-template-variable`: a template variable that a portable custom interaction reads. Its name differs
 * from the element's, which `results` uses for a reported variable.
 */
export type PciTemplateVariable = ElementOf<"qti-template-variable">;

/** A `qti-card`: the content of one support in a catalog. */
export type Card = ElementOf<"qti-card">;

/** A `qti-card-entry`: the content of a card in one language. */
export type CardEntry = ElementOf<"qti-card-entry">;

/** A `qti-catalog`: the cards that elements refer to with `data-catalog-idref`. */
export type Catalog = ElementOf<"qti-catalog">;

/** A `qti-catalog-info`: the catalogs of an item or stimulus. */
export type CatalogInfo = ElementOf<"qti-catalog-info">;

/** A `qti-content-body`: the content of feedback, a rubric block or a template block. */
export type ContentBody = ElementOf<"qti-content-body">;

/** A `qti-feedback-block`: block content that an outcome's value shows or hides. */
export type FeedbackBlock = ElementOf<"qti-feedback-block">;

/** A `qti-feedback-inline`: inline content that an outcome's value shows or hides. */
export type FeedbackInline = ElementOf<"qti-feedback-inline">;

/** A `qti-file-href`: a file of a card, by reference. */
export type FileHref = ElementOf<"qti-file-href">;

/** A `qti-html-content`: the content of a card. */
export type HtmlContent = ElementOf<"qti-html-content">;

/** A `qti-modal-feedback`: feedback shown to the candidate after response processing. */
export type ModalFeedback = ElementOf<"qti-modal-feedback">;

/** A `qti-printed-variable`: the value of a variable, printed in the content. */
export type PrintedVariable = ElementOf<"qti-printed-variable">;

/** A `qti-rubric-block`: instructions for the people who read or score, in a body, test, part or section. */
export type RubricBlock = ElementOf<"qti-rubric-block">;

/** A `qti-template-block`: block content that a template variable shows or hides. */
export type TemplateBlock = ElementOf<"qti-template-block">;

/** A `qti-template-inline`: inline content that a template variable shows or hides. */
export type TemplateInline = ElementOf<"qti-template-inline">;

/** A `qti-test-feedback`: feedback shown to the candidate during or at the end of a test. */
export type TestFeedback = ElementOf<"qti-test-feedback">;

/** A `qti-calculator`: a calculator that the candidate may use. */
export type Calculator = ElementOf<"qti-calculator">;

/** A `qti-calculator-info`: the file of a calculator. */
export type CalculatorInfo = ElementOf<"qti-calculator-info">;

/** A `qti-calculator-type`: the kind of a calculator. `pnp` names the terms `CalculatorType`. */
export type CalculatorTypeElement = ElementOf<"qti-calculator-type">;

/** A `qti-companion-materials-info`: the materials that go with an item. */
export type CompanionMaterialsInfo = ElementOf<"qti-companion-materials-info">;

/** A `qti-description`: a description of a calculator, protractor or rule. */
export type Description = ElementOf<"qti-description">;

/** A `qti-digital-material`: a digital material, by reference. */
export type DigitalMaterial = ElementOf<"qti-digital-material">;

/** A `qti-increment-si`: the increments of a protractor in SI units. */
export type IncrementSi = ElementOf<"qti-increment-si">;

/** A `qti-increment-us`: the increments of a protractor in US units. */
export type IncrementUs = ElementOf<"qti-increment-us">;

/** A `qti-major-increment`: the major increment of a ruler or protractor. */
export type MajorIncrement = ElementOf<"qti-major-increment">;

/** A `qti-minimum-length`: the shortest length that a rule measures. */
export type MinimumLength = ElementOf<"qti-minimum-length">;

/** A `qti-minor-increment`: the minor increment of a ruler or protractor. */
export type MinorIncrement = ElementOf<"qti-minor-increment">;

/** A `qti-physical-material`: a physical material. */
export type PhysicalMaterial = ElementOf<"qti-physical-material">;

/** A `qti-protractor`: a protractor that the candidate may use. */
export type Protractor = ElementOf<"qti-protractor">;

/** A `qti-resource-icon`: the icon of a digital material or calculator. */
export type ResourceIcon = ElementOf<"qti-resource-icon">;

/** A `qti-rule`: a ruler that the candidate may use. */
export type Rule = ElementOf<"qti-rule">;

/** A `qti-rule-system-si`: the SI units of a ruler. */
export type RuleSystemSi = ElementOf<"qti-rule-system-si">;

/** A `qti-rule-system-us`: the US units of a ruler. */
export type RuleSystemUs = ElementOf<"qti-rule-system-us">;
