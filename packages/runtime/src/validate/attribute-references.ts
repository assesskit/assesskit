import type { AttributeDef, AttributeType, ElementVisit } from "../asi/index.js";
import type { Findings } from "./findings.js";
import { elementPath, isWithin } from "./model-access.js";
import type { StaticType } from "./static-type.js";

/** The base types a reference to a number may name, by the type of the attribute. */
const REFERABLE_BASE_TYPES = { integer: ["integer"], double: ["float", "integer"] } as const;

/** The type of an attribute that holds numbers or the identifiers of variables, alone or in a list. */
type ReferenceType = Extract<AttributeType, { kind: "reference" }>;

function referenceTypeOf(type: AttributeType): ReferenceType | undefined {
  if (type.kind === "reference") return type;
  return type.kind === "list" && type.item.kind === "reference" ? type.item : undefined;
}

/** An attribute of a type that holds a number or the identifier of a variable, alone or in a list. */
interface ReferenceAttribute {
  readonly definition: AttributeDef;
  readonly type: ReferenceType;
}

/** The attributes of each list of a type that may name a variable, made once for the list, which the type keeps. */
const REFERENCES = new WeakMap<readonly AttributeDef[], readonly ReferenceAttribute[]>();

/** Returns the attributes of a list that may name a variable, in the order of the list. */
function referencesOf(attributes: readonly AttributeDef[]): readonly ReferenceAttribute[] {
  const known = REFERENCES.get(attributes);
  if (known !== undefined) return known;
  const found = attributes.flatMap((definition): ReferenceAttribute[] => {
    const type = referenceTypeOf(definition.type);
    return type === undefined ? [] : [{ definition, type }];
  });
  REFERENCES.set(attributes, found);
  return found;
}

/** Finds the variable an attribute names: `identifier` is the text of the attribute, `templateProcessing` where it is. */
export type ReferenceLookup = (identifier: string, templateProcessing: boolean) => StaticType | undefined;

/**
 * Checks the attributes that hold either a number or the identifier of a variable that holds it, such as the `figures` of
 * `qti-round-to`, the `tolerance` of `qti-equal` and the `base` of a printed variable: the variable
 * must be a template or outcome variable in reach, single, of a base type that fits the attribute, so that the reference
 * resolves when the attribute is read.
 */
export class AttributeReferences {
  private readonly findings: Findings;
  private readonly lookup: ReferenceLookup;
  private readonly owner: string;

  /**
   * @param findings - Where the issues go.
   * @param lookup - Finds the variable an attribute names.
   * @param owner - What declares the variables, `item` or `test`, for messages.
   */
  constructor(findings: Findings, lookup: ReferenceLookup, owner: "item" | "test") {
    this.findings = findings;
    this.lookup = lookup;
    this.owner = owner;
  }

  /**
   * Checks the references of one element.
   *
   * @param visit - The element that the walk of the document reached.
   */
  visit(visit: ElementVisit): void {
    const references = referencesOf(visit.attributes);
    if (references.length === 0) return;
    const templateProcessing = isWithin(visit, "qti-template-processing");
    for (const { definition, type } of references) {
      for (const identifier of this.identifiersOf(visit.model[definition.property])) {
        const found = this.lookup(identifier, templateProcessing);
        const here = elementPath(visit);
        if (found === undefined) {
          const message = `The attribute ${definition.name} of the ${visit.name} names ${JSON.stringify(identifier)}, which is no template or outcome variable of the ${this.owner} in reach.`;
          this.findings.error("assesskit/validate/undeclared-variable", message, here);
          continue;
        }
        const accepted: readonly string[] = REFERABLE_BASE_TYPES[type.value];
        if (found.cardinality !== "single" || (found.baseType !== undefined && !accepted.includes(found.baseType))) {
          const message = `The attribute ${definition.name} of the ${visit.name} names ${JSON.stringify(identifier)}, which must be a single ${accepted.join(" or ")} variable.`;
          this.findings.error("assesskit/validate/reference-type", message, here);
        }
      }
    }
  }

  /** Returns the identifiers an attribute value names: the value, or the items of a list, when they are not numbers. */
  private identifiersOf(value: unknown): readonly string[] {
    if (typeof value === "string") return [value];
    if (!Array.isArray(value)) return [];
    return value.filter((member: unknown): member is string => typeof member === "string");
  }
}
