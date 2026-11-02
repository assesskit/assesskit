import type { AttributeDef, ElementVisit, StringFormat } from "../asi/index.js";
import { isIdentifier } from "../values/index.js";
import type { Findings } from "./findings.js";
import { elementPath } from "./model-access.js";

/** The most characters an identifier should have, for compatibility with QTI version 1. */
const RECOMMENDED_IDENTIFIER_LENGTH = 32;

/** The elements whose `identifier` is a name for the rest of the document or test: a period is reserved in it for prefixes. */
const NAMING_ELEMENTS = new Set([
  "qti-assessment-item",
  "qti-assessment-section",
  "qti-assessment-section-ref",
  "qti-assessment-item-ref",
  "qti-assessment-stimulus",
  "qti-assessment-test",
  "qti-context-declaration",
  "qti-outcome-declaration",
  "qti-response-declaration",
  "qti-template-declaration",
  "qti-test-part",
]);

/** The element that the target of a reference to an `id` must be, by the attribute that holds it. */
const REFERENCE_TARGETS: ReadonlyMap<string, { readonly target: string }> = new Map([
  ["data-catalog-idref", { target: "qti-catalog" }],
  ["variable-identifier-ref", { target: "qti-response-declaration" }],
]);

/** The formats of text that the checks read. */
type CheckedFormat = Extract<StringFormat, "identifier" | "id" | "idref">;

/** An attribute of a type whose text, or each of whose texts, has a format that the checks read. */
interface FormattedAttribute {
  readonly definition: AttributeDef;
  readonly format: CheckedFormat;
  /** Whether the attribute holds a list of texts rather than one. */
  readonly list: boolean;
}

const isChecked = (format: StringFormat | undefined): format is CheckedFormat =>
  format === "identifier" || format === "id" || format === "idref";

/** The attributes of each list of a type that the checks read, made once for the list, which the type keeps. */
const FORMATTED = new WeakMap<readonly AttributeDef[], readonly FormattedAttribute[]>();

/** Returns the attributes of a list whose text has a format that the checks read, in the order of the list. */
function formattedOf(attributes: readonly AttributeDef[]): readonly FormattedAttribute[] {
  const known = FORMATTED.get(attributes);
  if (known !== undefined) return known;
  const found = attributes.flatMap((definition): FormattedAttribute[] => {
    const { type } = definition;
    if (type.kind === "string" && isChecked(type.format)) return [{ definition, format: type.format, list: false }];
    if (type.kind === "list" && type.item.kind === "string" && isChecked(type.item.format)) {
      return [{ definition, format: type.item.format, list: true }];
    }
    return [];
  });
  FORMATTED.set(attributes, found);
  return found;
}

/** A reference to an `id` that is checked once the whole document is walked. */
interface Reference {
  readonly attribute: string;
  readonly value: string;
  readonly element: ElementVisit;
}

/**
 * Checks the formats of the text attributes of a document, which the reader does not check: identifiers are names, an
 * `id` is unique in the document and a reference to an `id` names one (the schema's `xs:ID` and
 * `xs:IDREF`).
 */
export class FormatChecks {
  private readonly findings: Findings;
  private readonly ids = new Map<string, ElementVisit>();
  private readonly references: Reference[] = [];

  /**
   * Starts the checks of a document.
   *
   * @param findings - The findings of the document, which receive the issues.
   */
  constructor(findings: Findings) {
    this.findings = findings;
  }

  /**
   * Checks the attributes of one element.
   *
   * @param visit - The element that the walk of the document reached.
   */
  visit(visit: ElementVisit): void {
    for (const { definition, format, list } of formattedOf(visit.attributes)) {
      const value = visit.model[definition.property];
      if (!list) {
        if (typeof value === "string") this.check(visit, definition, format, value);
      } else if (Array.isArray(value)) {
        for (const text of value) if (typeof text === "string") this.check(visit, definition, format, text);
      }
    }
  }

  private check(visit: ElementVisit, definition: AttributeDef, format: CheckedFormat, text: string): void {
    if (format === "identifier") this.identifier(visit, definition, text);
    else if (format === "id") this.id(visit, definition, text);
    else this.references.push({ attribute: definition.name, value: text, element: visit });
  }

  /** Resolves the references to an `id`, after every element has been visited. */
  finish(): void {
    for (const { attribute, value, element } of this.references) {
      const target = this.ids.get(value);
      const expected = REFERENCE_TARGETS.get(attribute);
      const here = elementPath(element);
      if (target === undefined) {
        const message = `The attribute ${attribute} of the ${element.name} refers to ${JSON.stringify(value)}, which is the id of no element of the document.`;
        this.findings.error("assesskit/validate/unresolved-reference", message, here);
      } else if (expected !== undefined && target.name !== expected.target) {
        const message = `The attribute ${attribute} of the ${element.name} refers to ${JSON.stringify(value)}, the id of a ${target.name}, but it must name a ${expected.target}.`;
        this.findings.error("assesskit/validate/unresolved-reference", message, here);
      }
    }
  }

  private identifier(visit: ElementVisit, definition: AttributeDef, text: string): void {
    if (!isIdentifier(text)) {
      this.notIdentifier(visit, definition, text);
      return;
    }
    if (definition.name !== "identifier" || !NAMING_ELEMENTS.has(visit.name)) return;
    if (text.includes(".")) {
      const message = `The identifier ${JSON.stringify(text)} of the ${visit.name} contains a period, which is reserved for prefixing the identifier of an item reference to a variable.`;
      this.findings.warning("assesskit/validate/identifier-style", message, elementPath(visit));
    }
    if ([...text].length > RECOMMENDED_IDENTIFIER_LENGTH) {
      const message = `The identifier ${JSON.stringify(text)} of the ${visit.name} has more than ${RECOMMENDED_IDENTIFIER_LENGTH} characters, which version 1 of QTI does not take.`;
      this.findings.warning("assesskit/validate/identifier-style", message, elementPath(visit));
    }
  }

  private notIdentifier(visit: ElementVisit, definition: AttributeDef, text: string): void {
    const message = `The attribute ${definition.name} of the ${visit.name} is ${JSON.stringify(text)}, which is not an identifier: it must start with a letter or an underscore and contain only letters, digits, underscores, hyphens and periods.`;
    this.findings.error("assesskit/validate/identifier-syntax", message, elementPath(visit));
  }

  private id(visit: ElementVisit, definition: AttributeDef, text: string): void {
    if (!isIdentifier(text)) {
      this.notIdentifier(visit, definition, text);
      return;
    }
    const first = this.ids.get(text);
    if (first === undefined) {
      this.ids.set(text, visit);
      return;
    }
    const message = `The id ${JSON.stringify(text)} of the ${visit.name} is also the id of a ${first.name}; an id must be unique in the document.`;
    this.findings.error("assesskit/validate/duplicate-id", message, elementPath(visit));
  }
}
