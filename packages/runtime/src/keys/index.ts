/**
 * The key model of a QTI item's responses: what is right for a choice, pairs, an order, areas, a text, a number or an
 * expression, how a response scores against it, and the limits of a key. The operators read the keys that QTI's own
 * expressions cannot score, and `compileScoring` of `@assesskit/runtime/scoring` writes every key into response processing.
 *
 * @module @assesskit/runtime/keys
 */
export { DEFAULT_KEY_LIMITS, type KeyLimits } from "./limits.js";
export type {
  Area,
  AreasKey,
  ChoiceKey,
  ChoiceMappingKey,
  ChoiceMarkingKey,
  ExpressionKey,
  FollowThrough,
  Interval,
  Key,
  KeyedAreasKey,
  LengthEffect,
  LengthRule,
  LengthUnit,
  NumberCredit,
  NumberKey,
  OrderKey,
  PairsKey,
  ScoredResponse,
  TextAnswer,
  TextCredit,
  TextKey,
  TextNormalization,
  Tolerance,
  VariableRange,
} from "./model.js";
