import type {
  ContextDeclaration,
  OutcomeDeclaration,
  ResponseDeclaration,
  TemplateDeclaration,
  ValueElement,
} from "../asi/index.js";
import { ProcessingError } from "../errors.js";
import {
  COMPLETION_STATUS,
  DURATION,
  NUM_ATTEMPTS,
  QTI_CONTEXT,
  readDeclaredValue,
  readPrimitive,
  type VariableType,
} from "../processing/index.js";
import type { BaseType } from "../values/index.js";
import type { Findings } from "./findings.js";
import { checkStandardOutcome } from "./standard-outcomes.js";

type Declaration = ContextDeclaration | ResponseDeclaration | OutcomeDeclaration | TemplateDeclaration;

/** The built-in variables, whose identifiers a declaration must not use. */
const RESERVED = new Set([NUM_ATTEMPTS, DURATION, COMPLETION_STATUS, QTI_CONTEXT]);

/** The declarations of one kind, with the element that declares them. */
interface DeclarationGroup {
  /** The name of the declaring element, such as `qti-response-declaration`. */
  readonly element: string;
  /** The declarations. */
  readonly declarations: readonly Declaration[];
}

/** The variable declarations of an item or a test, by the identifier they must not use. */
export interface DeclarationScope {
  /** What holds the declarations, `item` or `test`, for messages. */
  readonly owner: "item" | "test";
  /** The element path of the holder, such as `qti-assessment-item`. */
  readonly trail: string;
  /** The identifiers of the variables that the holder has without declaring them, which must not be declared. */
  readonly builtIn: readonly string[];
  /** The declarations of each kind, in document order. */
  readonly groups: readonly DeclarationGroup[];
}

function typeOf(declaration: Declaration): VariableType {
  return declaration;
}

/**
 * Checks the variable declarations of an item or a test: that no built-in variable is declared and no
 * identifier twice; that a variable that is not a record has a base type; that the standard outcomes have
 * their types; and that every declared value, mapping key and lookup table value is written in the lexical form
 * of the base type, so that processing cannot meet a value it cannot read.
 *
 * @param findings - The findings of the document, which receive the issues.
 * @param scope - The declarations of the item or the test.
 */
export function checkDeclarations(findings: Findings, scope: DeclarationScope): void {
  const seen = new Set<string>();
  for (const { element, declarations } of scope.groups) {
    for (const declaration of declarations) {
      const here = `${scope.trail}/${element}`;
      const { identifier } = declaration;
      if (RESERVED.has(identifier) && scope.builtIn.includes(identifier)) {
        const message = `The identifier ${JSON.stringify(identifier)} names a built-in variable of the ${scope.owner}, which must not be declared.`;
        findings.error("assesskit/validate/reserved-identifier", message, here);
      } else if (seen.has(identifier)) {
        const message = `The identifier ${JSON.stringify(identifier)} is declared twice in the ${scope.owner}; the identifiers of its variables must be unique.`;
        findings.error("assesskit/validate/duplicate-identifier", message, here);
      }
      seen.add(identifier);
      checkDeclared(findings, element, declaration, here);
    }
  }
}

function checkDeclared(findings: Findings, element: string, declaration: Declaration, here: string): void {
  const { identifier, cardinality, baseType } = declaration;
  if (cardinality !== "record" && baseType === undefined) {
    const message = `The variable ${JSON.stringify(identifier)} has the cardinality ${cardinality} and no base-type; only a record has none.`;
    findings.error("assesskit/validate/base-type", message, here);
    return;
  }
  if (element === "qti-outcome-declaration") checkStandardOutcome(findings, identifier, baseType, here);
  checkValues(findings, identifier, declaration, here);
}

/** Reads a declared value as processing does, and reports it when processing could not. */
function checkValue(findings: Findings, read: () => unknown, here: string): void {
  try {
    read();
  } catch (error) {
    if (!(error instanceof ProcessingError)) throw error;
    findings.error("assesskit/validate/declared-value", error.message, here);
  }
}

function checkValues(findings: Findings, identifier: string, declaration: Declaration, here: string): void {
  const type = typeOf(declaration);
  const read = (values: readonly ValueElement[] | undefined, what: string): void =>
    checkValue(findings, () => readDeclaredValue(values, type, `${what} of ${identifier}`), here);
  read(declaration.defaultValue?.values, "The default value");
  if (declaration.kind === "outcome-declaration" && declaration.baseType !== undefined) {
    checkLookupTable(findings, declaration, declaration.baseType, here);
  }
  if (declaration.kind === "response-declaration") {
    read(declaration.correctResponse?.values, "The correct response");
    const { baseType } = declaration;
    for (const entry of declaration.mapping?.mapEntries ?? []) {
      if (baseType !== undefined) {
        checkValue(findings, () => readPrimitive(entry.mapKey, baseType, `The map key of ${identifier}`), here);
      }
    }
  }
}

/** Reads the values a lookup table gives, which are values of the outcome's base type. */
function checkLookupTable(findings: Findings, declaration: OutcomeDeclaration, baseType: BaseType, here: string): void {
  const { lookupTable: table, identifier } = declaration;
  if (table === undefined) return;
  const entries = table.kind === "match-table" ? table.matchTableEntries : table.interpolationTableEntries;
  const texts = [
    ...entries.map((entry) => entry.targetValue),
    ...(table.defaultValue === undefined ? [] : [table.defaultValue]),
  ];
  for (const text of texts) {
    checkValue(findings, () => readPrimitive(text, baseType, `The lookup table of ${identifier}`), here);
  }
}
