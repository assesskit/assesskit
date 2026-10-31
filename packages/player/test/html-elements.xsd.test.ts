import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseXml, type XmlElement } from "@assesskit/runtime/xml";
import { describe, expect, it } from "vitest";
import { requireSchemas } from "../../../scripts/schemas.js";
import { HTML_ELEMENT_NAMES } from "../src/player/content/internal.js";

/** The names of the elements that a schema declares, anywhere in it. */
function declaredElements(schema: XmlElement): string[] {
  const names: string[] = [];
  const visit = (node: XmlElement): void => {
    const name = node.attributes.find((attribute) => attribute.namespace === "" && attribute.name === "name");
    if (node.name === "element" && name !== undefined) names.push(name.value);
    for (const child of node.children) if (child.kind === "element") visit(child);
  };
  visit(schema);
  return names;
}

describe("html-elements", () => {
  it("names every HTML element that the ASI schema declares, and no other: the elements without the prefix qti-", () => {
    const schema = parseXml(
      readFileSync(join(requireSchemas(resolve(import.meta.dirname, "../../..")), "imsqti_asiv3p0p1_v1p0.xsd"), "utf8"),
    );
    const declared = new Set(declaredElements(schema).filter((name) => !name.startsWith("qti-")));
    expect([...HTML_ELEMENT_NAMES].sort()).toEqual([...declared].sort());
  });
});
