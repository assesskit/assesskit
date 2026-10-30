// cspell:ignore interation
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireSchemas } from "../../../scripts/schemas.js";
import { DOCUMENT_ELEMENTS, ELEMENT_TYPES } from "../src/asi/element-table.js";
import type { TypeDef } from "../src/asi/table.js";
import type { ElementVisit, Issue } from "../src/index.js";
import { loadSchemaSet, type SchemaSet, validateXmlFiles } from "../src/node/index.js";
import { BindRuleSets } from "../src/validate/bind-rule-sets.js";
import { Findings } from "../src/validate/findings.js";
import { inventoryElements } from "./asi-elements.js";
import { ATTRIBUTE_RULES, itemXml, MATCH_LIMITS, NESTING_ROWS } from "./validate-fixtures.js";

const root = resolve(import.meta.dirname, "../../..");
const directory = requireSchemas(root);
const SCHEMA = readFileSync(join(directory, "imsqti_asiv3p0p1_v1p0.xsd"), "utf8");

let schemas: SchemaSet;

beforeAll(async () => {
  schemas = await loadSchemaSet(directory);
});

afterAll(() => schemas.close());

/** The Schematron patterns of the schema by identifier, with their text. */
function patterns(): Map<string, string> {
  return new Map(
    [...SCHEMA.matchAll(/<sch:pattern[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/sch:pattern>/g)].map(
      ([, id = "", body = ""]) => [id, body],
    ),
  );
}

/** The element names that the rules of a pattern are about: `//qti:qti-text-entry-interaction` gives `qti-text-entry-interaction`. */
function contextsOf(body: string): string[] {
  return [...body.matchAll(/<sch:rule[^>]*context="\/\/qti:([^"[\s/]+)/g)].map(([, name = ""]) => name);
}

/** An element of an interaction's name as the messages of BIND write it: `TextEntryInteraction` gives `qti-text-entry-interaction`. */
function interactionElement(name: string): string {
  const stem = name.replace(/Interaction$/, "");
  return `qti-${stem.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase()}-interaction`;
}

const visitOf = (name: string, parent?: ElementVisit): ElementVisit => ({
  name,
  model: { kind: name.replace(/^qti-/, "") },
  attributes: [],
  attributeWildcard: undefined,
  foreign: [],
  parent,
});

function ruleSetsOn(visit: ElementVisit): Issue[] {
  const findings = new Findings();
  new BindRuleSets(findings, undefined).visit(visit);
  return findings.issues;
}

describe("the Schematron rules of the ASI schema", () => {
  it("[V1][V2][V52] are 53 patterns: the three of the constrained extension, the one of the figure and the 49 explicit rule sets", () => {
    const ids = [...patterns().keys()];
    expect(ids).toHaveLength(53);
    expect(ids.filter((id) => id.startsWith("RULE_SET_"))).toHaveLength(49);
    expect(ids.filter((id) => id.endsWith("_DATAEXTENSIONRULES"))).toHaveLength(3);
  });

  it("[V3][V4][V5][V6][V44][V45][V49][V50][V51] are the explicit rule sets that the validator reports under their identifiers", () => {
    const nesting = inventoryElements(5, 44, "V");
    const reported = new Set([
      ...NESTING_ROWS.map(([row]) => nesting[Number(row.slice(1)) - 5] ?? ""),
      ...ATTRIBUTE_RULES.map(({ code }) => code),
      ...MATCH_LIMITS.map(([, code]) => code),
      "RULE_SET_ARIA_ROLES_1",
      "RULE_SET_GENERAL_1",
      "RULE_SET_INTERACTION_20B",
      "RULE_SET_RUBRICBLOCK",
      "RULE_SET_SPECIFIC_CLASS_OUTCOMEDEC",
      "RULE_SET_SPECIFIC_CLASS_RESPONSEDEC",
    ]);
    const stated = [...patterns().keys()].filter((id) => id.startsWith("RULE_SET_"));
    expect([...reported].sort()).toEqual(stated.sort());
  });

  it("[V5][V7][V9][V11][V13][V15][V17][V19][V21][V23][V25][V27][V29][V31][V33][V35][V37][V39][V41][V43] each interaction a nesting rule set says it must not contain, it reports", () => {
    let pairs = 0;
    for (const [id, body] of patterns()) {
      if (!/^RULE_SET_INTERACTION_\d\dA$/.test(id)) continue;
      for (const rule of body.matchAll(/<sch:rule[^>]*context="\/\/qti:([^"]+)">([\s\S]*?)<\/sch:rule>/g)) {
        const [, , content = ""] = rule;
        for (const message of content.matchAll(/An? (\w+Interaction) MUST NOT contain an? (\w+Interaction)/g)) {
          const [, outer = "", inner = ""] = message;
          const container = interactionElement(outer);
          const nested = interactionElement(inner);
          // The schema misspells some of the names, which no rule can follow.
          if (!NESTING_ROWS.some(([, name]) => name === nested) || !NESTING_ROWS.some(([, name]) => name === container))
            continue;
          const issues = ruleSetsOn(visitOf(nested, visitOf(container)));
          expect(
            issues.map(({ code }) => code),
            `${container} contains ${nested}`,
          ).toEqual([id]);
          pairs++;
        }
      }
    }
    expect(pairs).toBeGreaterThan(400);
  });

  it("[V52] constrain the extension attributes of the elements that allow any, and of the custom interaction", () => {
    const contexts = new Set(
      [...patterns()]
        .filter(([id]) => id.endsWith("_DATAEXTENSIONRULES"))
        .flatMap(([, body]) =>
          contextsOf(body).map((name) => name.replace(/^qti-custom-interation$/, "qti-custom-interaction")),
        ),
    );
    const types: Readonly<Record<string, TypeDef>> = ELEMENT_TYPES;
    const byElement = new Map<string, Set<string>>(
      Object.entries(DOCUMENT_ELEMENTS).map(([element, type]) => [element, new Set([type])]),
    );
    for (const definition of Object.values(types)) {
      if (definition.content.kind !== "slots") continue;
      for (const slot of definition.content.slots) {
        for (const { element, type } of slot.accepts)
          byElement.set(element, (byElement.get(element) ?? new Set()).add(type));
      }
    }
    const constrained = new Set(
      [...byElement]
        .filter(([, names]) => [...names].some((name) => types[name]?.attributeWildcard?.namespaces === "any"))
        .map(([element]) => element),
    );
    constrained.add("qti-custom-interaction");
    expect([...constrained].sort()).toEqual([...contexts].sort());
  });
});

describe("the fixtures of the rule sets", () => {
  it("[V6][V8][V45] are valid against the schema, which does not state the rules that they break", async () => {
    const fixtures = [
      ...ATTRIBUTE_RULES.map(({ broken: [declarations, body], code }) => ({
        path: `${code}.xml`,
        content: itemXml({ declarations, body }),
      })),
      ...MATCH_LIMITS.map(([, code, , build]) => {
        const [declarations, body] = build('match-max="1" match-min="2"');
        return { path: `${code}.xml`, content: itemXml({ declarations, body }) };
      }),
    ];
    const issues = await validateXmlFiles(schemas, fixtures);
    expect(issues).toEqual([]);
  });
});
