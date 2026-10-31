import type { AssessmentItem, OutcomeDeclaration, ResponseDeclaration } from "../asi/index.js";
import type { VariableType } from "./assign.js";
import { BUILT_IN_CONTEXTS, BUILT_IN_OUTCOMES, BUILT_IN_RESPONSES } from "./built-ins.js";

/** The kinds of item variables. */
export type Kind = "context" | "response" | "outcome" | "template";

/** The variables that an item declares, by identifier, with the built-in ones. */
export interface ItemIndex {
  /** The kind of each variable. */
  readonly kinds: ReadonlyMap<string, Kind>;
  /** The cardinality and base type of each variable. */
  readonly types: ReadonlyMap<string, VariableType>;
  /** The declaration of each response variable, the built-in ones excepted. */
  readonly responseDeclarations: ReadonlyMap<string, ResponseDeclaration>;
  /** The declaration of each outcome, the built-in ones excepted. */
  readonly outcomeDeclarations: ReadonlyMap<string, OutcomeDeclaration>;
  /** The template variables, in the order of their declarations. */
  readonly templateIdentifiers: readonly string[];
}

/** The indexes of the items that sessions have used: an item never changes, so its declarations are read once. */
const INDEXES = new WeakMap<AssessmentItem, ItemIndex>();

/**
 * Returns the variables of an item by identifier. A later declaration of an identifier replaces an earlier one.
 *
 * @param item - The item, as `readAsi` reads it.
 */
export function itemIndex(item: AssessmentItem): ItemIndex {
  const known = INDEXES.get(item);
  if (known !== undefined) return known;
  const kinds = new Map<string, Kind>();
  const types = new Map<string, VariableType>();
  const responseDeclarations = new Map<string, ResponseDeclaration>();
  const outcomeDeclarations = new Map<string, OutcomeDeclaration>();
  const declare = (kind: Kind, identifier: string, type: VariableType): void => {
    kinds.set(identifier, kind);
    types.set(identifier, type);
  };
  for (const [identifier, type] of BUILT_IN_CONTEXTS) declare("context", identifier, type);
  for (const [identifier, type] of BUILT_IN_RESPONSES) declare("response", identifier, type);
  for (const [identifier, type] of BUILT_IN_OUTCOMES) declare("outcome", identifier, type);
  for (const declaration of item.contextDeclarations) declare("context", declaration.identifier, declaration);
  for (const declaration of item.responseDeclarations) {
    declare("response", declaration.identifier, declaration);
    responseDeclarations.set(declaration.identifier, declaration);
  }
  for (const declaration of item.outcomeDeclarations) {
    declare("outcome", declaration.identifier, declaration);
    outcomeDeclarations.set(declaration.identifier, declaration);
  }
  for (const declaration of item.templateDeclarations) declare("template", declaration.identifier, declaration);
  const templateIdentifiers = [...kinds].flatMap(([identifier, kind]) => (kind === "template" ? [identifier] : []));
  const index = { kinds, types, responseDeclarations, outcomeDeclarations, templateIdentifiers };
  INDEXES.set(item, index);
  return index;
}
