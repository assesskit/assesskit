import type { Interaction } from "../asi/index.js";
import type { BaseType, Cardinality, ValueDeclaration } from "../values/index.js";

/** The kind of an interaction: the name of its element without `qti-`, such as `"choice-interaction"` (INFO §2.4). */
export type InteractionKind = Interaction["kind"];

/**
 * A response variable that an interaction can be bound to: a cardinality and, except for a record, the base types
 * allowed with it (INFO §2.4). A record has no base type, so its list is empty.
 */
export interface Binding {
  /** The cardinality. */
  readonly cardinality: Cardinality;
  /** The base types that the interaction accepts with the cardinality; empty for a record. */
  readonly baseTypes: readonly BaseType[];
}

/**
 * One choice of an interaction, in the broad sense of the word: a choice, an associable choice, a hotspot, a gap or a
 * hot text. Only what the rules of validity, shuffling and visibility read is here; the content of the choice stays in
 * the body.
 */
export interface ChoiceDescriptor {
  /** The identifier, which a response names (INFO §4.1.1). */
  readonly identifier: string;
  /** Whether the position of the choice holds when the choices are shuffled (INFO §5.132.2). */
  readonly fixed: boolean;
  /** The template variable that makes the choice visible or hidden (INFO §2.7.1). Absent: the choice is always visible. */
  readonly templateIdentifier?: string;
  /** How the template variable decides: `show` hides the choice unless the variable names it, `hide` the other way round. */
  readonly showHide: "show" | "hide";
  /** The most associations the choice takes (INFO §5.131.6); absent when there is no limit. */
  readonly matchMax?: number;
  /** The fewest associations the choice needs for a valid response (INFO §5.131.7); absent when there is none. */
  readonly matchMin?: number;
  /** The identifiers of the choices that this one can be associated with; absent when any can (INFO §5.131.5). */
  readonly matchGroup?: readonly string[];
  /** Whether a gap must be filled for a valid response (INFO §5.55.5). */
  readonly required?: boolean;
}

/**
 * What an interaction demands of a valid response (INFO §2.4). A field is absent when it demands nothing: a minimum of 0,
 * a maximum of 0, which means no restriction, or an attribute the interaction does not have.
 */
export interface InteractionConstraints {
  /** The fewest choices, hotspots or points (INFO §5.30.3). */
  readonly minChoices?: number;
  /** The most choices, hotspots or points (INFO §5.30.2). */
  readonly maxChoices?: number;
  /** The fewest associations (INFO §5.89.3). */
  readonly minAssociations?: number;
  /** The most associations (INFO §5.89.2). */
  readonly maxAssociations?: number;
  /** The fewest non-empty strings of an extended text (INFO §5.48.7). */
  readonly minStrings?: number;
  /** The most strings of an extended text (INFO §5.48.6). */
  readonly maxStrings?: number;
  /** The fewest times a media object is played (INFO §5.92.2). */
  readonly minPlays?: number;
  /** The most times a media object is played (INFO §5.92.3). */
  readonly maxPlays?: number;
  /** The lowest value of a slider, rounded down when the response is an integer (INFO §5.134.1). */
  readonly lowerBound?: number;
  /** The highest value of a slider, rounded up when the response is an integer (INFO §5.134.2). */
  readonly upperBound?: number;
  /** The step of a slider; 1 for an integer response without a declared step (INFO §5.134.3). */
  readonly step?: number;
  /** The pattern in the regular expression language of XML Schema that a text response must match (INFO §5.162.5). */
  readonly patternMask?: string;
  /** The MIME types an upload may have (INFO §5.165.1); absent when any file is accepted. */
  readonly mimeTypes?: readonly string[];
  /** Whether a choice must be selected (INFO §5.74.2). */
  readonly required?: boolean;
  /** The number base in which a numeric text is read (INFO §5.162.2); 10 by default. */
  readonly base?: number;
}

/** Everything the delivery engine and the player need to know about one interaction, without its content (INFO §2.4). */
export interface InteractionDescriptor {
  /** The kind of the interaction. */
  readonly kind: InteractionKind;
  /** The response variable the interaction is bound to. */
  readonly responseIdentifier: string;
  /** The declared cardinality and base type of that variable; absent when the item does not declare it. */
  readonly declaration?: ValueDeclaration;
  /** The bindings the interaction accepts, narrowed by its attributes: more than one choice needs a container. */
  readonly bindings: readonly Binding[];
  /** Every choice in document order; a match interaction lists the first set, then the second. */
  readonly choices: readonly ChoiceDescriptor[];
  /**
   * The two sets of choices that a response pairs, as directed pairs from the first to the second: the sets of a match
   * interaction, the gap choices and the gaps of a gap match interaction, and the gap choices and the hotspots of a
   * graphic gap match interaction. Absent for the other kinds.
   */
  readonly matchSets?: readonly (readonly ChoiceDescriptor[])[];
  /** What a valid response needs. */
  readonly constraints: InteractionConstraints;
  /** Whether the initial order of the choices is random, subject to `fixed` (INFO §5.30.1). */
  readonly shuffle: boolean;
  /** The second response variable that keeps the text as typed (INFO §5.162.3); absent when there is none. */
  readonly stringIdentifier?: string;
}
