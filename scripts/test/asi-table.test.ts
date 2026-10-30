import { describe, expect, it } from "vitest";
import { buildTable, parseSchema, renderTable } from "../asi-table.ts";

const XS = 'xmlns:xs="http://www.w3.org/2001/XMLSchema"';

/** A schema with the given definitions. */
function schema(definitions: string): string {
  return `<xs:schema ${XS}>${definitions}</xs:schema>`;
}

function table(definitions: string, roots = ["qti-box"]) {
  return buildTable(schema(definitions), roots);
}

const BOX = '<xs:element name="qti-box" type="BoxDType"/>';

describe("parseSchema", () => {
  it("reads the elements with their attributes and leaves out annotations", () => {
    const root = parseSchema(
      schema(
        '<xs:annotation><xs:documentation><xs:element name="no"/></xs:documentation></xs:annotation><xs:element name="a" type="T"><xs:annotation/></xs:element>',
      ),
    );
    expect(root.name).toBe("schema");
    expect(root.children).toHaveLength(1);
    expect(root.children[0]?.attributes.get("name")).toBe("a");
    expect(root.children[0]?.children).toEqual([]);
  });
});

describe("buildTable", () => {
  it("reads attributes with their use, default and type", () => {
    const { types } = table(`${BOX}<xs:complexType name="BoxDType">
      <xs:attribute name="identifier" use="required" type="xs:NCName"/>
      <xs:attribute name="size" type="xs:int" default="3"/>
      <xs:attribute name="open" type="xs:boolean"/>
      <xs:attribute name="mode"><xs:simpleType><xs:restriction base="xs:string"><xs:enumeration value="a"/><xs:enumeration value="b"/></xs:restriction></xs:simpleType></xs:attribute>
      <xs:attribute ref="xml:lang"/>
      <xs:attribute ref="xml:base"/>
    </xs:complexType>`);
    expect(types.get("Box")?.attributes).toEqual([
      { name: "identifier", property: "identifier", use: "required", type: { kind: "string", format: "identifier" } },
      { name: "size", property: "size", use: "optional", default: "3", type: { kind: "integer" } },
      { name: "open", property: "open", use: "optional", type: { kind: "boolean" } },
      { name: "mode", property: "mode", use: "optional", type: { kind: "enum", terms: ["a", "b"] } },
      { name: "xml:lang", property: "language", use: "optional", type: { kind: "string", format: "language" } },
      { name: "xml:base", property: "xmlBase", use: "optional", type: { kind: "string", format: "uri" } },
    ]);
  });

  it("reads lists, references to variables and extensible vocabularies", () => {
    const { types } = table(`${BOX}<xs:complexType name="BoxDType">
      <xs:attribute name="class"><xs:simpleType><xs:list itemType="xs:string"/></xs:simpleType></xs:attribute>
      <xs:attribute name="count"><xs:simpleType><xs:union><xs:simpleType><xs:restriction base="xs:integer"/></xs:simpleType><xs:simpleType><xs:restriction base="xs:NCName"/></xs:simpleType></xs:union></xs:simpleType></xs:attribute>
      <xs:attribute name="level"><xs:simpleType><xs:union memberTypes="xs:double xs:string"/></xs:simpleType></xs:attribute>
      <xs:attribute name="use"><xs:simpleType><xs:union memberTypes="UseExtensionStringDType"><xs:simpleType><xs:restriction base="xs:string"><xs:enumeration value="a"/></xs:restriction></xs:simpleType></xs:union></xs:simpleType></xs:attribute>
    </xs:complexType>
    <xs:simpleType name="UseExtensionStringDType"><xs:restriction base="xs:normalizedString"><xs:pattern value="(ext:)[a-z]+"/></xs:restriction></xs:simpleType>`);
    expect(types.get("Box")?.attributes.map(({ type }) => type)).toEqual([
      { kind: "list", item: { kind: "string" } },
      { kind: "reference", value: "integer" },
      { kind: "reference", value: "double" },
      { kind: "enum", terms: ["a"], extension: true },
    ]);
  });

  it("names a slot after its element, in the plural when it holds a list, and reads its limits", () => {
    const { types, roots } = table(`${BOX}<xs:complexType name="BoxDType"><xs:sequence>
      <xs:element name="qti-part" type="PartDType" minOccurs="0" maxOccurs="unbounded"/>
      <xs:element name="qti-entry" type="PartDType" minOccurs="1" maxOccurs="3"/>
      <xs:element name="qti-lid" type="PartDType" minOccurs="0"/>
    </xs:sequence></xs:complexType><xs:complexType name="PartDType"/>`);
    expect(roots).toEqual(new Map([["qti-box", "Box"]]));
    expect(types.get("Box")?.content).toEqual({
      kind: "slots",
      slots: [
        { property: "parts", accepts: [{ element: "qti-part", type: "Part" }], min: 0, max: "unbounded" },
        { property: "entries", accepts: [{ element: "qti-entry", type: "Part" }], min: 1, max: 3 },
        { property: "lid", accepts: [{ element: "qti-lid", type: "Part" }], min: 0, max: 1 },
      ],
    });
    expect(types.get("Part")).toEqual({ attributes: [], content: { kind: "empty" } });
  });

  it("reads a repeated choice as one slot, with an include", () => {
    const { types } = table(
      `${BOX}<xs:complexType name="BoxDType"><xs:sequence><xs:choice minOccurs="0" maxOccurs="unbounded">
      <xs:element ref="xi:include"/>
      <xs:element name="qti-assessment-item-ref" type="PartDType"/>
      <xs:element name="qti-assessment-section-ref" type="PartDType"/>
    </xs:choice></xs:sequence></xs:complexType><xs:complexType name="PartDType"/>`.replace(
        "qti-assessment-item-ref",
        "qti-set-template-value",
      ),
    );
    expect(types.get("Box")?.content).toMatchObject({
      slots: [{ property: "rules", include: true, min: 0, max: "unbounded" }],
    });
  });

  it("refuses a slot of several elements that nothing names", () => {
    expect(() =>
      table(`${BOX}<xs:complexType name="BoxDType"><xs:choice>
        <xs:element name="qti-a" type="PartDType"/><xs:element name="qti-b" type="PartDType"/>
      </xs:choice></xs:complexType><xs:complexType name="PartDType"/>`),
    ).toThrow("Name the slot Box/qti-a in SLOT_PROPERTIES.");
  });

  it("makes the branches of a choice of sequences exclude each other", () => {
    const { types } = table(`${BOX}<xs:complexType name="BoxDType"><xs:sequence><xs:choice minOccurs="0">
      <xs:element name="qti-one" type="PartDType"/>
      <xs:sequence><xs:element name="qti-two" type="PartDType" minOccurs="0"/><xs:element name="qti-three" type="PartDType" minOccurs="0"/></xs:sequence>
    </xs:choice></xs:sequence></xs:complexType><xs:complexType name="PartDType"/>`);
    expect(types.get("Box")?.content).toMatchObject({
      slots: [
        { property: "one", min: 0, excludes: ["two", "three"] },
        { property: "two", min: 0, excludes: ["one"] },
        { property: "three", min: 0, excludes: ["one"] },
      ],
    });
  });

  it("reads the content of a type that extends another after the content of the other", () => {
    const { types } = table(`${BOX}<xs:complexType name="BoxDType"><xs:complexContent><xs:extension base="BaseDType">
      <xs:sequence><xs:element name="qti-lid" type="PartDType"/></xs:sequence><xs:attribute name="own" type="xs:string"/>
    </xs:extension></xs:complexContent></xs:complexType>
    <xs:complexType name="BaseDType"><xs:sequence><xs:element name="qti-part" type="PartDType"/></xs:sequence><xs:attribute name="base" type="xs:string"/></xs:complexType>
    <xs:complexType name="PartDType"/>`);
    expect(types.get("Box")?.attributes.map(({ name }) => name)).toEqual(["base", "own"]);
    expect(types.get("Box")?.content).toMatchObject({ slots: [{ property: "part" }, { property: "lid" }] });
  });

  it("reads the text of a simple content and of a simple type", () => {
    const { types } =
      table(`${BOX}<xs:complexType name="BoxDType"><xs:sequence><xs:element name="qti-note" type="xs:normalizedString"/><xs:element name="qti-value" type="ValueDType"/></xs:sequence></xs:complexType>
    <xs:complexType name="ValueDType"><xs:simpleContent><xs:extension base="xs:normalizedString"><xs:attribute name="kind-of" type="xs:string"/></xs:extension></xs:simpleContent></xs:complexType>`);
    expect(types.get("NormalizedString")).toEqual({
      attributes: [],
      content: { kind: "text", value: { kind: "string" } },
    });
    expect(types.get("Value")).toMatchObject({ content: { kind: "text", value: { kind: "string" } } });
  });

  it("keeps mixed content and content with HTML as flow, without reading what it contains", () => {
    const { types } =
      table(`${BOX}<xs:element name="p" type="PDType"/><xs:complexType name="BoxDType"><xs:sequence><xs:choice minOccurs="0" maxOccurs="unbounded"><xs:element ref="p"/></xs:choice></xs:sequence><xs:attribute name="id" type="xs:ID"/></xs:complexType>
    <xs:complexType name="PDType" mixed="true"><xs:sequence><xs:element name="qti-never-read" type="NeverDType"/></xs:sequence></xs:complexType>`);
    expect(types.get("Box")).toMatchObject({ content: { kind: "flow" }, attributes: [{ type: { format: "id" } }] });
    expect([...types.keys()]).toEqual(["Box"]);
  });

  it("reads the wildcards of attributes and elements with their processing", () => {
    const { types } =
      table(`${BOX}<xs:complexType name="BoxDType"><xs:sequence><xs:any namespace="##other" processContents="strict" minOccurs="0" maxOccurs="unbounded"/></xs:sequence><xs:attributeGroup ref="lax"/></xs:complexType>
    <xs:attributeGroup name="lax"><xs:anyAttribute namespace="##any" processContents="lax"/></xs:attributeGroup>`);
    expect(types.get("Box")).toMatchObject({
      attributeWildcard: { namespaces: "any" },
      content: { slots: [], wildcard: { namespaces: "other", strict: true } },
    });
  });

  it("refuses a type whose attributes and slots share a property", () => {
    expect(() =>
      table(
        `${BOX}<xs:complexType name="BoxDType"><xs:sequence><xs:element name="qti-part" type="PartDType"/></xs:sequence><xs:attribute name="part" type="xs:string"/></xs:complexType><xs:complexType name="PartDType"/>`,
      ),
    ).toThrow("The type Box has the property part twice.");
    expect(() =>
      table(`${BOX}<xs:complexType name="BoxDType"><xs:attribute name="kind" type="xs:string"/></xs:complexType>`),
    ).toThrow("The type Box has the property kind twice.");
  });

  it("refuses what it does not read instead of leaving it out", () => {
    expect(() =>
      table(`${BOX}<xs:complexType name="BoxDType"><xs:attribute name="x" type="Missing"/></xs:complexType>`),
    ).toThrow("The simple type Missing is not defined.");
    expect(() =>
      table(
        `${BOX}<xs:complexType name="BoxDType"><xs:attribute name="x"><xs:simpleType><xs:union memberTypes="xs:boolean xs:int"/></xs:simpleType></xs:attribute></xs:complexType>`,
      ),
    ).toThrow("A union of boolean, integer is not supported.");
    expect(() => table("", ["qti-box"])).toThrow("The schema declares no element qti-box.");
  });
});

describe("renderTable", () => {
  it("writes the module with its source, the shared lists of elements and the types", () => {
    const built = table(
      `${BOX}<xs:complexType name="BoxDType"><xs:attribute name="size" type="xs:int"/></xs:complexType>`,
    );
    const source = renderTable(built, { url: "https://example.com/a.xsd", sha256: "ab" });
    expect(source).toContain("// Generated by scripts/asi-table.ts; do not edit.");
    expect(source).toContain("// Source: https://example.com/a.xsd (SHA-256 ab).");
    expect(source).toContain('"Box"');
    expect(source).toContain("export const ELEMENT_TYPES");
    expect(source).toContain('export const DOCUMENT_ELEMENTS = {"qti-box":"Box"} as const;');
  });

  it("writes a list of elements that several slots share once, under the name of its kind", () => {
    const built = table(`${BOX}<xs:complexType name="BoxDType"><xs:sequence>
      <xs:choice maxOccurs="unbounded"><xs:element name="qti-and" type="OtherDType"/><xs:element name="qti-sum" type="OtherDType"/></xs:choice>
      <xs:element name="qti-other" type="OtherDType"/>
    </xs:sequence></xs:complexType><xs:complexType name="OtherDType"><xs:sequence>
      <xs:choice maxOccurs="unbounded"><xs:element name="qti-and" type="OtherDType"/><xs:element name="qti-sum" type="OtherDType"/></xs:choice>
    </xs:sequence></xs:complexType>`);
    const source = renderTable(built, { url: "u", sha256: "h" });
    expect(source.match(/export const EXPRESSION = /g)).toHaveLength(1);
    expect(source.match(/"accepts":EXPRESSION/g)).toHaveLength(2);
  });
});
