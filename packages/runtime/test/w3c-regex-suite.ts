// cspell:ignore apos xlink
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** What the suite expects of a document. */
type Validity = "valid" | "invalid";

/** One instance document of a test: the values of its attributes and simple elements, and whether the suite accepts it. */
interface InstanceCase {
  readonly name: string;
  readonly values: readonly string[];
  readonly valid: boolean;
}

/** One test group: a schema with patterns, whether its patterns are valid, and the instances checked against it. */
export interface RegexCase {
  readonly name: string;
  /** The pattern facets of each restriction of the schema: a value must match one of each group. */
  readonly patternGroups: readonly (readonly string[])[];
  /** Whether the schema, and so every pattern, is valid. */
  readonly schemaValid: boolean;
  readonly instances: readonly InstanceCase[];
}

/**
 * The XML Schema version whose expectations apply: INFO §2.11.3.40 cites XML Schema Part 2 of 2001, which is version 1.0.
 * Tests whose result depends on the Unicode version follow Unicode 6.0.0, the newest the suite lists.
 */
const XSD_VERSION = "1.0";
const UNICODE_VERSION = "Unicode_6.0.0";

const ENTITIES: ReadonlyMap<string, string> = new Map([
  ["lt", "<"],
  ["gt", ">"],
  ["amp", "&"],
  ["quot", '"'],
  ["apos", "'"],
]);

/** Replaces the predefined entities and character references of an XML text. */
function decodeReferences(text: string): string {
  return text.replace(/&(#x[0-9A-Fa-f]+|#[0-9]+|[a-z]+);/g, (whole, reference: string) => {
    if (reference.startsWith("#x")) return String.fromCodePoint(Number.parseInt(reference.slice(2), 16));
    if (reference.startsWith("#")) return String.fromCodePoint(Number.parseInt(reference.slice(1), 10));
    return ENTITIES.get(reference) ?? whole;
  });
}

/** Normalizes line ends as an XML parser does. */
const normalizeLineEnds = (text: string): string => text.replace(/\r\n?/g, "\n");

/** The attribute value normalization of a CDATA attribute: each literal whitespace character becomes a space. */
const normalizeAttribute = (raw: string): string => decodeReferences(normalizeLineEnds(raw).replace(/[\t\n]/g, " "));

interface Element {
  readonly attributes: readonly [string, string][];
  readonly text: string[];
  children: number;
}

const TOKEN =
  /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
const ATTRIBUTE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Returns the elements of a document with their attributes and text, in document order. */
function readElements(xml: string): Element[] {
  const elements: Element[] = [];
  const stack: Element[] = [];
  for (const match of xml.matchAll(TOKEN)) {
    const [, cdata, closing, name, attributes, selfClosing, text] = match;
    if (cdata !== undefined) stack.at(-1)?.text.push(cdata);
    else if (text !== undefined) stack.at(-1)?.text.push(decodeReferences(normalizeLineEnds(text)));
    else if (name !== undefined && closing === "/") stack.pop();
    else if (name !== undefined) {
      const parent = stack.at(-1);
      if (parent) parent.children++;
      const element: Element = {
        attributes: [...(attributes ?? "").matchAll(ATTRIBUTE)].map((attribute): [string, string] => [
          attribute[1] ?? "",
          normalizeAttribute(attribute[2] ?? attribute[3] ?? ""),
        ]),
        text: [],
        children: 0,
      };
      elements.push(element);
      if (selfClosing !== "/") stack.push(element);
    }
  }
  return elements;
}

/** The values that a schema's patterns constrain: attributes except namespace declarations and `xsi:`, and simple elements. */
function instanceValues(xml: string): string[] {
  return readElements(xml).flatMap((element) => {
    const attributes = element.attributes.filter(
      ([name]) => !(name === "xmlns" || name.startsWith("xmlns:") || name.startsWith("xsi:")),
    );
    if (attributes.length > 0) return attributes.map(([, value]) => value);
    return element.children === 0 ? [element.text.join("")] : [];
  });
}

/** Reads the restrictions of a schema: their bases and pattern facets, and the names of its simple types. */
function readSchema(xsd: string): { bases: string[]; names: string[]; patternGroups: string[][] } {
  const text = xsd.replace(/<!--[\s\S]*?-->/g, "");
  const restrictions = [
    ...text.matchAll(
      /<(?:\w+:)?restriction\s+base\s*=\s*["']([^"']+)["'][^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?restriction>)/g,
    ),
  ];
  return {
    bases: restrictions.map((match) => (match[1] ?? "").replace(/^\w+:/, "")),
    names: [...text.matchAll(/<(?:\w+:)?simpleType\s+name\s*=\s*["']([^"']+)["']/g)].map((match) => match[1] ?? ""),
    patternGroups: restrictions
      .map((match) =>
        [...(match[2] ?? "").matchAll(/<(?:\w+:)?pattern\s+value\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((pattern) =>
          decodeReferences(normalizeAttribute(pattern[1] ?? pattern[2] ?? "")),
        ),
      )
      .filter((group) => group.length > 0),
  };
}

/** Picks the expected validity that applies: the one for XSD 1.0, else for Unicode 6.0.0, else the unversioned one. */
function expectedValidity(tags: string): Validity | undefined {
  const expected = [...tags.matchAll(/<expected\s+([^>]*?)\/>/g)].map((match) => {
    const attributes = new Map(
      [...(match[1] ?? "").matchAll(/([\w:]+)\s*=\s*"([^"]*)"/g)].map((a): [string, string] => [
        a[1] ?? "",
        a[2] ?? "",
      ]),
    );
    return { validity: attributes.get("validity"), version: attributes.get("version") };
  });
  const found = [XSD_VERSION, UNICODE_VERSION, undefined]
    .map((version) => expected.find((candidate) => candidate.version === version))
    .find((candidate) => candidate !== undefined);
  return found?.validity === "valid" || found?.validity === "invalid" ? found.validity : undefined;
}

/** Returns whether an instance test applies to XML Schema 1.0 and the Unicode versions. */
const appliesToVersion = (version: string | undefined): boolean =>
  version === undefined || version === XSD_VERSION || version.startsWith("Unicode_");

/**
 * Reads the regular expression tests of the W3C XML Schema test suite that apply a pattern to a string: `msMeta/Regex_w3c.xml`
 * and the schemas and instances of `msData/regex/` that it names. Tests that W3C marks as queried, and those of other
 * base types than string, are left out.
 *
 * @param directory - The `xsdtests` directory of the corpus.
 */
export function loadRegexSuite(directory: string): RegexCase[] {
  const meta = readFileSync(join(directory, "msMeta/Regex_w3c.xml"), "utf8");
  const cases: RegexCase[] = [];
  for (const group of meta.matchAll(/<testGroup name="([^"]+)">([\s\S]*?)<\/testGroup>/g)) {
    const [, name = "", body = ""] = group;
    const schemaTest = /<schemaTest[^>]*>([\s\S]*?)<\/schemaTest>/.exec(body)?.[1] ?? "";
    const schemaFile = /<schemaDocument xlink:href="\.\.\/([^"]+)"/.exec(schemaTest)?.[1];
    const schemaValid = expectedValidity(schemaTest);
    if (schemaFile === undefined || schemaValid === undefined || /status="queried"/.test(schemaTest)) continue;
    const schema = readSchema(readFileSync(join(directory, "msData", schemaFile.replace(/^msData\//, "")), "utf8"));
    const isStringBased =
      schema.patternGroups.length > 0 && schema.bases.every((base) => base === "string" || schema.names.includes(base));
    if (!isStringBased) continue;
    const instances: InstanceCase[] = [];
    for (const instanceTest of body.matchAll(/<instanceTest\s+name="([^"]+)"([^>]*)>([\s\S]*?)<\/instanceTest>/g)) {
      const [, instanceName = "", attributes = "", content = ""] = instanceTest;
      const version = /version="([^"]+)"/.exec(attributes)?.[1];
      const file = /<instanceDocument xlink:href="\.\.\/([^"]+)"/.exec(content)?.[1];
      const validity = expectedValidity(content);
      if (
        file === undefined ||
        validity === undefined ||
        !appliesToVersion(version) ||
        /status="queried"/.test(content)
      )
        continue;
      const values = instanceValues(readFileSync(join(directory, "msData", file.replace(/^msData\//, "")), "utf8"));
      instances.push({ name: instanceName, values, valid: validity === "valid" });
    }
    cases.push({ name, patternGroups: schema.patternGroups, schemaValid: schemaValid === "valid", instances });
  }
  return cases;
}
