import type { OutcomeDeclaration, ResponseDeclaration, ResponseProcessing } from "../asi/index.js";

/** The options of `compileScoring`. */
export interface CompileScoringOptions {
  /**
   * Whether each outcome that an operator would score is externally scored by a machine (`externalMachine`), so that an
   * engine without the operators delivers the item and a host supplies the score.
   *
   * @defaultValue `false`
   */
  readonly portable?: boolean;
  /**
   * The least score of the item, under which `SCORE` never falls, as negative marks with a floor ask.
   *
   * @defaultValue none
   */
  readonly floor?: number;
  /**
   * Whether the item earns its maximum only when every response earns its own, and 0 otherwise.
   *
   * @defaultValue `false`
   */
  readonly allParts?: boolean;
}

/** The `match-max` of the choices of a match or an association that the key needs; 0 is unlimited, as QTI reads it. */
export interface MatchMax {
  /** The `match-max` of each source: the first choice of a key pair. */
  readonly source: number;
  /** The `match-max` of each target: the second choice of a key pair. */
  readonly target: number;
  /**
   * The `match-max` of the target that answers "none".
   *
   * @defaultValue none: the key has no such target
   */
  readonly none?: number;
}

/** The attributes of the interaction that binds a response, as the key needs them. */
export interface InteractionAttributes {
  /**
   * `max-choices` of a choice, a hotspot or a point selection.
   *
   * @defaultValue none: the key does not set it
   */
  readonly maxChoices?: number;
  /**
   * `max-associations` of a match, an association or a gap match.
   *
   * @defaultValue none: the key does not set it
   */
  readonly maxAssociations?: number;
  /**
   * `match-max` of the choices of a match, an association or a gap match.
   *
   * @defaultValue none: the key does not set it
   */
  readonly matchMax?: MatchMax;
  /**
   * `max-strings` of an extended text, for a response of several strings.
   *
   * @defaultValue none: the key does not set it
   */
  readonly maxStrings?: number;
}

/** The scoring of an item, as models of the runtime's ASI model, which an item takes as they are. */
export interface ItemScoring {
  /** A declaration for each response, with its correct response and its mapping where the key has them. */
  readonly responseDeclarations: readonly ResponseDeclaration[];
  /** `SCORE`, `MAXSCORE`, `SCORE_<identifier>` with several responses, and `FEEDBACK`. */
  readonly outcomeDeclarations: readonly OutcomeDeclaration[];
  /** The rules that score the responses. */
  readonly responseProcessing: ResponseProcessing;
  /** The attributes of the interaction of each response, by its identifier. */
  readonly interactions: ReadonlyMap<string, InteractionAttributes>;
  /** The definitions of the operators that the response processing calls, which a host registers with `customOperators`. */
  readonly operators: readonly string[];
}
