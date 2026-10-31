import type { AttributeDef, ElementVisit, StringFormat } from "../asi/index.js";
import { isIdentifier } from "../values/index.js";
import type { Findings } from "./findings.js";
import { elementPath } from "./model-access.js";

/** The most characters an identifier should have, for compatibility with QTI version 1 (INFO §4.1.1). */
const RECOMMENDED_IDENTIFIER_LENGTH = 32;

/** The elements whose `identifier` is a name for the rest of the document or test: a period is reserved in it for prefixes (INFO §4.1.1). */
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

/** The specification of a reference to an `id` and the element its target must be, by the attribute that holds it. */
const REFERENCE_TARGETS: ReadonlyMap<string, { readonly source: string; readonly target: string }> = new Map([
  ["data-catalog-idref", { source: "BPIG §3.7.10.2", target: "qti-catalog" }],
  ["variable-identifier-ref", { source: "INFO §4.5.11", target: "qti-response-declaration" }],
]);

/** The text or texts that an attribute of a model holds and the format its type gives them. */
function textsOf(definition: AttributeDef, value: unknown): { format?: StringFormat; texts: readonly string[] } {
  const { type } = definition;
  if (type.kind === "string")
    return typeof value === "string" ? { format: type.format, texts: [value] } : { texts: [] };
  if (type.kind === "list" && type.item.kind === "string" && Array.isArray(value)) {
    return { format: type.item.format, texts: value.filter((member: unknown) => typeof member === "string") };
  }
  return { texts: [] };
}

/** A reference to an `id` that is checked once the whole document is walked. */
interface Reference {
  readonly attribute: string;
  readonly value: string;
  readonly element: ElementVisit;
}

/**
 * Checks the formats of the text attributes of a document, which the reader does not check: identifiers are names
 * (INFO §4.1.1), an `id` is unique in the document and a reference to an `id` names one (the schema's `xs:ID` and
 * `xs:IDREF`).
 */
export class FormatChecks {
  private readonly findings: Findings;
  private readonly ids = new Map<string, ElementVisit>();
  private readonly references: Reference[] = [];

  constructor(findings: Findings) {
    this.findings = findings;
  }

  /** Checks the attributes of one element. */
  visit(visit: ElementVisit): void {
    for (const definition of visit.attributes) {
      const { format, texts } = textsOf(definition, visit.model[definition.property]);
      for (const text of texts) {
        if (format === "identifier") this.identifier(visit, definition, text);
        else if (format === "id") this.id(visit, definition, text);
        else if (format === "idref") this.references.push({ attribute: definition.name, value: text, element: visit });
      }
    }
  }

  /** Resolves the references to an `id`, after every element has been visited. */
  finish(): void {
    for (const { attribute, value, element } of this.references) {
      const target = this.ids.get(value);
      const expected = REFERENCE_TARGETS.get(attribute);
      const source = expected?.source ?? "ASI XSD, xs:IDREF";
      const here = elementPath(element);
      if (target === undefined) {
        const message = `The attribute ${attribute} of the ${element.name} refers to ${JSON.stringify(value)}, which is the id of no element of the document.`;
        this.findings.error("assesskit/validate/unresolved-reference", message, source, here);
      } else if (expected !== undefined && target.name !== expected.target) {
        const message = `The attribute ${attribute} of the ${element.name} refers to ${JSON.stringify(value)}, the id of a ${target.name}, but it must name a ${expected.target}.`;
        this.findings.error("assesskit/validate/unresolved-reference", message, source, here);
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
      this.findings.warning("assesskit/validate/identifier-style", message, "INFO §4.1.1", elementPath(visit));
    }
    if ([...text].length > RECOMMENDED_IDENTIFIER_LENGTH) {
      const message = `The identifier ${JSON.stringify(text)} of the ${visit.name} has more than ${RECOMMENDED_IDENTIFIER_LENGTH} characters, which version 1 of QTI does not take.`;
      this.findings.warning("assesskit/validate/identifier-style", message, "INFO §4.1.1", elementPath(visit));
    }
  }

  private notIdentifier(visit: ElementVisit, definition: AttributeDef, text: string): void {
    const message = `The attribute ${definition.name} of the ${visit.name} is ${JSON.stringify(text)}, which is not an identifier: it must start with a letter or an underscore and contain only letters, digits, underscores, hyphens and periods.`;
    this.findings.error("assesskit/validate/identifier-syntax", message, "INFO §4.1.1", elementPath(visit));
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
    this.findings.error("assesskit/validate/duplicate-id", message, "INFO §5.16", elementPath(visit));
  }
}
