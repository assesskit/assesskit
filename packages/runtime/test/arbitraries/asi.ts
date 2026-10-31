import fc from "fast-check";
import type { AsiDocument } from "../../src/asi/index.js";
import type { AttributeType, SlotDef } from "../../src/asi/table.js";
import { foreignName, kindOf, type SlotInfo, type TypeInfo, typeNamed } from "../../src/asi/type-index.js";
import { isRecord } from "../../src/checks.js";
import {
  XINCLUDE_NAMESPACE,
  XML_NAMESPACE,
  type XmlAttribute,
  type XmlElement,
  type XmlNode,
} from "../../src/xml/index.js";

/** A model as the arbitraries build it: the properties that the element table gives a type. */
export type GeneratedModel = Record<string, unknown>;

const MATHML = "http://www.w3.org/1998/Math/MathML";
const SSML = "http://www.w3.org/2001/10/synthesis";
const EXTENSION_NAMESPACE = "urn:example:extension";
/** The fewest elements a place accepts for the arbitraries to generate more members of it than of the others. */
const FLOW_SPREAD_MINIMUM = 20;
/** How deep expressions and sections nest in a generated document. */
const DEFAULT_DEPTH = 4;

const identifier = fc.stringMatching(/^[A-Za-z_][A-Za-z0-9_-]{0,7}$/);
/** An identifier that no other generated identifier equals in practice, for the attributes of type `xs:ID`. */
const uniqueIdentifier = fc.stringMatching(/^id[a-z0-9]{10}$/);
const token = fc.stringMatching(/^[a-z][a-z0-9-]{0,5}$/);
/** Text with the characters that attribute values and text nodes escape, and some that need more than one byte. */
const text = fc.string({ unit: fc.constantFrom(..."abcXYZ 019<>&\"'-_.,:;é日😀"), maxLength: 12 });
const nonEmptyText = text.filter((value) => value !== "");

/** The words of `xs:double` that read as numbers, which no variable can be named. */
const NUMERIC_WORDS = new Set(["INF", "NaN"]);
const variable = identifier.filter((name) => !NUMERIC_WORDS.has(name));

const FORMATS: Readonly<Record<string, fc.Arbitrary<string>>> = {
  identifier,
  id: uniqueIdentifier,
  idref: identifier,
  "mime-type": fc.constantFrom("image/png", "text/css", "audio/mpeg"),
  coords: fc.constantFrom("10,20,5", "1,2,30,40", "0,0,10,0,5,5"),
  length: fc.nat({ max: 500 }).map(String),
  decimal: fc.integer({ min: -1000, max: 1000 }).map(String),
  uri: fc.constantFrom("a.png", "images/b.jpg", "https://example.com/c"),
  language: fc.constantFrom("en", "id", "fr-CA"),
};

/** Returns an arbitrary of the values of an attribute type; a list item is a token without white space. */
function valueArbitrary(type: AttributeType, inList = false): fc.Arbitrary<unknown> {
  switch (type.kind) {
    case "string":
      return (type.format === undefined ? undefined : FORMATS[type.format]) ?? (inList ? token : text);
    case "boolean":
      return fc.boolean();
    case "integer":
      return fc.integer({ min: type.minimum ?? -1000, max: 1000 });
    case "double":
      return fc.double({ min: type.minimum ?? -1e6, max: 1e6, noNaN: true });
    case "enum": {
      const terms = type.terms.filter((term) => !(inList && term.includes(" ")));
      return fc.oneof(
        fc.constantFrom(...terms),
        ...(type.extension === true ? [fc.stringMatching(/^[a-zA-Z0-9_-]{1,6}$/).map((name) => `ext:${name}`)] : []),
      );
    }
    case "list":
      return fc.array(valueArbitrary(type.item, true), { maxLength: 3 });
    case "reference":
      return fc.oneof(
        variable,
        type.value === "integer"
          ? fc.integer({ min: -1000, max: 1000 })
          : fc.double({ min: type.minimum ?? -1e6, max: 1e6, noNaN: true }),
      );
  }
}

function element(
  namespace: string,
  name: string,
  prefix: string | undefined,
  children: readonly XmlNode[],
  attributes: readonly XmlAttribute[] = [],
): XmlElement {
  return { kind: "element", namespace, name, ...(prefix === undefined ? {} : { prefix }), attributes, children };
}

const attributeOf = (name: string, value: string): XmlAttribute => ({ namespace: "", name, value });

/** Valid samples of the MathML and SSML elements that flow content takes, by {@link foreignName}. */
const EMBEDDED: ReadonlyMap<string, XmlElement> = new Map(
  [
    element(MATHML, "math", "m", [element(MATHML, "mi", "m", [{ kind: "text", value: "x" }])]),
    ...["audio", "break", "emphasis", "mark", "p", "prosody", "s", "voice"].map((name) =>
      element(SSML, name, "ssml", [], name === "mark" ? [attributeOf("name", "m")] : []),
    ),
    element(SSML, "phoneme", "ssml", [], [attributeOf("ph", "x")]),
    element(SSML, "say-as", "ssml", [], [attributeOf("interpret-as", "cardinal")]),
    element(SSML, "sub", "ssml", [], [attributeOf("alias", "a")]),
    element(
      SSML,
      "speak",
      "ssml",
      [],
      [attributeOf("version", "1.1"), { namespace: XML_NAMESPACE, prefix: "xml", name: "lang", value: "en" }],
    ),
  ].map((sample) => [foreignName(sample.namespace, sample.name), sample]),
);

const foreignElement = nonEmptyText.map((value) =>
  element(EXTENSION_NAMESPACE, "extension", "x", [{ kind: "text", value }]),
);
const includeElement: fc.Arbitrary<XmlElement> = fc.constant({
  ...element(XINCLUDE_NAMESPACE, "include", "xi", []),
  attributes: [{ namespace: "", name: "href", value: "fragment.xml" }],
});
const extensionAttribute = (namespaces: "any" | "other") =>
  fc
    .tuple(token, text)
    .map(([name, value]) =>
      namespaces === "any" && name.length % 2 === 0
        ? { namespace: "", name: `data-${name}`, value }
        : { namespace: EXTENSION_NAMESPACE, prefix: "x", name, value },
    );

/** Whether an attribute refers to the `id` of an element, which a generated document cannot know. */
function refersToIdentifier(type: AttributeType): boolean {
  return type.kind === "list" ? refersToIdentifier(type.item) : type.kind === "string" && type.format === "idref";
}

/** Whether a type can be built without any required child, which ends a recursion. */
function isTerminal(info: TypeInfo): boolean {
  return info.slots.every((slot) => slot.def.min === 0);
}

/** Builds the arbitraries of the types of the element table, once for each type and depth. */
class Builder {
  private readonly cache = new Map<string, fc.Arbitrary<GeneratedModel>>();

  model(type: string, elementName: string, depth: number): fc.Arbitrary<GeneratedModel> {
    const key = `${type}/${elementName}/${depth}`;
    let arbitrary = this.cache.get(key);
    if (arbitrary === undefined) {
      arbitrary = this.build(typeNamed(type), elementName, depth);
      this.cache.set(key, arbitrary);
    }
    return arbitrary;
  }

  private member(slot: SlotInfo, depth: number): fc.Arbitrary<unknown> {
    const accepts = [...slot.byElement.values()];
    const terminal = accepts.filter((accept) => isTerminal(typeNamed(accept.type)));
    const pool = depth > 0 || terminal.length === 0 ? accepts : terminal;
    const members = pool.map((accept) => this.model(accept.type, accept.element, Math.max(depth - 1, 0)));
    const embedded = [...slot.foreign].flatMap((name) => EMBEDDED.get(name) ?? []).map((sample) => fc.constant(sample));
    return fc.oneof(...members, ...embedded, ...(slot.def.include === true ? [includeElement] : []));
  }

  /**
   * Adds runs of text between the elements of a slot that takes text, but never two runs in a row. The elements are in the
   * order the slot lists them: the schema orders the elements of some mixed content, such as the sources before the tracks
   * of a video, and the slot only keeps them in one array.
   */
  private withText(slot: SlotInfo, members: fc.Arbitrary<unknown[]>): fc.Arbitrary<unknown[]> {
    const order = [...slot.byKind.keys()];
    const rank = (member: unknown) => (isRecord(member) ? order.indexOf(String(member.kind)) : -1);
    return members.chain((unsorted) => {
      const elements = unsorted.toSorted((a, b) => rank(a) - rank(b));
      return fc
        .array(fc.option(nonEmptyText, { nil: undefined }), {
          minLength: elements.length + 1,
          maxLength: elements.length + 1,
        })
        .map((runs) =>
          runs.flatMap((run, index) => [
            ...(run === undefined ? [] : [{ kind: "text", value: run }]),
            ...(index < elements.length ? [elements[index]] : []),
          ]),
        );
    });
  }

  private slot(slot: SlotInfo, depth: number): fc.Arbitrary<unknown> {
    const { min, max } = slot.def;
    if (max === 1) return this.member(slot, depth);
    // At depth 0 a list that may be empty is empty, which ends the recursion of sections and rules.
    // Flow content has dozens of elements to choose from, so it gets more members for each to turn up.
    const spread = slot.def.property === "children" && slot.def.accepts.length > FLOW_SPREAD_MINIMUM ? 5 : 2;
    const limit = max === "unbounded" ? min + spread : Math.min(max, min + spread);
    const members =
      depth <= 0 && min === 0
        ? fc.constant<unknown[]>([])
        : fc.array(this.member(slot, depth), { minLength: min, maxLength: depth > 0 ? limit : min });
    return slot.def.text === true ? this.withText(slot, members) : members;
  }

  private build(info: TypeInfo, elementName: string, depth: number): fc.Arbitrary<GeneratedModel> {
    const entries: Record<string, fc.Arbitrary<unknown>> = { kind: fc.constant(kindOf(elementName)) };
    const required = ["kind"];
    for (const definition of info.attributeList) {
      if (refersToIdentifier(definition.type) && definition.use === "optional") continue;
      entries[definition.property] = valueArbitrary(definition.type);
      if (definition.use === "required") required.push(definition.property);
    }
    const attributeWildcard = info.def.attributeWildcard;
    if (attributeWildcard !== undefined) {
      const extensions =
        attributeWildcard.strict === true
          ? fc.constant([])
          : fc.uniqueArray(extensionAttribute(attributeWildcard.namespaces), {
              maxLength: 2,
              selector: ({ namespace, name }) => `${namespace} ${name}`,
            });
      entries.extensions = extensions;
      required.push("extensions");
    }
    const { content } = info.def;
    if (content.kind === "text") {
      entries.value = valueArbitrary(content.value);
      required.push("value");
    } else if (content.kind === "slots") {
      this.addSlots(info, entries, required, depth);
      if (content.wildcard !== undefined) {
        entries.extensionElements =
          content.wildcard.strict === true ? fc.constant([]) : fc.array(foreignElement, { maxLength: 2 });
        required.push("extensionElements");
      }
    }
    return fc.record(entries, { requiredKeys: required }).filter((model) => !clashes(info, model));
  }

  private addSlots(
    info: TypeInfo,
    entries: Record<string, fc.Arbitrary<unknown>>,
    required: string[],
    depth: number,
  ): void {
    for (const slot of info.slots) {
      const { property, min, max } = slot.def;
      if (max === 1 && min === 0 && depth <= 0) continue;
      entries[property] = this.slot(slot, depth);
      if (min >= 1 || max !== 1) required.push(property);
    }
  }
}

function present(model: GeneratedModel, slot: SlotDef): boolean {
  const value = model[slot.property];
  return Array.isArray(value) ? value.length > 0 : value !== undefined;
}

/** Returns whether a model uses two slots that exclude each other. */
function clashes(info: TypeInfo, model: GeneratedModel): boolean {
  return info.slots.some(
    (slot) =>
      present(model, slot.def) &&
      (slot.def.excludes ?? []).some((other) =>
        info.slots.some((candidate) => candidate.def.property === other && present(model, candidate.def)),
      ),
  );
}

const BUILDER = new Builder();

/**
 * Returns an arbitrary of the models of an element that is valid against the schema: identifiers of attributes of type
 * `xs:ID` are unique in practice, no attribute refers to an identifier, lists have the minimum their slot requires, and
 * recursion ends at `depth`.
 *
 * @param type - The type of the element table.
 * @param elementName - The element, such as `qti-and`.
 */
export function modelArbitrary(type: string, elementName: string, depth = DEFAULT_DEPTH): fc.Arbitrary<GeneratedModel> {
  return BUILDER.model(type, elementName, depth);
}

/** The documents of each kind, with the type and element of their root. */
const ROOTS = [
  ["item", "AssessmentItem", "qti-assessment-item", "item"],
  ["stimulus", "AssessmentStimulus", "qti-assessment-stimulus", "stimulus"],
  ["test", "AssessmentTest", "qti-assessment-test", "test"],
  ["section", "AssessmentSection", "qti-assessment-section", "section"],
  ["outcome-declaration", "OutcomeDeclaration", "qti-outcome-declaration", "declaration"],
  ["response-processing", "ResponseProcessing", "qti-response-processing", "processing"],
  ["outcome-processing", "OutcomeProcessing", "qti-outcome-processing", "processing"],
] as const;

/** The kinds of document and an arbitrary of the documents of each kind. */
export const DOCUMENT_ARBITRARIES: ReadonlyMap<AsiDocument["kind"], fc.Arbitrary<AsiDocument>> = new Map(
  ROOTS.map(([kind, type, elementName, property]) => [
    kind,
    modelArbitrary(type, elementName).map((model): AsiDocument => ({ kind, [property]: model }) as AsiDocument),
  ]),
);
