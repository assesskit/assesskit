import type { BodyNode, Catalog, CompanionMaterialsInfo } from "../asi/index.js";
import type { PnpHazardTerm } from "../content/index.js";
import type { InteractionDescriptor } from "../interactions/index.js";
import type { SupportName, SupportSetting, SupportState } from "../pnp/index.js";
import type { Value } from "../values/index.js";
import type { CandidateAction } from "./action.js";
import type { Deadline } from "./deadlines.js";
import type { DeliveryStatus } from "./delivery-state.js";
import type { ItemSessionStatus } from "./item-session.js";
import type { ItemKey } from "./plan.js";

/**
 * A section of the navigation map: a visible section that holds an item the map lists.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export interface NavigationSection {
  /** Tells a section from an item. */
  readonly kind: "section";
  /** The identifier of the section. */
  readonly identifier: string;
  /** The title of the section. */
  readonly title: string;
  /** How many visible sections hold it, from 0. */
  readonly depth: number;
}

/** An item instance of the navigation map. */
export interface NavigationItem {
  /** Tells an item from a section. */
  readonly kind: "item";
  /** The item instance. */
  readonly key: ItemKey;
  /** The title of the item, of the variant when one was presented. */
  readonly title: string;
  /** How many visible sections hold it, from 0. */
  readonly depth: number;
  /** The state of its item session; `initial` before it is presented. */
  readonly status: ItemSessionStatus;
  /** Whether it is the item presented. */
  readonly current: boolean;
  /** Whether the candidate marked it for review. */
  readonly marked: boolean;
  /**
   * Whether a `move` to it changes the item presented: another item of a nonlinear test part that no maximum time closed.
   * After the end, whether a `review` of it does: another item whose item session control allows review.
   */
  readonly reachable: boolean;
}

/**
 * An entry of the navigation map: the visible sections and the item instances of the test part presented, in the order
 * of presentation.
 *
 * @remarks
 * A nonlinear part lists every instance; a linear part lists those presented so far, because it moves forward only.
 * Instances of invisible sections stand at the depth of the section that holds them.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export type NavigationEntry = NavigationSection | NavigationItem;

/**
 * The time left in a scope that has a time limit.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export interface TimerView {
  /** The kind of the scope. */
  readonly scope: Deadline["scope"];
  /** The identifier of the item reference, section, test part or test. */
  readonly identifier: string;
  /** The milliseconds until the maximum time; 0 once it passed with late submission. Absent when there is none. */
  readonly remaining?: number;
  /** The milliseconds until the minimum time; absent when there is none or it was reached. */
  readonly minimumRemaining?: number;
  /** Whether the maximum time passed and the scope still takes submissions. */
  readonly late: boolean;
}

/**
 * A support of the candidate session as the candidate sees it.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide}
 */
export interface SupportView {
  /** The support. */
  readonly name: SupportName;
  /** What the profile says about it: `option` is a control the candidate turns on or off with a `support` action. */
  readonly state: SupportState;
  /** Whether it is on. */
  readonly active: boolean;
  /** The settings of the profile; absent when it gives none and for a prohibited support. */
  readonly settings?: SupportSetting;
}

/** A stimulus of the item presented, after resolution. */
export interface StimulusView {
  /** The identifier of the stimulus. */
  readonly identifier: string;
  /** Its body after resolution. */
  readonly body: readonly BodyNode[];
}

/** The variant presented in place of an item. */
export interface VariantView {
  /** The identifier of the manifest resource of the variant. */
  readonly resource: string;
  /** The language of its adaptation, a BCP 47 tag; absent when the resource names none. */
  readonly language?: string;
}

/**
 * The state of a portable custom interaction that the item passes to its module.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide}
 */
export interface PciView {
  /** The template variables the interaction names with `qti-template-variable`, by identifier. */
  readonly templateValues: ReadonlyMap<string, Value | null>;
  /** The context variables the interaction names with `qti-context-variable`, by identifier. */
  readonly contextValues: ReadonlyMap<string, Value | null>;
  /** The latest state the module stored, opaque to the engine; absent before it stored one. */
  readonly state?: string;
}

/** A hazard of the item presented, in the terms of the PNP. */
export interface HazardView {
  /** The hazard. */
  readonly hazard: PnpHazardTerm;
  /** Whether the candidate avoids it, so that the player withholds the media that has it. */
  readonly avoided: boolean;
}

/** The link to a tool that an LTI item presents. */
export interface LtiView {
  /** The title of the link. */
  readonly title: string;
  /** The description of the link. */
  readonly description?: string;
  /** The URL that starts the tool. */
  readonly launchUrl?: string;
  /** The URL that starts the tool over a secure connection. */
  readonly secureLaunchUrl?: string;
  /** The custom properties of the launch, by name. */
  readonly custom: ReadonlyMap<string, string>;
}

/**
 * The item instance presented, as the candidate sees it.
 *
 * @remarks
 * It holds the content after resolution — feedback, template content and printed variables settled, hidden choices
 * removed, choices in presentation order — and never an answer key, a mapping, processing, a template or outcome value,
 * or content that is hidden. References in the content are as the item writes them, against the document of the item;
 * `stylesheets` are package paths.
 */
export interface CandidateItem {
  /** The item instance. */
  readonly key: ItemKey;
  /** The title of the item, of the variant when one was presented. */
  readonly title: string;
  /** The label of the item. */
  readonly label?: string;
  /** The language of the item, a BCP 47 tag. */
  readonly language?: string;
  /** Whether the item is time dependent. */
  readonly timeDependent: boolean;
  /** The state of its item session. */
  readonly status: ItemSessionStatus;
  /** The attempts started, the open one included. */
  readonly numAttempts: number;
  /** The attempts left including the open one; absent when the item allows any number. */
  readonly attemptsLeft?: number;
  /** The content of the item body after resolution. */
  readonly body: readonly BodyNode[];
  /** The stimuli the item shares, each with its body after resolution. */
  readonly stimuli: readonly StimulusView[];
  /** The package paths of the stylesheets of the item and its stimuli, each once. */
  readonly stylesheets: readonly string[];
  /** The catalogs of the cards that the visible content refers to. */
  readonly catalogs: readonly Catalog[];
  /** The materials that go with the item. */
  readonly companionMaterials?: CompanionMaterialsInfo;
  /** The interactions in the content, with their choices in the order of presentation. */
  readonly interactions: readonly InteractionDescriptor[];
  /**
   * The responses of the interactions, by response identifier: the drafts while the session is open, the submitted
   * responses once it closed, and in the solution state the correct responses.
   */
  readonly responses: ReadonlyMap<string, Value | null>;
  /** The modal feedback that is shown. */
  readonly modalFeedback: readonly BodyNode[];
  /** What each portable custom interaction receives, by response identifier. */
  readonly pci: ReadonlyMap<string, PciView>;
  /** The variant presented in place of the item; absent when the item itself is. */
  readonly variant?: VariantView;
  /** The hazards of the item presented. */
  readonly hazards: readonly HazardView[];
  /** The link to the tool, for an item that models one. */
  readonly lti?: LtiView;
}

/** The test the candidate takes. */
export interface TestView {
  /** The identifier of the test. */
  readonly identifier: string;
  /** Its title. */
  readonly title: string;
}

/** The test part the candidate is in. */
export interface PartView {
  /** The identifier of the test part. */
  readonly identifier: string;
  /** Whether the candidate moves forward only. */
  readonly navigationMode: "linear" | "nonlinear";
  /** How the part submits its items; an adaptive section submits item by item in either mode. */
  readonly submissionMode: "individual" | "simultaneous";
}

/**
 * What the candidate sees of a candidate session: the engine builds it from the state field by field, and nothing else
 * reaches it.
 */
export interface CandidateView {
  /**
   * Whether the session runs, is suspended or has ended. A suspended session shows no item, and neither does an ended one,
   * unless the engine allows a review after the end and the candidate is reviewing an item.
   */
  readonly status: DeliveryStatus;
  /** The test. */
  readonly test: TestView;
  /** The test part presented; absent once the test has ended, unless an item is being reviewed: then its part. */
  readonly part?: PartView;
  /**
   * The navigation map; empty unless the session runs, or the test has ended and the engine allows a review: then the items
   * presented, in every test part, reachable where review is allowed.
   */
  readonly navigation: readonly NavigationEntry[];
  /** The item presented; absent unless the session runs, or the test has ended and an item is being reviewed. */
  readonly current?: CandidateItem;
  /** The rubric for the candidate: of the test, then of the test part, then of the sections from the top down (F-m25). */
  readonly rubric: readonly BodyNode[];
  /** The test feedback that is shown: the `during` feedback while the session runs, the `atEnd` feedback once it ended. */
  readonly testFeedback: readonly BodyNode[];
  /** The time limits that run; none unless the session runs. */
  readonly timers: readonly TimerView[];
  /**
   * The types of the actions of the candidate that the state allows; the data of an action can still make it refused. Once
   * the test has ended it is empty, or with a review after the end `review` and `solution` where an item allows them.
   */
  readonly actions: readonly CandidateAction["type"][];
  /** The supports of the session. */
  readonly supports: readonly SupportView[];
}
