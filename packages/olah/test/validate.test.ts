import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  ASI_NAMESPACE,
  type AsiDocument,
  type AssessmentItem,
  type AssessmentResult,
  type AssessmentSection,
  type AssessmentTest,
  BASE_TYPES,
  type BaseType,
  createItemVariables,
  createRandom,
  DataError,
  type ElementVisit,
  type Expression,
  evaluate,
  type Issue,
  type Manifest,
  OPERATOR_SIGNATURES,
  openPackage,
  type PersonalNeedsProfile,
  ProcessingError,
  parseXml,
  type QtiPackage,
  type ResolvedItem,
  type Resolvers,
  readAsi,
  readPnp,
  resolveReference,
  validateAsi,
  validatePackage,
  validatePnp,
  validatePnpNamespace,
  validateResults,
  validateTest,
  writeManifest,
} from "../src/index.js";
import { type BindContext, BindRuleSets } from "../src/validate/bind-rule-sets.js";
import { DocumentChecks } from "../src/validate/document-checks.js";
import { Findings } from "../src/validate/findings.js";
import { readError } from "../src/xml/index.js";
import { inventoryElements } from "./asi-elements.js";
import { FUZZ } from "./fuzz.js";
import {
  ATTRIBUTE_RULES,
  base,
  check,
  choice,
  codesOf,
  GAP_TEXT,
  ITEM_ATTRIBUTES,
  type ItemParts,
  interaction,
  itemOf,
  itemXml,
  json,
  MATCH_LIMITS,
  MEDIA,
  multiple,
  NESTING_ROWS,
  NS,
  only,
  outcome,
  read,
  response,
  rules,
  setOutcome,
  single,
  template,
  textEntry,
  value,
  variable,
} from "./validate-fixtures.js";

describe("the unordered classes of BIND §5.1", () => {
  it("[V1] allows one figcaption in a figure and reports a second", () => {
    expect(check({ body: "<figure><figcaption>a</figcaption><p>x</p></figure>" })).toEqual([]);
    const issues = check({ body: "<figure><figcaption>a</figcaption><p>x</p><figcaption>b</figcaption></figure>" });
    expect(issues).toMatchObject([
      { severity: "error", code: "olah/validate/figure-multiplicity", source: "BIND §5.1.1" },
    ]);
    expect(issues[0]?.location?.element).toBe("qti-assessment-item/qti-item-body/figure");
  });

  it("[V2] allows each of rp, rt and rtc once in a ruby and reports a repeat", () => {
    expect(check({ body: "<p><ruby><rb>真</rb><rp>(</rp><rt>ま</rt></ruby></p>" })).toEqual([]);
    for (const repeated of ["<rt>a</rt><rt>b</rt>", "<rp>(</rp><rp>)</rp>"]) {
      const issues = check({ body: `<p><ruby><rb>真</rb>${repeated}</ruby></p>` });
      expect(codesOf(issues)).toEqual(["olah/validate/ruby-multiplicity"]);
      expect(issues[0]?.source).toBe("BIND §5.1.2");
    }
  });
});

describe("the explicit rule sets of BIND §5.3: the roles and the general rule", () => {
  it("[V3] lets an h1 have the role heading, tab or presentation and no other", () => {
    for (const role of ["heading", "tab", "presentation"])
      expect(check({ body: `<h1 role="${role}">x</h1>` })).toEqual([]);
    const issues = check({ body: '<h1 role="button">x</h1>' });
    expect(issues).toMatchObject([{ code: "RULE_SET_ARIA_ROLES_1", source: "BIND §5.3.1", severity: "error" }]);
  });

  it("[V3] lets no source have a role", () => {
    expect(check({ body: '<audio><source src="a.mp3" type="audio/mpeg"/></audio>' })).toEqual([]);
    const issues = check({ body: '<audio><source src="a.mp3" type="audio/mpeg" role="presentation"/></audio>' });
    expect(codesOf(issues)).toEqual(["RULE_SET_ARIA_ROLES_1"]);
  });

  it("[V4][B87] forbids outcome-minimum, outcome-maximum and test-variables in response processing", () => {
    const declarations = outcome("SCORE", "single", "float");
    for (const expression of [
      '<qti-outcome-minimum outcome-identifier="SCORE"/>',
      '<qti-outcome-maximum outcome-identifier="SCORE"/>',
      '<qti-test-variables variable-identifier="SCORE"/>',
    ]) {
      const issues = check({ declarations, processing: rules(setOutcome("SCORE", expression)) });
      expect(only(issues, "RULE_SET_GENERAL_1")).toMatchObject([{ severity: "error", source: "BIND §5.3.2" }]);
    }
    expect(check({ declarations, processing: rules(setOutcome("SCORE", base("float", "1"))) })).toEqual([]);
  });

  it("[B87] forbids the number-* expressions in response processing, which INFO keeps for outcome processing", () => {
    const declarations = outcome("SCORE", "single", "integer");
    for (const kind of ["correct", "incorrect", "presented", "responded", "selected"]) {
      const issues = check({ declarations, processing: rules(setOutcome("SCORE", `<qti-number-${kind}/>`)) });
      expect(only(issues, "olah/validate/outcome-only-expression")).toMatchObject([
        { severity: "error", source: "INFO §2.11.2" },
      ]);
    }
  });
});

describe("the explicit rule sets of BIND §5.3: the attributes of the interactions", () => {
  it.each(ATTRIBUTE_RULES)(
    "[V6][V8][V10][V12][V14][V16][V18][V20][V22][V24][V26][V28][V30][V32][V34][V36][V38][V40][V42] $code: reports the broken fixture once and accepts the kept one",
    (rule) => {
      const [brokenDeclarations, brokenBody] = rule.broken;
      expect(only(check({ declarations: brokenDeclarations, body: brokenBody }), rule.code)).toMatchObject([
        { severity: "error", source: rule.source },
      ]);
      const [keptDeclarations, keptBody] = rule.kept;
      expect(only(check({ declarations: keptDeclarations, body: keptBody }), rule.code)).toEqual([]);
    },
  );

  it("[V8] checks the choice interaction only when both attributes are given and counts 0 as no limit", () => {
    const unlimited = interaction("qti-choice-interaction", ' max-choices="0" min-choices="3"', choice("A"));
    expect(only(check({ declarations: multiple("identifier"), body: unlimited }), "RULE_SET_INTERACTION_02B")).toEqual(
      [],
    );
    const alone = interaction("qti-choice-interaction", ' min-choices="3"', choice("A"));
    expect(only(check({ declarations: multiple("identifier"), body: alone }), "RULE_SET_INTERACTION_02B")).toEqual([]);
  });

  it("[V30] treats a max-plays of 0 as a number, not as no limit", () => {
    const body = MEDIA(' min-plays="1" max-plays="0"');
    expect(only(check({ declarations: single("integer"), body }), "RULE_SET_INTERACTION_13B")).toHaveLength(1);
  });
});

// The nesting rule sets A -------------------------------------------------------------------------------------------------

/** An element as `walkDocument` visits it, for a rule set to read. */
function visitOf(name: string, parent?: ElementVisit, model: Record<string, unknown> = {}): ElementVisit {
  return {
    name,
    model: { kind: name.replace(/^qti-/, ""), ...model },
    attributes: [],
    attributeWildcard: undefined,
    foreign: [],
    parent,
  };
}

function ruleSetsOn(visit: ElementVisit, context?: BindContext): Issue[] {
  const findings = new Findings();
  new BindRuleSets(findings, context).visit(visit);
  return findings.issues;
}

describe("the nesting rule sets A of BIND §5.3", () => {
  /** The rule set of each row V5 to V44, as the inventory names it. */
  const ids = inventoryElements(5, 44, "V");
  const idOf = (row: string): string => ids[Number(row.slice(1)) - 5] ?? "";

  it.each(NESTING_ROWS)(
    "[%s] reports an interaction inside the %s with the rule set A of the container",
    (row, container) => {
      const outer = visitOf(container);
      const issues = ruleSetsOn(visitOf("qti-text-entry-interaction", outer));
      const expected = container === "qti-text-entry-interaction" ? "RULE_SET_INTERACTION_01A" : idOf(row);
      expect(issues).toMatchObject([{ severity: "error", code: expected }]);
      expect(issues[0]?.message).toContain(`The ${container} must not contain the qti-text-entry-interaction`);
    },
  );

  it.each(NESTING_ROWS)(
    "[%s] accepts the %s with no interaction around it, and an interaction inside a div",
    (_row, container) => {
      expect(ruleSetsOn(visitOf(container))).toEqual([]);
      expect(ruleSetsOn(visitOf(container, visitOf("div", visitOf("qti-item-body"))))).toEqual([]);
    },
  );

  it("[V5] reports an interaction at any depth below the container, once, for the nearest container", () => {
    const outer = visitOf("qti-gap-match-interaction");
    const inner = visitOf("qti-hotspot-interaction", outer);
    const issues = ruleSetsOn(visitOf("qti-text-entry-interaction", visitOf("p", inner)));
    expect(codesOf(issues)).toEqual(["RULE_SET_INTERACTION_04A"]);
  });

  it("[V39] finds an interaction in the paragraph of a gap match interaction of a document", () => {
    const body = interaction(
      "qti-gap-match-interaction",
      "",
      `${GAP_TEXT}<p><qti-text-entry-interaction response-identifier="T"/></p>`,
    );
    const issues = check({
      declarations: response("R", "multiple", "directedPair") + single("string").replace('"R"', '"T"'),
      body,
    });
    expect(only(issues, "RULE_SET_INTERACTION_18A")).toMatchObject([
      {
        source: "BIND §5.3.37",
        location: {
          element: "qti-assessment-item/qti-item-body/qti-gap-match-interaction/p/qti-text-entry-interaction",
        },
      },
    ]);
  });

  it("[V43] finds an interaction in the content of a custom interaction, which the model keeps as XML", () => {
    const body = `<qti-custom-interaction response-identifier="R"><qti-text-entry-interaction response-identifier="T"/></qti-custom-interaction>`;
    const issues = check({ declarations: single("string"), body });
    expect(only(issues, "RULE_SET_INTERACTION_20A")).toMatchObject([{ source: "BIND §5.3.41" }]);
  });

  it("[V43] finds an interaction in the markup of a portable custom interaction", () => {
    const visit = visitOf("qti-interaction-markup", visitOf("qti-portable-custom-interaction"));
    const foreign = parseXml(`<div xmlns="${ASI_NAMESPACE}"><p><qti-choice-interaction/></p></div>`);
    expect(codesOf(ruleSetsOn({ ...visit, foreign: [foreign] }))).toEqual(["RULE_SET_INTERACTION_20A"]);
  });
});

// The remaining rule sets of BIND §5.3 and the constrained extension of §5.2 ---------------------------------------------

describe("the explicit rule sets of BIND §5.3: the associable elements, the rubric block and the declarations", () => {
  it.each(MATCH_LIMITS)(
    "[V45][V46][V47][V48] %s %s: reports a match-max below match-min, but not 0 or a limit that holds",
    (_row, code, source, build) => {
      const [declarations, body] = build('match-max="1" match-min="2"');
      expect(only(check({ declarations, body }), code)).toMatchObject([{ severity: "error", source }]);
      for (const limits of ['match-max="0" match-min="2"', 'match-max="2" match-min="2"']) {
        const [kept, markup] = build(limits);
        expect(only(check({ declarations: kept, body: markup }), code)).toEqual([]);
      }
    },
  );

  it("[V44] reports a context variable and a template variable of a portable custom interaction that the item does not declare", () => {
    const body = (variables: string): string =>
      `<qti-portable-custom-interaction response-identifier="R" custom-interaction-type-identifier="urn:fdc:example.org:pci" module="m">${variables}<qti-interaction-markup><div/></qti-interaction-markup></qti-portable-custom-interaction>`;
    const declared = `<qti-context-declaration identifier="C" cardinality="single" base-type="string"/>${single("string")}${template("T", "single", "integer")}`;
    const variables =
      '<qti-template-variable template-identifier="T"/><qti-context-variable identifier="C"/><qti-context-variable identifier="QTI_CONTEXT"/>';
    expect(only(check({ declarations: declared, body: body(variables) }), "RULE_SET_INTERACTION_20B")).toEqual([]);
    const issues = only(check({ declarations: single("string"), body: body(variables) }), "RULE_SET_INTERACTION_20B");
    expect(issues.map(({ message }) => message.replace(/ does NOT.*/, ""))).toEqual([
      "The 'qti-template-variable' \"T\"",
      "The 'qti-context-variable' \"C\"",
    ]);
    expect(issues[0]).toMatchObject({ severity: "error", source: "BIND §5.3.42" });
  });

  it("[V49] reports a rubric block inside a rubric block, and accepts one that stands alone", () => {
    expect(
      check({
        body: '<qti-rubric-block view="candidate" use="instructions"><qti-content-body><p>x</p></qti-content-body></qti-rubric-block>',
      }),
    ).toEqual([]);
    const outer = visitOf("qti-rubric-block");
    expect(ruleSetsOn(visitOf("qti-rubric-block", visitOf("qti-content-body", outer)))).toMatchObject([
      { code: "RULE_SET_RUBRICBLOCK", severity: "error", source: "BIND §5.3.47" },
    ]);
  });

  it("[B19] reports an interaction inside a rubric block", () => {
    const body = `<qti-rubric-block view="candidate" use="instructions"><qti-content-body><p>x</p></qti-content-body></qti-rubric-block>`;
    expect(check({ body })).toEqual([]);
    const issues = codesOf(
      (() => {
        const findings = new Findings();
        new DocumentChecks(findings).visit(visitOf("qti-text-entry-interaction", visitOf("qti-rubric-block")));
        return findings.issues;
      })(),
    );
    expect(issues).toEqual(["olah/validate/rubric-interaction"]);
  });

  it("[V50] reports a mastery value outside the normal minimum and maximum", () => {
    const declare = (attributes: string): string => outcome("SCORE", "single", "float", attributes);
    expect(check({ declarations: declare(' normal-minimum="0" normal-maximum="10" mastery-value="5"') })).toEqual([]);
    const below = check({ declarations: declare(' normal-minimum="1" normal-maximum="10" mastery-value="0"') });
    const above = check({ declarations: declare(' normal-minimum="0" normal-maximum="10" mastery-value="11"') });
    for (const issues of [below, above]) {
      expect(issues).toMatchObject([
        { code: "RULE_SET_SPECIFIC_CLASS_OUTCOMEDEC", severity: "error", source: "BIND §5.3.48" },
      ]);
    }
    expect(below[0]?.message).toContain("less than its normal-minimum 1");
    expect(above[0]?.message).toContain("greater than its normal-maximum 10");
  });

  it("[V51] reports a choice interaction with a max-choices other than 1 bound to a single variable", () => {
    const body = (attributes: string): string => interaction("qti-choice-interaction", attributes, choice("A"));
    const broken = check({ declarations: single("identifier"), body: body(' max-choices="2"') });
    expect(only(broken, "RULE_SET_SPECIFIC_CLASS_RESPONSEDEC")).toMatchObject([
      { severity: "error", source: "BIND §5.3.49" },
    ]);
    for (const [declarations, attributes] of [
      [multiple("identifier"), ' max-choices="2"'],
      [single("identifier"), ' max-choices="1"'],
      [single("identifier"), ""],
    ] as const) {
      expect(only(check({ declarations, body: body(attributes) }), "RULE_SET_SPECIFIC_CLASS_RESPONSEDEC")).toEqual([]);
    }
  });

  it("[V52] allows data- attributes and reports any other extension attribute of an element of the list", () => {
    for (const attribute of ['data-x="1"', 'data-a.b_c-d="1"'])
      expect(check({ body: `<p ${attribute}>x</p>` })).toEqual([]);
    for (const attribute of ['foo="1"', 'data-="1"', 'data_x="1"']) {
      const document = readAsi(
        itemXml({ body: `<p ${attribute}>x</p>` }).replace(
          "<qti-assessment-item ",
          '<qti-assessment-item xmlns:ext="urn:x" ',
        ),
      );
      expect(only(validateAsi(document), "olah/validate/extension-attribute")).toMatchObject([
        { severity: "error", source: "BIND §5.2" },
      ]);
    }
  });

  it("[V52] reports an attribute of another namespace, and a data- attribute of a namespace", () => {
    const xml = itemXml({ body: '<p ext:size="1" ext:data-x="2">x</p>' }).replace(
      "<qti-assessment-item ",
      '<qti-assessment-item xmlns:ext="urn:x" ',
    );
    const issues = only(validateAsi(read(xml)), "olah/validate/extension-attribute");
    expect(issues.map(({ message }) => /attribute (\S+) /.exec(message)?.[1])).toEqual(["ext:size", "ext:data-x"]);
  });

  it("[V52] applies to the root of the document and to the attributes of a custom interaction", () => {
    expect(only(check({ attributes: `${ITEM_ATTRIBUTES} data-ok="1"` }), "olah/validate/extension-attribute")).toEqual(
      [],
    );
    expect(only(check({ attributes: `${ITEM_ATTRIBUTES} bad="1"` }), "olah/validate/extension-attribute")).toHaveLength(
      1,
    );
    const body = '<qti-custom-interaction response-identifier="R" xmlns:ext="urn:x" ext:size="1"/>';
    expect(only(check({ declarations: single("string"), body }), "olah/validate/extension-attribute")).toHaveLength(1);
  });
});

// Identifiers, ids and references to ids -------------------------------------------------------------------------------

describe("the formats of the text attributes", () => {
  it("[B51] reports an identifier that is not a name and accepts one that is", () => {
    const body = (identifier: string): string =>
      `<qti-choice-interaction response-identifier="R">${choice(identifier)}</qti-choice-interaction>`;
    for (const identifier of ["A", "_a", "a-b.c", "É1"]) {
      expect(
        only(check({ declarations: single("identifier"), body: body(identifier) }), "olah/validate/identifier-syntax"),
      ).toEqual([]);
    }
    for (const identifier of ["1a", "a b", "-a", "a:b"]) {
      const issues = only(
        check({ declarations: single("identifier"), body: body(identifier) }),
        "olah/validate/identifier-syntax",
      );
      expect(issues).toMatchObject([{ severity: "error", source: "INFO §4.1.1" }]);
      expect(issues[0]?.message).toContain(`"${identifier}"`);
    }
  });

  it("[B51] warns about a period in the identifier of an item and about more than 32 characters, but not in a choice", () => {
    const issues = check({ identifier: "a.b" });
    expect(issues).toMatchObject([
      { severity: "warning", code: "olah/validate/identifier-style", source: "INFO §4.1.1" },
    ]);
    expect(issues[0]?.message).toContain("period");
    expect(check({ identifier: "a".repeat(32) })).toEqual([]);
    expect(check({ identifier: "a".repeat(33) })[0]?.message).toContain("more than 32 characters");
    const body = `<qti-choice-interaction response-identifier="R">${choice("a.b")}</qti-choice-interaction>`;
    expect(only(check({ declarations: single("identifier"), body }), "olah/validate/identifier-style")).toEqual([]);
  });

  it("[S1] reports an id that two elements share, the id of a response declaration included", () => {
    expect(check({ body: '<p id="a">x</p><p id="b">y</p>' })).toEqual([]);
    expect(only(check({ body: '<p id="a">x</p><div id="a">y</div>' }), "olah/validate/duplicate-id")).toMatchObject([
      { severity: "error", source: "INFO §5.16" },
    ]);
    const shared = check({ declarations: single("string"), body: `<p id="R">x</p>${textEntry("")}` });
    expect(only(shared, "olah/validate/duplicate-id")).toHaveLength(1);
  });

  it("[S6] resolves data-catalog-idref to a qti-catalog of the item", () => {
    const catalog = (id: string): string =>
      `<qti-catalog-info><qti-catalog id="${id}"><qti-card support="glossary-on-screen"><qti-card-entry xml:lang="en" default="true"><qti-html-content><p>x</p></qti-html-content></qti-card-entry></qti-card></qti-catalog></qti-catalog-info>`;
    const withCatalog = itemXml({ body: '<p data-catalog-idref="C1">word</p>' }).replace(
      "</qti-assessment-item>",
      `${catalog("C1")}</qti-assessment-item>`,
    );
    expect(validateAsi(read(withCatalog))).toEqual([]);
    const lacking = check({ body: '<p data-catalog-idref="C1">word</p>' });
    expect(only(lacking, "olah/validate/unresolved-reference")).toMatchObject([
      { severity: "error", source: "BPIG §3.7.10.2" },
    ]);
    const wrongTarget = check({ body: '<p id="other">a</p><p data-catalog-idref="other">word</p>' });
    expect(only(wrongTarget, "olah/validate/unresolved-reference")[0]?.message).toContain("must name a qti-catalog");
  });

  it("[S10][B52] reports an interaction whose response variable is undeclared or bound twice, and one the declaration does not suit", () => {
    const body = `${textEntry("")}${textEntry("")}`;
    const issues = check({ declarations: single("string"), body });
    expect(only(issues, "olah/interactions/response-bound-twice")).toHaveLength(1);
    expect(only(check({ body: textEntry("") }), "olah/interactions/response-undeclared")).toHaveLength(1);
    expect(
      only(check({ declarations: single("boolean"), body: textEntry("") }), "olah/interactions/binding"),
    ).toHaveLength(1);
    expect(check({ declarations: single("string"), body: textEntry("") })).toEqual([]);
  });

  it("[L5] warns about a response declaration that no interaction binds, and counts the second variable of a text entry as bound", () => {
    const issues = check({
      declarations: `${single("string")}${response("S", "single", "string")}`,
      body: textEntry(' string-identifier="S"'),
    });
    expect(issues).toEqual([]);
    const unbound = check({
      declarations: `${single("string")}${response("EXTRA", "single", "string")}`,
      body: textEntry(""),
    });
    expect(unbound).toMatchObject([
      { severity: "warning", code: "olah/validate/unbound-response", source: "INFO §2.2.2.2" },
    ]);
    expect(unbound[0]?.message).toContain('"EXTRA"');
  });
});

// Declarations ---------------------------------------------------------------------------------------------------------

describe("the declarations", () => {
  it("[T24] reports the declaration of a built-in variable, whatever its kind", () => {
    const declarations = `${response("numAttempts", "single", "integer")}${response("duration", "single", "duration")}${outcome("completionStatus", "single", "identifier")}${template("duration", "single", "float")}`;
    const issues = only(check({ declarations }), "olah/validate/reserved-identifier");
    expect(issues.map(({ message }) => /identifier "(\w+)"/.exec(message)?.[1])).toEqual([
      "numAttempts",
      "duration",
      "completionStatus",
      "duration",
    ]);
    expect(issues.map(({ source }) => source)).toEqual([
      "INFO §2.2.2.2",
      "INFO §2.2.2.2",
      "INFO §2.2.2.3",
      "INFO §2.2.2.2",
    ]);
    const context = `<qti-context-declaration identifier="QTI_CONTEXT" cardinality="record"/>`;
    expect(codesOf(check({ declarations: context }))).toEqual(["olah/validate/reserved-identifier"]);
  });

  it("[L2] reports an identifier declared twice in the namespace of the item, whatever the kinds", () => {
    const issues = check({
      declarations: `${response("X", "single", "string")}${outcome("X", "single", "float")}${template("X", "single", "float")}`,
    });
    expect(only(issues, "olah/validate/duplicate-identifier")).toMatchObject([
      { severity: "error", source: "INFO §5.34.1" },
      { severity: "error", source: "INFO §5.34.1" },
    ]);
    expect(check({ declarations: `${response("X", "single", "string")}${outcome("Y", "single", "float")}` })).toEqual([
      expect.objectContaining({ code: "olah/validate/unbound-response" }),
    ]);
  });

  it("[INFO §5.34.3] reports a variable that is not a record and has no base type", () => {
    const issues = check({ declarations: '<qti-outcome-declaration identifier="O" cardinality="single"/>' });
    expect(issues).toMatchObject([{ code: "olah/validate/base-type", severity: "error" }]);
    expect(check({ declarations: '<qti-outcome-declaration identifier="O" cardinality="record"/>' })).toEqual([]);
  });

  it("[T23][G40] warns when SCORE or MAXSCORE is not a float or PASSED not a boolean, and accepts the right types", () => {
    const issues = check({
      declarations: `${outcome("SCORE", "single", "integer")}${outcome("MAXSCORE", "single", "string")}${outcome("PASSED", "single", "float")}`,
    });
    expect(issues).toMatchObject([
      { code: "olah/validate/standard-outcome", severity: "warning", source: "INFO §2.2.2.3, BPIG §3.5" },
      { code: "olah/validate/standard-outcome", severity: "warning" },
      { code: "olah/validate/standard-outcome", severity: "warning" },
    ]);
    const right = `${outcome("SCORE", "single", "float")}${outcome("MAXSCORE", "single", "float")}${outcome("PASSED", "single", "boolean")}`;
    expect(check({ declarations: right })).toEqual([]);
  });

  it("reports a default value, a correct response, a map key and a lookup table value that are not in the lexical form of the base type", () => {
    const badDefault = check({ declarations: outcome("SCORE", "single", "float", "", value("high")) });
    expect(badDefault).toMatchObject([{ code: "olah/validate/declared-value", severity: "error" }]);
    expect(badDefault[0]?.message).toContain("high");
    const badCorrect = response(
      "R",
      "single",
      "integer",
      "<qti-correct-response><qti-value>1.5</qti-value></qti-correct-response>",
    );
    expect(codesOf(check({ declarations: badCorrect, body: textEntry("") }))).toEqual(["olah/validate/declared-value"]);
    const badKey = response(
      "R",
      "single",
      "integer",
      '<qti-mapping default-value="0"><qti-map-entry map-key="x" mapped-value="1"/></qti-mapping>',
    );
    expect(codesOf(check({ declarations: badKey, body: textEntry("") }))).toEqual(["olah/validate/declared-value"]);
    const table = (target: string): string =>
      `<qti-interpolation-table><qti-interpolation-table-entry source-value="1" target-value="${target}"/></qti-interpolation-table>`;
    expect(codesOf(check({ declarations: outcome("N", "single", "integer", "", table("yes")) }))).toEqual([
      "olah/validate/declared-value",
    ]);
    expect(check({ declarations: outcome("N", "single", "integer", "", table("7")) })).toEqual([]);
  });

  it("reports an xi:include that was left in the document, and nothing for one that was resolved", () => {
    const include = '<xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="body.xml"/>';
    const issues = only(check({ body: include }), "olah/validate/unresolved-include");
    expect(issues).toMatchObject([{ severity: "error", source: "INFO §2.12" }]);
    expect(issues[0]?.message).toContain("qti-item-body");
  });
});

// Variables and static types -------------------------------------------------------------------------------------------

/** An item with a float outcome SCORE and an integer one N, the usual targets. */
const OUTCOMES = `${outcome("SCORE", "single", "float")}${outcome("N", "single", "integer")}`;

/** The issues of the response processing `expression` assigned to `identifier`. */
function assigned(identifier: string, expression: string, declarations = OUTCOMES): readonly Issue[] {
  return check({ declarations, processing: rules(setOutcome(identifier, expression)) });
}

const sum = (...operands: string[]): string => `<qti-sum>${operands.join("")}</qti-sum>`;
const int = (text: string): string => base("integer", text);
const flt = (text: string): string => base("float", text);
const str = (text: string): string => base("string", text);

describe("the variables that expressions and rules name", () => {
  it("[L1] reports a variable, default, correct and mapping expression that names a variable the item does not declare", () => {
    for (const expression of [
      variable("MISSING"),
      '<qti-default identifier="MISSING"/>',
      '<qti-correct identifier="MISSING"/>',
      '<qti-map-response identifier="MISSING"/>',
      '<qti-map-response-point identifier="MISSING"/>',
    ]) {
      const issues = only(assigned("SCORE", expression), "olah/validate/undeclared-variable");
      expect(issues, expression).toMatchObject([{ severity: "error", source: "INFO §2.2.2" }]);
      expect(issues[0]?.message).toContain('"MISSING"');
    }
    expect(assigned("SCORE", `<qti-product>${flt("2")}${variable("N")}</qti-product>`)).toEqual([]);
  });

  it("[L1] reports a rule that sets a variable the item does not declare or one of another kind", () => {
    const declarations = `${OUTCOMES}${response("R", "single", "string")}`;
    const missing = check({ declarations: OUTCOMES, processing: rules(setOutcome("MISSING", flt("1"))) });
    expect(only(missing, "olah/validate/undeclared-variable")[0]?.message).toContain("does not declare");
    const wrongKind = check({ declarations, body: textEntry(""), processing: rules(setOutcome("R", str("a"))) });
    expect(only(wrongKind, "olah/validate/assignment-target")).toMatchObject([
      { severity: "error", source: "INFO §5.130" },
    ]);
    const lookup = check({
      declarations: OUTCOMES,
      processing: rules(`<qti-lookup-outcome-value identifier="MISSING">${int("1")}</qti-lookup-outcome-value>`),
    });
    expect(codesOf(lookup)).toContain("olah/validate/undeclared-variable");
  });

  it("[L1] reports a feedback outcome, a template identifier and a printed variable that the item does not declare or of the wrong kind", () => {
    const feedback = (identifier: string): string =>
      `<qti-feedback-block outcome-identifier="${identifier}" identifier="a" show-hide="show"><qti-content-body><p>x</p></qti-content-body></qti-feedback-block>`;
    expect(only(check({ body: feedback("MISSING") }), "olah/validate/undeclared-variable")).toHaveLength(1);
    const modal = `<qti-modal-feedback outcome-identifier="MISSING" identifier="a" show-hide="show"><qti-content-body><p>x</p></qti-content-body></qti-modal-feedback>`;
    expect(only(check({ feedback: modal }), "olah/validate/undeclared-variable")).toHaveLength(1);
    const block = `<qti-template-block template-identifier="MISSING" identifier="a" show-hide="show"><qti-content-body><p>x</p></qti-content-body></qti-template-block>`;
    expect(only(check({ body: block }), "olah/validate/undeclared-variable")).toHaveLength(1);
    const inlineChoice = `<qti-choice-interaction response-identifier="R"><qti-simple-choice identifier="A" template-identifier="MISSING">a</qti-simple-choice></qti-choice-interaction>`;
    expect(
      only(check({ declarations: single("identifier"), body: inlineChoice }), "olah/validate/undeclared-variable"),
    ).toHaveLength(1);
    const printed = (identifier: string): string => `<p><qti-printed-variable identifier="${identifier}"/></p>`;
    expect(only(check({ body: printed("MISSING") }), "olah/validate/undeclared-variable")).toHaveLength(1);
    const kinds = only(
      check({ declarations: single("string"), body: `${textEntry("")}${printed("R")}` }),
      "olah/validate/reference-kind",
    );
    expect(kinds).toMatchObject([{ severity: "error", source: "INFO §7.30.6" }]);
    const wrongFeedback = check({ declarations: single("string"), body: `${textEntry("")}${feedback("R")}` });
    expect(only(wrongFeedback, "olah/validate/reference-kind")).toHaveLength(1);
  });

  it("[L1] requires a feedback outcome or template variable of base type identifier and cardinality single or multiple", () => {
    const feedback = (declaration: string, identifier: string): readonly Issue[] =>
      check({
        declarations: declaration,
        body: `<qti-feedback-block outcome-identifier="${identifier}" identifier="a" show-hide="show"><qti-content-body><p>x</p></qti-content-body></qti-feedback-block>`,
      });
    expect(only(feedback(outcome("F", "single", "identifier"), "F"), "olah/validate/reference-type")).toEqual([]);
    expect(only(feedback(outcome("F", "multiple", "identifier"), "F"), "olah/validate/reference-type")).toEqual([]);
    for (const declaration of [outcome("F", "single", "string"), outcome("F", "ordered", "identifier")]) {
      expect(only(feedback(declaration, "F"), "olah/validate/reference-type")).toMatchObject([{ severity: "error" }]);
    }
  });

  it("[L1] reports a numeric attribute that names a variable the item does not have, or one of the wrong type", () => {
    const round = (figures: string): string =>
      `<qti-round-to rounding-mode="decimalPlaces" figures="${figures}">${flt("1.5")}</qti-round-to>`;
    expect(assigned("SCORE", round("2"))).toEqual([]);
    expect(only(assigned("SCORE", round("MISSING")), "olah/validate/undeclared-variable")[0]?.message).toContain(
      "figures",
    );
    const declarations = `${OUTCOMES}${outcome("F", "single", "float")}${outcome("M", "multiple", "integer")}`;
    expect(assigned("SCORE", round("N"), declarations)).toEqual([]);
    expect(only(assigned("SCORE", round("F"), declarations), "olah/validate/reference-type")).toHaveLength(1);
    expect(only(assigned("SCORE", round("M"), declarations), "olah/validate/reference-type")).toHaveLength(1);
  });

  it("[L1] lets template processing read template and context variables only", () => {
    const declarations = `${outcome("SCORE", "single", "float")}${template("T", "single", "integer", value("1"))}${response("R", "single", "integer")}`;
    const rule = (name: string): string =>
      `<qti-template-processing><qti-set-template-value identifier="T">${variable(name)}</qti-set-template-value></qti-template-processing>`;
    expect(check({ declarations, template: rule("T"), body: textEntry("") })).toEqual([]);
    for (const name of ["SCORE", "R"]) {
      const issues = only(
        check({ declarations, template: rule(name), body: textEntry("") }),
        "olah/validate/variable-out-of-reach",
      );
      expect(issues).toMatchObject([{ severity: "error", source: "INFO §6.50" }]);
    }
  });

  it("[L8] reports duration used in an item that is not time dependent", () => {
    const processing = rules(
      setOutcome("FLAG", `<qti-duration-gte>${variable("duration")}${base("duration", "10")}</qti-duration-gte>`),
    );
    const declarations = outcome("FLAG", "single", "boolean");
    const used = check({ declarations, processing });
    expect(only(used, "olah/validate/duration-not-time-dependent")).toMatchObject([
      { severity: "error", source: "INFO §2.2.2.2" },
    ]);
    const timed = check({ declarations, processing, attributes: 'adaptive="false" time-dependent="true"' });
    expect(timed).toEqual([]);
  });
});

describe("the static types of expressions", () => {
  const operand = (issues: readonly Issue[]): Issue[] => only(issues, "olah/validate/operand-type");

  it("[L3] reports an operand whose base type the operator does not take, and accepts integers where floats are taken", () => {
    const issues = operand(assigned("SCORE", sum(flt("1"), str("a"))));
    expect(issues).toMatchObject([{ severity: "error", source: "INFO §2.11.3.40" }]);
    expect(issues[0]?.message).toBe(
      "The operator qti-sum takes single or multiple or ordered integer or float operands, found a single string as operand 2.",
    );
    expect(assigned("SCORE", sum(flt("1"), int("2")))).toEqual([]);
  });

  it("[L3] reports an operand of a cardinality the operator does not take", () => {
    const record = `${outcome("REC", "record", "")}`.replace(' base-type=""', "");
    const issues = operand(assigned("SCORE", sum(variable("REC")), `${OUTCOMES}${record}`));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain("found a record as operand 1");
    const container = `<qti-container-size>${int("1")}</qti-container-size>`;
    expect(operand(assigned("N", container))).toHaveLength(1);
  });

  it("[L3] reports operands of different base types where the operator takes one, and of different cardinalities for qti-match", () => {
    const declarations = `${OUTCOMES}${outcome("B", "single", "boolean")}${outcome("M", "multiple", "string")}${outcome("S", "single", "string")}`;
    const mixed = operand(assigned("M", `<qti-multiple>${str("a")}${int("1")}</qti-multiple>`, declarations));
    expect(mixed[0]?.message).toContain("operands of one base type, found string and integer");
    const match = operand(assigned("B", `<qti-match>${variable("M")}${variable("S")}</qti-match>`, declarations));
    expect(match[0]?.message).toContain("operands of one cardinality, found multiple and single");
    const same = assigned("B", `<qti-match>${variable("S")}${str("a")}</qti-match>`, declarations);
    expect(same).toEqual([]);
  });

  it("[L3][B86] reports a duration operand of qti-match, which must not be compared", () => {
    const declarations = `${OUTCOMES}${outcome("B", "single", "boolean")}`;
    const issues = operand(
      assigned("B", `<qti-match>${base("duration", "1")}${base("duration", "1")}</qti-match>`, declarations),
    );
    expect(issues.map(({ source }) => source)).toEqual(["INFO §2.11.3.28", "INFO §2.11.3.28"]);
  });

  it("[L3] reports the wrong number of operands of a model that was built and not read", () => {
    const declarations = `${OUTCOMES}${outcome("D", "single", "float")}`;
    const read = itemOf(
      itemXml({ declarations, processing: rules(setOutcome("D", `<qti-divide>${flt("1")}${flt("2")}</qti-divide>`)) }),
    );
    const [rule] = read.responseProcessing?.rules ?? [];
    if (rule?.kind !== "set-outcome-value" || rule.expression.kind !== "divide")
      throw new Error("The test reads a divide.");
    const [first] = rule.expression.operands;
    const expression = { ...rule.expression, operands: [first, first, first] };
    const built = json<AssessmentItem>(
      JSON.stringify({
        ...read,
        responseProcessing: { kind: "response-processing", rules: [{ ...rule, expression }] },
      }),
    );
    const issues = only(validateAsi({ kind: "item", item: built }), "olah/validate/operand-count");
    expect(issues).toMatchObject([{ severity: "error", source: "INFO §2.11.3.19" }]);
    expect(issues[0]?.message).toBe("The operator qti-divide takes 2 operands, found 3.");
  });

  it("[L3] infers the type from the bottom up and skips what the declaration or the value decides", () => {
    // qti-round gives an integer, so the sum of it and a float is a float; qti-index takes the base type of its operand.
    expect(assigned("SCORE", sum(`<qti-round>${flt("1.5")}</qti-round>`, flt("0.5")))).toEqual([]);
    const declarations = `${OUTCOMES}${outcome("L", "ordered", "integer")}`;
    expect(assigned("N", `<qti-index n="1">${variable("L")}</qti-index>`, declarations)).toEqual([]);
    // A record field and a custom operator have types known only from the value, and a qti-null has none.
    const record = "<outcome/>";
    expect(record).toBeDefined();
    expect(assigned("SCORE", sum("<qti-null/>", flt("1")))).toEqual([]);
    expect(assigned("N", `<qti-custom-operator class="x">${int("1")}</qti-custom-operator>`)).toEqual([]);
  });

  it("[L3] gives the integer result of qti-subtract to an integer outcome and the float result of qti-divide to no integer one", () => {
    expect(assigned("N", `<qti-subtract>${int("3")}${int("1")}</qti-subtract>`)).toEqual([]);
    expect(
      only(assigned("N", `<qti-divide>${int("4")}${int("2")}</qti-divide>`), "olah/validate/assignment-type"),
    ).toHaveLength(1);
  });

  it("[L3] reports a condition that is not a single boolean", () => {
    const condition = (expression: string): string =>
      `<qti-response-condition><qti-response-if>${expression}${setOutcome("N", int("1"))}</qti-response-if></qti-response-condition>`;
    const issues = only(
      check({ declarations: OUTCOMES, processing: rules(condition(int("1"))) }),
      "olah/validate/condition-type",
    );
    expect(issues).toMatchObject([{ severity: "error" }]);
    expect(issues[0]?.message).toBe(
      "The expression of qti-response-if must be a single boolean, found a single integer.",
    );
    expect(
      only(
        check({ declarations: OUTCOMES, processing: rules(condition(base("boolean", "true"))) }),
        "olah/validate/condition-type",
      ),
    ).toEqual([]);
  });
});

describe("assignments and lookup tables", () => {
  it("[L4] reports a value that cannot be set to the variable: another base type, another cardinality", () => {
    const issues = only(assigned("SCORE", str("a")), "olah/validate/assignment-type");
    expect(issues).toMatchObject([{ severity: "error", source: "INFO §5.130.2" }]);
    expect(issues[0]?.message).toBe('The variable "SCORE" is a single float and cannot be set to a single string.');
    const declarations = `${OUTCOMES}${outcome("M", "multiple", "string")}`;
    expect(only(assigned("M", str("a"), declarations), "olah/validate/assignment-type")[0]?.message).toContain(
      "a multiple string",
    );
  });

  it("[L4] promotes an integer to a float or a duration outcome (D5), and nothing else", () => {
    expect(assigned("SCORE", int("1"))).toEqual([]);
    const declarations = `${OUTCOMES}${outcome("T", "single", "duration")}`;
    expect(assigned("T", int("1"), declarations)).toEqual([]);
    expect(only(assigned("N", flt("1")), "olah/validate/assignment-type")).toHaveLength(1);
    expect(only(assigned("T", flt("1"), declarations), "olah/validate/assignment-type")).toHaveLength(1);
  });

  it("[L4] checks the rules of template processing against template, response and outcome variables", () => {
    const declarations = `${template("T", "single", "float")}${response("R", "single", "integer")}${outcome("O", "single", "integer")}`;
    const rule = (name: string, identifier: string, expression: string): string =>
      `<qti-template-processing><qti-${name} identifier="${identifier}">${expression}</qti-${name}></qti-template-processing>`;
    const run = (name: string, identifier: string, expression: string): readonly Issue[] =>
      check({ declarations, template: rule(name, identifier, expression), body: textEntry("") });
    expect(run("set-template-value", "T", int("1"))).toEqual([]);
    expect(only(run("set-template-value", "T", str("a")), "olah/validate/assignment-type")).toHaveLength(1);
    expect(only(run("set-template-value", "O", int("1")), "olah/validate/assignment-target")).toHaveLength(1);
    expect(run("set-correct-response", "R", int("1"))).toEqual([]);
    expect(only(run("set-correct-response", "T", int("1")), "olah/validate/assignment-target")).toHaveLength(1);
    expect(run("set-default-value", "O", int("1"))).toEqual([]);
    expect(only(run("set-default-value", "T", int("1")), "olah/validate/assignment-target")).toHaveLength(1);
  });

  it("[L4] reports a lookup of a variable that has no lookup table, a source that is not a number, and a match table that gets a float", () => {
    const interpolation =
      '<qti-interpolation-table><qti-interpolation-table-entry source-value="0" target-value="1"/></qti-interpolation-table>';
    const match = '<qti-match-table><qti-match-table-entry source-value="0" target-value="integer"/></qti-match-table>';
    const declarations = `${outcome("WITH", "single", "integer", "", interpolation)}${outcome("EXACT", "single", "integer", "", match)}${OUTCOMES}`;
    const lookup = (identifier: string, expression: string): readonly Issue[] =>
      check({
        declarations,
        processing: rules(
          `<qti-lookup-outcome-value identifier="${identifier}">${expression}</qti-lookup-outcome-value>`,
        ),
      });
    expect(lookup("WITH", flt("0.5")).filter((issue) => issue.code.startsWith("olah/validate/lookup"))).toEqual([]);
    expect(only(lookup("N", int("1")), "olah/validate/lookup-table")).toMatchObject([
      { severity: "error", source: "INFO §5.87" },
    ]);
    expect(only(lookup("WITH", str("a")), "olah/validate/lookup-source")).toMatchObject([{ source: "INFO §5.87.2" }]);
    const exact = only(lookup("EXACT", flt("0.5")), "olah/validate/lookup-source");
    expect(exact[0]?.message).toBe(
      'The rule qti-lookup-outcome-value for "EXACT" needs a single integer, found a single float.',
    );
    expect(only(lookup("EXACT", int("0")), "olah/validate/lookup-source")).toEqual([]);
  });

  it("reports a completionStatus that is not one of the four terms, with the white space of the text ignored", () => {
    const set = (term: string): readonly Issue[] =>
      check({ processing: rules(setOutcome("completionStatus", base("identifier", term))) });
    expect(set("completed")).toEqual([]);
    expect(set("\n  incomplete  \n")).toEqual([]);
    expect(only(set("done"), "olah/validate/completion-status")).toMatchObject([
      { severity: "error", source: "INFO §2.2.2.3" },
    ]);
  });

  it("[L10] warns about a template variable that a constraint reads and that has no default", () => {
    const constraint = (inner: string): string =>
      `<qti-template-processing><qti-set-template-value identifier="A">${int("1")}</qti-set-template-value><qti-template-constraint>${inner}</qti-template-constraint></qti-template-processing>`;
    const gt = `<qti-gt>${variable("A")}${int("0")}</qti-gt>`;
    const without = check({ declarations: template("A", "single", "integer"), template: constraint(gt) });
    expect(without).toMatchObject([
      { code: "olah/validate/constraint-without-default", severity: "warning", source: "INFO §5.150" },
    ]);
    expect(check({ declarations: template("A", "single", "integer", value("1")), template: constraint(gt) })).toEqual(
      [],
    );
    const nested = `<qti-template-processing><qti-template-condition><qti-template-if>${base("boolean", "true")}<qti-template-constraint>${gt}</qti-template-constraint></qti-template-if></qti-template-condition></qti-template-processing>`;
    const issues = check({ declarations: template("A", "single", "integer", value("1")), template: nested });
    expect(only(issues, "olah/validate/template-constraint")).toMatchObject([
      { severity: "error", source: "INFO §5.150" },
    ]);
  });
});

describe("constants and the options", () => {
  it("[G18] warns about qti-match on floats, and says nothing for other base types", () => {
    const declarations = `${OUTCOMES}${outcome("B", "single", "boolean")}`;
    const issues = assigned("B", `<qti-match>${flt("1")}${flt("1")}</qti-match>`, declarations);
    expect(issues).toMatchObject([
      { code: "olah/validate/match-float", severity: "warning", source: "INFO §2.11.3.28" },
    ]);
    expect(assigned("B", `<qti-match>${int("1")}${int("1")}</qti-match>`, declarations)).toEqual([]);
  });

  it("[G32][G33] reports random bounds that are constants and make the value always NULL", () => {
    const randomInteger = (attributes: string): readonly Issue[] =>
      assigned("N", `<qti-random-integer ${attributes}/>`);
    const randomFloat = (attributes: string): readonly Issue[] =>
      assigned("SCORE", `<qti-random-float ${attributes}/>`);
    expect(randomInteger('min="1" max="5" step="2"')).toEqual([]);
    expect(only(randomInteger('min="6" max="5"'), "olah/validate/random-bounds")).toMatchObject([
      { source: "INFO §7.34" },
    ]);
    expect(only(randomInteger('max="-1"'), "olah/validate/random-bounds")).toHaveLength(1);
    expect(only(randomInteger('max="5" step="0"'), "olah/validate/random-bounds")).toHaveLength(1);
    expect(randomFloat('min="1" max="5"')).toEqual([]);
    expect(only(randomFloat('min="6" max="5"'), "olah/validate/random-bounds")).toMatchObject([
      { source: "INFO §7.33" },
    ]);
    const declarations = `${OUTCOMES}${outcome("LIMIT", "single", "integer")}`;
    expect(assigned("N", '<qti-random-integer min="LIMIT" max="1"/>', declarations)).toEqual([]);
  });

  it("[G35][B44] reports a weight on qti-test-variables with base-type integer", () => {
    const declarations = `${outcome("T", "multiple", "integer")}`;
    const issues = check({
      declarations,
      processing: rules(
        setOutcome("T", '<qti-test-variables variable-identifier="X" base-type="integer" weight-identifier="W"/>'),
      ),
    });
    expect(only(issues, "olah/validate/weight-with-integer")).toMatchObject([
      { severity: "error", source: "INFO §7.39.5" },
    ]);
  });

  it("[L9] warns about a weight in an item, where weights are not defined", () => {
    const issues = assigned("SCORE", '<qti-variable identifier="N" weight-identifier="W"/>');
    expect(issues).toMatchObject([
      { code: "olah/validate/weight-undefined", severity: "warning", source: "INFO §7.47.2" },
    ]);
  });

  it("[G7] reports a custom operator that no registered operator serves, only when the registered operators are given", () => {
    const processing = rules(
      setOutcome("N", `<qti-custom-operator definition="urn:x:op" class="op">${int("1")}</qti-custom-operator>`),
    );
    expect(check({ declarations: OUTCOMES, processing })).toEqual([]);
    const registered = new Map([["op", () => null]]);
    expect(check({ declarations: OUTCOMES, processing }, { customOperators: registered })).toEqual([]);
    const issues = check({ declarations: OUTCOMES, processing }, { customOperators: new Map() });
    expect(issues).toMatchObject([
      { code: "olah/validate/custom-operator", severity: "error", source: "INFO §2.11.3.2" },
    ]);
    expect(issues[0]?.message).toContain('"urn:x:op" or "op"');
  });

  it("[INFO §5.104.1] reports a pattern that is not in the dialect of XML Schema, or too large", () => {
    const body = (pattern: string): string => textEntry(` pattern-mask="${pattern}"`);
    expect(check({ declarations: single("string"), body: body("[a-z]+") })).toEqual([]);
    const issues = only(check({ declarations: single("string"), body: body("[a-") }), "olah/validate/pattern");
    expect(issues).toMatchObject([{ severity: "error", source: "INFO §5.162.5" }]);
    const match = (pattern: string): string =>
      `<qti-pattern-match pattern="${pattern}">${str("a")}</qti-pattern-match>`;
    const declarations = `${outcome("B", "single", "boolean")}${outcome("P", "single", "string")}`;
    expect(assigned("B", match("[a-z]+"), declarations)).toEqual([]);
    expect(only(assigned("B", match("(a"), declarations), "olah/validate/pattern")).toMatchObject([
      { source: "INFO §5.104.1" },
    ]);
    expect(assigned("B", match("{P}"), declarations)).toEqual([]);
  });
});

describe("response processing templates", () => {
  const Template = "https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/match_correct.xml";
  const answered = (processing: string, declarations = ""): readonly Issue[] =>
    check({
      declarations: `${response("RESPONSE", "single", "string", "<qti-correct-response><qti-value>a</qti-value></qti-correct-response>")}${outcome("SCORE", "single", "float")}${declarations}`,
      body: textEntry("").replace('"R"', '"RESPONSE"'),
      processing,
    });

  it("[L11] reports a template that is neither standard nor resolved and has no rules of its own", () => {
    const issues = only(
      answered('<qti-response-processing template="urn:example:template"/>'),
      "olah/validate/unknown-template",
    );
    expect(issues).toMatchObject([{ severity: "error", source: "INFO §4.6.1" }]);
    expect(issues[0]?.message).toContain('"urn:example:template"');
    expect(
      only(
        answered('<qti-response-processing template="urn:example:template" template-location="t.xml"/>'),
        "olah/validate/unknown-template",
      )[0]?.message,
    ).toContain('"t.xml"');
  });

  it("[L11][B45] accepts a standard template, in each spelling of its address, and a template of the own rules", () => {
    for (const address of [
      Template,
      Template.replace(".xml", ""),
      Template.replace("https", "http"),
      "https://www.imsglobal.org/question/qti_v3p0/rptemplates/match_correct.xml",
    ]) {
      expect(answered(`<qti-response-processing template="${address}"/>`), address).toEqual([]);
    }
    expect(answered(rules(setOutcome("SCORE", flt("1"))))).toEqual([]);
    expect(answered('<qti-response-processing template=""/>')).toEqual([]);
  });

  it("[L11] asks the resolver for the template-location, else the template, and accepts what it returns", () => {
    const resolved = itemOf(
      itemXml({ declarations: outcome("SCORE", "single", "float"), processing: rules(setOutcome("SCORE", flt("1"))) }),
    ).responseProcessing;
    const asked: string[] = [];
    const resolveTemplate = (uri: string) => {
      asked.push(uri);
      return uri === "t.xml" ? resolved : undefined;
    };
    const found = check(
      {
        declarations: outcome("SCORE", "single", "float"),
        processing: '<qti-response-processing template="urn:x" template-location="t.xml"/>',
      },
      { resolveTemplate },
    );
    expect(found).toEqual([]);
    expect(asked).toEqual(["t.xml"]);
    const missing = check(
      { declarations: outcome("SCORE", "single", "float"), processing: '<qti-response-processing template="urn:x"/>' },
      { resolveTemplate },
    );
    expect(codesOf(missing)).toEqual(["olah/validate/unknown-template"]);
  });

  it("[G43] warns about the address of a QTI 2.x template, which olah applies as the template of the same algorithm", () => {
    const address = "http://www.imsglobal.org/question/qti_v2p1/rptemplates/match_correct";
    const issues = answered(`<qti-response-processing template="${address}"/>`);
    expect(issues).toMatchObject([
      { code: "olah/validate/legacy-template", severity: "warning", source: "BPIG §2.5.1" },
    ]);
  });

  it("[L4] checks the rules of a standard template against the declarations of the item", () => {
    const lacking = check({
      declarations: response("RESPONSE", "single", "string"),
      body: textEntry("").replace('"R"', '"RESPONSE"'),
      processing: `<qti-response-processing template="${Template}"/>`,
    });
    expect(
      only(lacking, "olah/validate/undeclared-variable").map(({ message }) => /"(\w+)"/.exec(message)?.[1]),
    ).toEqual(["SCORE", "SCORE"]);
    expect(answered(`<qti-response-processing template="${Template}"/>`)).toEqual([]);
    const wrong = check({
      declarations: `${response("RESPONSE", "single", "string")}${outcome("SCORE", "single", "integer")}`,
      body: textEntry("").replace('"R"', '"RESPONSE"'),
      processing: `<qti-response-processing template="${Template}"/>`,
    });
    expect(only(wrong, "olah/validate/assignment-type")).toHaveLength(2);
  });
});

describe("content that its variable can never show", () => {
  const feedback = (identifier: string, showHide = "show", variableName = "FEEDBACK"): string =>
    `<qti-modal-feedback outcome-identifier="${variableName}" identifier="${identifier}" show-hide="${showHide}"><qti-content-body><p>x</p></qti-content-body></qti-modal-feedback>`;
  const declaration = (content = ""): string => outcome("FEEDBACK", "single", "identifier", "", content);
  const unreachable = (issues: readonly Issue[]): Issue[] => only(issues, "olah/validate/unreachable-content");

  it("[L6] warns about feedback for an identifier that every assignment to the outcome leaves out", () => {
    const processing = rules(setOutcome("FEEDBACK", base("identifier", "right")));
    expect(unreachable(check({ declarations: declaration(), processing, feedback: feedback("right") }))).toEqual([]);
    const issues = unreachable(check({ declarations: declaration(), processing, feedback: feedback("wrong") }));
    expect(issues).toMatchObject([{ severity: "warning", source: "INFO §5.93.2" }]);
    expect(issues[0]?.message).toBe(
      'The qti-modal-feedback is never shown: it shows for the identifier "wrong", but the only values that FEEDBACK can take are "right".',
    );
  });

  it("[L6] counts the default value and the values of every branch, and says never hidden for hide", () => {
    const conditional = rules(
      `<qti-response-condition><qti-response-if>${base("boolean", "true")}${setOutcome("FEEDBACK", base("identifier", "a"))}</qti-response-if><qti-response-else>${setOutcome("FEEDBACK", base("identifier", "b"))}</qti-response-else></qti-response-condition>`,
    );
    const declarations = declaration(value("start"));
    for (const shown of ["a", "b", "start"])
      expect(unreachable(check({ declarations, processing: conditional, feedback: feedback(shown) }))).toEqual([]);
    const hidden = unreachable(check({ declarations, processing: conditional, feedback: feedback("zzz", "hide") }));
    expect(hidden[0]?.message).toContain("is never hidden");
    expect(unreachable(check({ declarations, processing: conditional, feedback: feedback("a", "hide") }))).toEqual([]);
  });

  it("[L6] says nothing when a value is computed, the outcome is scored by someone else, or the template cannot be found", () => {
    const computed = rules(setOutcome("FEEDBACK", variable("OTHER")));
    const others = `${declaration()}${outcome("OTHER", "single", "identifier")}`;
    expect(unreachable(check({ declarations: others, processing: computed, feedback: feedback("wrong") }))).toEqual([]);
    const external = outcome("FEEDBACK", "single", "identifier", ' external-scored="human"');
    expect(unreachable(check({ declarations: external, feedback: feedback("wrong") }))).toEqual([]);
    const unknown = '<qti-response-processing template="urn:example:template"/>';
    expect(
      unreachable(check({ declarations: declaration(), processing: unknown, feedback: feedback("wrong") })),
    ).toEqual([]);
  });

  it("[L6] counts the targets of a lookup table, and covers template variables that show template content", () => {
    const table =
      '<qti-interpolation-table default-value="low"><qti-interpolation-table-entry source-value="5" target-value="high"/></qti-interpolation-table>';
    const processing = rules(`<qti-lookup-outcome-value identifier="FEEDBACK">${flt("1")}</qti-lookup-outcome-value>`);
    const declarations = `${declaration(table)}`;
    expect(unreachable(check({ declarations, processing, feedback: feedback("high") }))).toEqual([]);
    expect(unreachable(check({ declarations, processing, feedback: feedback("medium") }))).toHaveLength(1);
    const block = (identifier: string): string =>
      `<qti-template-block template-identifier="T" identifier="${identifier}" show-hide="show"><qti-content-body><p>x</p></qti-content-body></qti-template-block>`;
    const rule = `<qti-template-processing><qti-set-template-value identifier="T">${base("identifier", "yes")}</qti-set-template-value></qti-template-processing>`;
    const templates = template("T", "single", "identifier");
    expect(unreachable(check({ declarations: templates, template: rule, body: block("yes") }))).toEqual([]);
    expect(unreachable(check({ declarations: templates, template: rule, body: block("no") }))).toHaveLength(1);
  });
});

// Tests ------------------------------------------------------------------------------------------------------------------

interface TestParts {
  readonly declarations?: string;
  readonly rubric?: string;
  readonly part?: string;
  readonly sections?: string;
  readonly processing?: string;
  readonly feedback?: string;
  readonly partAttributes?: string;
}

const itemRef = (identifier: string, content = "", href = `${identifier}.xml`): string =>
  `<qti-assessment-item-ref identifier="${identifier}" href="${href}">${content}</qti-assessment-item-ref>`;
const section = (identifier: string, children: string, attributes = ' visible="true"', content = ""): string =>
  `<qti-assessment-section identifier="${identifier}" title="${identifier}"${attributes}>${content}${children}</qti-assessment-section>`;
const isNull = (name: string): string => `<qti-is-null>${variable(name)}</qti-is-null>`;
const branch = (target: string, expression = base("boolean", "true")): string =>
  `<qti-branch-rule target="${target}">${expression}</qti-branch-rule>`;

/** Writes the XML of a test with one part, which holds the given sections. */
function testXml({
  declarations = "",
  rubric = "",
  sections = section("S", itemRef("I1")),
  processing = "",
  feedback = "",
  partAttributes = 'navigation-mode="linear" submission-mode="individual"',
  part = "",
}: TestParts = {}): string {
  return `<qti-assessment-test ${NS} identifier="T" title="T">${declarations}${rubric}<qti-test-part identifier="P" ${partAttributes}>${part}${sections}</qti-test-part>${processing}${feedback}</qti-assessment-test>`;
}

function testOf(xml: string): AssessmentTest {
  const document = read(xml);
  if (document.kind !== "test") throw new Error("The test reads a test.");
  return document.test;
}

/** The documents of a test by path, which `resolversOf` reads when a reference names them. */
type Files = Readonly<Record<string, string>>;

/** Resolvers over documents in memory: items, sections and stimuli by the path their `href` resolves to. */
function resolversOf(files: Files): Resolvers {
  const find = (href: string, base: string): AsiDocument => {
    const path = resolveReference(base, href);
    const xml = path === undefined ? undefined : files[path];
    if (xml === undefined)
      throw readError(
        "olah/package/missing-file",
        `The package has no file ${JSON.stringify(path ?? href)}.`,
        "BIND §8",
        { path: base },
      );
    return read(xml);
  };
  return {
    items: (href, base): ResolvedItem => {
      const document = find(href, base);
      if (document.kind !== "item") throw new Error("The test names an item.");
      return { resource: href, deliverable: { kind: "qti", item: document.item }, hazards: [], variants: [] };
    },
    sections: (href, base): AssessmentSection => {
      const document = find(href, base);
      if (document.kind !== "section") throw new Error("The test names a section.");
      return document.section;
    },
    stimuli: (href, base) => {
      const document = find(href, base);
      if (document.kind !== "stimulus") throw new Error("The test names a stimulus.");
      return document.stimulus;
    },
  };
}

/** An item that scores one response, so that a test can read `I1.SCORE`. */
const SCORED = itemXml({
  identifier: "I1",
  declarations: `${response("RESPONSE", "single", "string")}${outcome("SCORE", "single", "float")}${outcome("MARK", "single", "integer")}`,
  body: textEntry("").replace('"R"', '"RESPONSE"'),
  processing: rules(setOutcome("SCORE", flt("1"))),
});
const itemFile = (identifier: string, parts: ItemParts = {}): string => itemXml({ ...parts, identifier });

/** Validates a test whose item references name the given items. */
function validated(parts: TestParts, files: Files = {}, options = {}): readonly Issue[] {
  const defaults: Record<string, string> = { "I1.xml": SCORED, "I2.xml": itemFile("I2"), "I3.xml": itemFile("I3") };
  return validateTest(testOf(testXml(parts)), "test.xml", resolversOf({ ...defaults, ...files }), options);
}

const testOutcomes = `${outcome("TOTAL", "single", "float")}${outcome("COUNT", "single", "integer")}${outcome("FLAG", "single", "boolean")}`;
const outcomeRules = (...inner: string[]): string =>
  `<qti-outcome-processing>${inner.join("")}</qti-outcome-processing>`;

describe("validateTest: the variables a test reads", () => {
  it("[L1] reads the item variables as ITEM.VARIABLE and ITEM.n.VARIABLE, and the duration of a part or section", () => {
    const processing = outcomeRules(
      setOutcome("TOTAL", variable("I1.SCORE")),
      setOutcome("TOTAL", variable("I1.2.SCORE")),
      setOutcome("TOTAL", sum(variable("I1.numAttempts"), int("1"))),
      setOutcome("FLAG", `<qti-duration-gte>${variable("S.duration")}${base("duration", "1")}</qti-duration-gte>`),
      setOutcome("FLAG", `<qti-duration-gte>${variable("P.duration")}${variable("duration")}</qti-duration-gte>`),
    );
    expect(validated({ declarations: testOutcomes, processing })).toEqual([]);
  });

  it("[L1] reports an item reference that the test does not have, and a variable the item does not declare", () => {
    const issues = (name: string) =>
      only(
        validated({ declarations: testOutcomes, processing: outcomeRules(setOutcome("TOTAL", variable(name))) }),
        "olah/validate/undeclared-variable",
      );
    expect(issues("NOPE.SCORE")[0]?.message).toContain("declares no item variable or duration");
    expect(issues("I1.NOPE")).toMatchObject([{ severity: "error", source: "INFO §2.2.2" }]);
    expect(issues("I1.NOPE")[0]?.message).toContain('declares no variable "NOPE"');
    expect(issues("MISSING")[0]?.message).toContain('The test declares no variable "MISSING"');
    expect(issues("I1.2.3.SCORE")).toHaveLength(1);
    expect(issues("I1.0.SCORE")).toHaveLength(1);
    expect(issues("S.SCORE")).toHaveLength(1);
  });

  it("[L1] follows the variable mappings of the item reference", () => {
    const mapped = section(
      "S",
      itemRef("I1", '<qti-variable-mapping source-identifier="SCORE" target-identifier="POINTS"/>'),
    );
    const read = (name: string) =>
      validated({
        declarations: testOutcomes,
        sections: mapped,
        processing: outcomeRules(setOutcome("TOTAL", variable(name))),
      });
    expect(only(read("I1.POINTS"), "olah/validate/undeclared-variable")).toEqual([]);
    expect(only(read("I1.NOPE"), "olah/validate/undeclared-variable")).toHaveLength(1);
    const unknown = section(
      "S",
      itemRef("I1", '<qti-variable-mapping source-identifier="NOPE" target-identifier="POINTS"/>'),
    );
    expect(only(validated({ sections: unknown }), "olah/validate/undeclared-variable")).toMatchObject([
      { source: "INFO §7.48.1" },
    ]);
    const twice = section(
      "S",
      itemRef(
        "I1",
        '<qti-variable-mapping source-identifier="SCORE" target-identifier="X"/><qti-variable-mapping source-identifier="MARK" target-identifier="X"/>',
      ),
    );
    expect(only(validated({ sections: twice }), "olah/validate/duplicate-identifier")).toHaveLength(1);
  });

  it("[L8] reports the duration of an item that is not time dependent", () => {
    const processing = outcomeRules(
      setOutcome("FLAG", `<qti-duration-gte>${variable("I1.duration")}${base("duration", "1")}</qti-duration-gte>`),
    );
    expect(
      only(validated({ declarations: testOutcomes, processing }), "olah/validate/duration-not-time-dependent"),
    ).toHaveLength(1);
    const timed = SCORED.replace('time-dependent="false"', 'time-dependent="true"');
    expect(
      only(
        validated({ declarations: testOutcomes, processing }, { "I1.xml": timed }),
        "olah/validate/duration-not-time-dependent",
      ),
    ).toEqual([]);
  });

  it("[L9] warns about a weight that the item reference does not define, and weights float", () => {
    const weighted = (weight: string, name = "I1.SCORE"): string =>
      outcomeRules(setOutcome("TOTAL", `<qti-variable identifier="${name}" weight-identifier="${weight}"/>`));
    const defined = section("S", itemRef("I1", '<qti-weight identifier="W" value="2"/>'));
    expect(
      only(
        validated({ declarations: testOutcomes, sections: defined, processing: weighted("W") }),
        "olah/validate/weight-undefined",
      ),
    ).toEqual([]);
    const issues = only(
      validated({ declarations: testOutcomes, processing: weighted("W") }),
      "olah/validate/weight-undefined",
    );
    expect(issues).toMatchObject([{ severity: "warning", source: "INFO §7.47.2" }]);
    expect(
      only(
        validated({ declarations: testOutcomes, processing: weighted("W", "COUNT") }),
        "olah/validate/weight-undefined",
      ),
    ).toHaveLength(1);
    // A weight turns an integer variable into a float, so the integer outcome cannot take it.
    const integer = validated({
      declarations: testOutcomes,
      sections: defined,
      processing: outcomeRules(setOutcome("COUNT", '<qti-variable identifier="I1.MARK" weight-identifier="W"/>')),
    });
    expect(only(integer, "olah/validate/assignment-type")).toHaveLength(1);
  });

  it("[L9] warns about a weight that no item reference of the test defines for qti-test-variables", () => {
    const expression = '<qti-test-variables variable-identifier="SCORE" weight-identifier="W"/>';
    const declarations = `${testOutcomes}${outcome("ALL", "multiple", "float")}`;
    const processing = outcomeRules(setOutcome("ALL", expression));
    expect(only(validated({ declarations, processing }), "olah/validate/weight-undefined")).toHaveLength(1);
    const defined = section("S", itemRef("I1", '<qti-weight identifier="W" value="2"/>'));
    expect(only(validated({ declarations, sections: defined, processing }), "olah/validate/weight-undefined")).toEqual(
      [],
    );
  });

  it("[L4] checks the outcome processing of the test: targets, types, and the outcomes of the test only", () => {
    const run = (...inner: string[]) => validated({ declarations: testOutcomes, processing: outcomeRules(...inner) });
    expect(run(setOutcome("TOTAL", int("1")))).toEqual([]);
    expect(only(run(setOutcome("TOTAL", str("a"))), "olah/validate/assignment-type")).toHaveLength(1);
    expect(only(run(setOutcome("MISSING", int("1"))), "olah/validate/undeclared-variable")).toHaveLength(1);
    expect(only(run(setOutcome("I1.SCORE", flt("1"))), "olah/validate/undeclared-variable")).toHaveLength(1);
    const outcomeOnly = run(
      setOutcome("COUNT", "<qti-number-correct/>"),
      setOutcome("TOTAL", '<qti-outcome-maximum outcome-identifier="SCORE"/>'),
    );
    expect(only(outcomeOnly, "olah/validate/outcome-only-expression")).toEqual([]);
  });

  it("[G24] warns when outcome processing sets an outcome that is scored externally", () => {
    const declarations = `${testOutcomes}${outcome("RATED", "single", "float", ' external-scored="human"')}`;
    const issues = validated({ declarations, processing: outcomeRules(setOutcome("RATED", flt("1"))) });
    expect(issues).toMatchObject([
      { code: "olah/validate/external-score-assigned", severity: "warning", source: "INFO §2.9" },
    ]);
  });
});

describe("validateTest: the structure of a test", () => {
  const two = (attributes = "", children = `${itemRef("I1")}${itemRef("I2")}`): string =>
    section("S", children, ` visible="true"${attributes}`);

  it("[L2] reports an identifier shared by parts, sections and item references", () => {
    const sections = `${section("S", `${itemRef("I1")}${itemRef("I1")}`)}${section("P", itemRef("I2"))}`;
    const issues = only(validated({ sections }), "olah/validate/duplicate-identifier");
    expect(issues.map(({ message }) => message)).toEqual([
      'The identifier "I1" names an item reference and an item reference; the identifiers of test parts, sections and item references must be unique in a test.',
      'The identifier "P" names a test part and a section; the identifiers of test parts, sections and item references must be unique in a test.',
    ]);
    expect(issues[0]?.source).toBe("INFO §4.2.1, §5.159.1");
    expect(only(validated({ sections: two() }), "olah/validate/duplicate-identifier")).toEqual([]);
  });

  it("[L2] reports the shared identifier of a section reference as well, and reads a test that has no resolvers", () => {
    const nested = `${section("S", itemRef("I1"))}<qti-assessment-section-ref identifier="S" href="s.xml"/>`;
    const files = {
      "s.xml": `<qti-assessment-section ${NS} identifier="S" title="S" visible="true">${itemRef("I2")}</qti-assessment-section>`,
    };
    expect(only(validated({ sections: nested }, files), "olah/validate/duplicate-identifier")).toHaveLength(1);
    const alone = validateAsi(
      read(testXml({ sections: `${section("S", itemRef("I1"))}${section("S", itemRef("I2"))}` })),
    );
    expect(only(alone, "olah/validate/duplicate-identifier")).toHaveLength(1);
  });

  it("[B21] reports a selection of more children than the section has, unless it selects with replacement", () => {
    const select = (attributes: string, children = `${itemRef("I1")}${itemRef("I2")}`): readonly Issue[] =>
      validated({ sections: two("", `<qti-selection ${attributes}/>${children}`) });
    expect(only(select('select="2"'), "olah/validate/selection")).toEqual([]);
    expect(only(select('select="1"'), "olah/validate/selection")).toEqual([]);
    const issues = only(select('select="3"'), "olah/validate/selection");
    expect(issues).toMatchObject([{ severity: "error", source: "INFO §5.129.1" }]);
    expect(only(select('select="3" with-replacement="true"'), "olah/validate/selection")).toEqual([]);
  });

  it("[B21] reports a selection of fewer children than the section requires, a section counting as one", () => {
    const required = `<qti-assessment-item-ref identifier="I1" href="I1.xml" required="true"/><qti-assessment-item-ref identifier="I2" href="I2.xml" required="true"/>`;
    const issues = only(
      validated({ sections: two("", `<qti-selection select="1"/>${required}`) }),
      "olah/validate/selection",
    );
    expect(issues).toMatchObject([{ severity: "error", source: "INFO §4.2.2" }]);
    const inner = section("In", itemRef("I2"), ' visible="true" required="true"');
    const nested = validated({ sections: two("", `<qti-selection select="1"/>${itemRef("I1")}${inner}`) });
    expect(only(nested, "olah/validate/selection")).toEqual([]);
  });

  it("[B27] reports an adaptive item in a part that submits simultaneously, but not an item of an adaptive section", () => {
    const adaptive = SCORED.replace('adaptive="false"', 'adaptive="true"');
    const simultaneous = 'navigation-mode="linear" submission-mode="simultaneous"';
    const issues = only(
      validated({ partAttributes: simultaneous }, { "I1.xml": adaptive }),
      "olah/validate/adaptive-simultaneous",
    );
    expect(issues).toMatchObject([{ severity: "error", source: "INFO §5.159.5" }]);
    expect(only(validated({}, { "I1.xml": adaptive }), "olah/validate/adaptive-simultaneous")).toEqual([]);
    const engine =
      '<qti-adaptive-selection><qti-adaptive-engine-ref identifier="E" href="https://cat.example.org"/><qti-adaptive-settings-ref identifier="S1" href="settings.data"/></qti-adaptive-selection>';
    const inCat = validated(
      { partAttributes: simultaneous, sections: section("S", `${engine}${itemRef("I1")}`) },
      { "I1.xml": adaptive },
    );
    expect(only(inCat, "olah/validate/adaptive-simultaneous")).toEqual([]);
  });

  it("[B66] reports an adaptive section with a sub-section or inside another section", () => {
    const engine =
      '<qti-adaptive-selection><qti-adaptive-engine-ref identifier="E" href="https://cat.example.org"/><qti-adaptive-settings-ref identifier="S1" href="settings.data"/></qti-adaptive-selection>';
    const flat = validated({ sections: section("A", `${engine}${itemRef("I1")}`) });
    expect(only(flat, "olah/validate/adaptive-section")).toEqual([]);
    const withSub = validated({ sections: section("A", `${engine}${section("B", itemRef("I1"))}`) });
    expect(only(withSub, "olah/validate/adaptive-section")).toMatchObject([{ severity: "error", source: "CAT §2.3" }]);
    const nested = validated({ sections: section("O", section("A", `${engine}${itemRef("I1")}`)) });
    expect(only(nested, "olah/validate/adaptive-section")).toHaveLength(1);
  });

  it("[B66] warns about branch rules and pre-conditions on the items of an adaptive section, which are ignored", () => {
    const engine =
      '<qti-adaptive-selection><qti-adaptive-engine-ref identifier="E" href="https://cat.example.org"/><qti-adaptive-settings-ref identifier="S1" href="settings.data"/></qti-adaptive-selection>';
    const issues = validated({ sections: section("A", `${engine}${itemRef("I1", branch("EXIT_TEST"))}`) });
    expect(only(issues, "olah/validate/ignored-rule")).toMatchObject([{ severity: "warning", source: "CAT §2.1" }]);
  });

  it("reports a section reference that the resolvers cannot resolve, and an item reference, once for each document", () => {
    const sections = `<qti-assessment-section-ref identifier="Gone" href="gone.xml"/>${section("S", `${itemRef("I1")}${itemRef("X", "", "gone.xml")}${itemRef("Y", "", "gone.xml")}`)}`;
    const issues = validated({ sections });
    expect(issues.filter(({ code }) => code === "olah/package/missing-file")).toHaveLength(2);
    expect(issues.every(({ severity }) => severity === "error")).toBe(true);
  });

  it("reports an item reference whose item has another identifier, as a warning", () => {
    const issues = validated({ sections: section("S", itemRef("Other", "", "I2.xml")) });
    expect(issues).toMatchObject([
      { code: "olah/validate/identifier-mismatch", severity: "warning", source: "INFO §4.1.1" },
    ]);
  });

  it("[L4] checks the template defaults of an item reference against the template variables of its item", () => {
    const withTemplate = itemXml({ identifier: "I1", declarations: template("T", "single", "float", value("1")) });
    const given = (name: string, expression: string): readonly Issue[] =>
      validated(
        {
          sections: section(
            "S",
            itemRef("I1", `<qti-template-default template-identifier="${name}">${expression}</qti-template-default>`),
          ),
        },
        { "I1.xml": withTemplate },
      );
    expect(given("T", flt("2"))).toEqual([]);
    expect(given("T", int("2"))).toEqual([]);
    expect(only(given("T", str("a")), "olah/validate/assignment-type")).toMatchObject([{ source: "INFO §5.152.2" }]);
    expect(only(given("NOPE", flt("2")), "olah/validate/undeclared-variable")).toMatchObject([
      { source: "INFO §5.152.1" },
    ]);
  });

  it("checks the items a test names, each once, with the path of its document, and the stimuli of the items", () => {
    const broken = itemXml({
      identifier: "I1",
      declarations: single("string"),
      body: textEntry(""),
      processing: rules(setOutcome("MISSING", int("1"))),
    });
    const sections = section("S", `${itemRef("I1")}${itemRef("Again", "", "I1.xml")}`);
    const issues = validated({ sections }, { "I1.xml": broken });
    const found = only(issues, "olah/validate/undeclared-variable");
    expect(found).toHaveLength(1);
    expect(found[0]?.location?.path).toBe("I1.xml");
    const stimulus = `<qti-assessment-stimulus ${NS} identifier="St" title="St"><qti-stimulus-body><p id="a">x</p><p id="a">y</p></qti-stimulus-body></qti-assessment-stimulus>`;
    const withStimulus = itemXml({ identifier: "I1", declarations: single("string"), body: textEntry("") }).replace(
      "<qti-item-body>",
      '<qti-assessment-stimulus-ref identifier="St" href="St.xml"/><qti-item-body>',
    );
    const shared = validated({}, { "I1.xml": withStimulus, "St.xml": stimulus });
    expect(only(shared, "olah/validate/duplicate-id")).toMatchObject([{ location: { path: "St.xml" } }]);
  });

  it("reads a test alone with validateAsi, leaving out what its references name", () => {
    const xml = testXml({
      sections: `<qti-assessment-section-ref identifier="Ext" href="ext.xml"/>${section("S", itemRef("I1", branch("Ext")))}`,
    });
    expect(validateAsi(read(xml))).toEqual([]);
    const outcomes = validateAsi(
      read(
        testXml({ declarations: testOutcomes, processing: outcomeRules(setOutcome("TOTAL", variable("ANY.THING"))) }),
      ),
    );
    expect(outcomes).toEqual([]);
  });
});

describe("validateTest: branch rules and pre-conditions", () => {
  const rules = (...children: string[]): string => children.join("");
  const branchTarget = (issues: readonly Issue[]): Issue[] => only(issues, "olah/validate/branch-target");

  it("[L7][B29] accepts a branch rule to an item or section ahead in the same part and the three exits", () => {
    const sections = rules(
      section("S1", `${itemRef("I1", branch("I3", isNull("I1.SCORE")))}${itemRef("I2")}`),
      section("S2", itemRef("I3")),
    );
    expect(branchTarget(validated({ declarations: testOutcomes, sections }))).toEqual([]);
    for (const target of ["EXIT_SECTION", "EXIT_TESTPART", "EXIT_TEST"]) {
      expect(branchTarget(validated({ sections: section("S", itemRef("I1", branch(target))) }))).toEqual([]);
    }
    const toSection = rules(section("S1", itemRef("I1", branch("S2"))), section("S2", itemRef("I2")));
    expect(branchTarget(validated({ sections: toSection }))).toEqual([]);
  });

  it("[L7] reports a branch rule to a target that does not exist, is not ahead, or is in another part", () => {
    const run = (sections: string): Issue[] => branchTarget(validated({ sections }));
    expect(run(section("S", itemRef("I1", branch("NOPE"))))[0]?.message).toContain(
      "is no test part, section or item reference",
    );
    const backward = run(section("S", `${itemRef("I1")}${itemRef("I2", branch("I1"))}`));
    expect(backward).toMatchObject([{ severity: "error", source: "INFO §2.8.3.2" }]);
    expect(backward[0]?.message).toContain("only jumps forward");
    expect(run(section("S", `${itemRef("I1", branch("I1"))}`))).toHaveLength(1);
    expect(run(section("S", `${itemRef("I1")}`, ' visible="true"', branch("S")))).toHaveLength(1);
    expect(run(section("S", itemRef("I1", branch("P"))))[0]?.message).toContain(
      "an item or section in the same test part",
    );
    const cyclic = rules(section("A", itemRef("I1", branch("B"))), section("B", itemRef("I2", branch("A"))));
    expect(run(cyclic)).toHaveLength(1);
  });

  it("[L7] checks the branch rules between test parts", () => {
    const parts = (rule: string): string =>
      `<qti-test-part identifier="P1" navigation-mode="linear" submission-mode="individual">${rule}${section("S1", itemRef("I1"))}</qti-test-part>`;
    const xml = (rule: string): string =>
      `<qti-assessment-test ${NS} identifier="T" title="T">${parts(rule)}<qti-test-part identifier="P2" navigation-mode="linear" submission-mode="individual">${section("S2", itemRef("I2"))}</qti-test-part></qti-assessment-test>`;
    const run = (rule: string): Issue[] =>
      branchTarget(
        validateTest(
          testOf(xml(rule)),
          "test.xml",
          resolversOf({ "I1.xml": itemFile("I1"), "I2.xml": itemFile("I2") }),
        ),
      );
    expect(run(branch("P2"))).toEqual([]);
    expect(run(branch("P1"))).toHaveLength(1);
    expect(run(branch("S2"))[0]?.message).toContain("must name another test part");
  });

  it("[B97] reports a branch rule to an item that selection with replacement can repeat", () => {
    const repeated = section(
      "R",
      `<qti-selection select="2" with-replacement="true"/>${itemRef("I2")}${itemRef("I3")}`,
    );
    const issues = only(
      validated({ sections: `${section("S", itemRef("I1", branch("I2")))}${repeated}` }),
      "olah/validate/branch-to-repeated",
    );
    expect(issues).toMatchObject([{ severity: "error", source: "INFO §5.98" }]);
    const plain = section("R", `<qti-selection select="2"/>${itemRef("I2")}${itemRef("I3")}`);
    expect(
      only(
        validated({ sections: `${section("S", itemRef("I1", branch("I2")))}${plain}` }),
        "olah/validate/branch-to-repeated",
      ),
    ).toEqual([]);
    const nested = section("R", `<qti-selection select="1" with-replacement="true"/>${section("In", itemRef("I2"))}`);
    expect(
      only(
        validated({ sections: `${section("S", itemRef("I1", branch("I2")))}${nested}` }),
        "olah/validate/branch-to-repeated",
      ),
    ).toHaveLength(1);
  });

  it("[B29] warns about the branch rules and pre-conditions of items in a part navigated in nonlinear mode", () => {
    const nonlinear = 'navigation-mode="nonlinear" submission-mode="individual"';
    const sections = section("S", `${itemRef("I1", branch("EXIT_TEST"))}${itemRef("I2")}`);
    expect(only(validated({ sections, partAttributes: nonlinear }), "olah/validate/ignored-rule")).toMatchObject([
      { severity: "warning", source: "INFO §2.8.3" },
    ]);
    expect(only(validated({ sections }), "olah/validate/ignored-rule")).toEqual([]);
    const condition = `<qti-pre-condition>${base("boolean", "true")}</qti-pre-condition>`;
    expect(
      only(
        validated({ sections: section("S", itemRef("I1", condition)), partAttributes: nonlinear }),
        "olah/validate/ignored-rule",
      ),
    ).toHaveLength(1);
  });

  it("[L7] warns about items, sections and parts that a branch rule that is always true jumps over", () => {
    const items = rules(section("S", `${itemRef("I1", branch("I3"))}${itemRef("I2")}${itemRef("I3")}`));
    expect(only(validated({ sections: items }), "olah/validate/unreachable")).toMatchObject([
      { severity: "warning", source: "INFO §2.8.3.2" },
    ]);
    const conditional = section(
      "S",
      `${itemRef("I1", branch("I3", isNull("I1.SCORE")))}${itemRef("I2")}${itemRef("I3")}`,
    );
    expect(only(validated({ declarations: testOutcomes, sections: conditional }), "olah/validate/unreachable")).toEqual(
      [],
    );
    const reachedElsewhere = section(
      "S",
      `${itemRef("I1", branch("I3"))}${itemRef("I2", branch("I3"))}${itemRef("I3")}`,
    );
    expect(only(validated({ sections: reachedElsewhere }), "olah/validate/unreachable")).toHaveLength(1);
    const exit = section("S", `${itemRef("I1", branch("EXIT_TESTPART"))}${itemRef("I2")}`);
    expect(only(validated({ sections: exit }), "olah/validate/unreachable")).toHaveLength(1);
    const section_ = rules(section("A", itemRef("I1", branch("EXIT_SECTION"))), section("B", itemRef("I2")));
    expect(only(validated({ sections: section_ }), "olah/validate/unreachable")).toEqual([]);
  });

  it("[L7] warns about a test part that a branch rule jumps over", () => {
    const xml = `<qti-assessment-test ${NS} identifier="T" title="T"><qti-test-part identifier="P1" navigation-mode="linear" submission-mode="individual">${branch("P3")}${section("S1", itemRef("I1"))}</qti-test-part><qti-test-part identifier="P2" navigation-mode="linear" submission-mode="individual">${section("S2", itemRef("I2"))}</qti-test-part><qti-test-part identifier="P3" navigation-mode="linear" submission-mode="individual">${section("S3", itemRef("I3"))}</qti-test-part></qti-assessment-test>`;
    const issues = validateTest(
      testOf(xml),
      "test.xml",
      resolversOf({ "I1.xml": itemFile("I1"), "I2.xml": itemFile("I2"), "I3.xml": itemFile("I3") }),
    );
    expect(only(issues, "olah/validate/unreachable")).toMatchObject([{ severity: "warning" }]);
    expect(only(issues, "olah/validate/unreachable")[0]?.message).toContain('"P2"');
  });

  it("checks that a pre-condition and a branch rule are single booleans", () => {
    const sections = section(
      "S",
      itemRef("I1", `<qti-pre-condition>${int("1")}</qti-pre-condition>${branch("EXIT_TEST", int("1"))}`),
    );
    expect(only(validated({ sections }), "olah/validate/condition-type")).toHaveLength(2);
  });
});

describe("validateTest: the covers of externally scored outcomes", () => {
  const declarations = `${outcome("CONTENT", "single", "float", ' external-scored="human"')}${outcome("PLAIN", "single", "float")}`;
  const entry = (itemRefId = "I1", responseId = "RESPONSE"): string =>
    `<li data-item-ref="${itemRefId}" data-response-identifier="${responseId}">Task</li>`;
  const block = (outcomeId: string | undefined, entries: string, attributes = 'view="scorer"'): string =>
    `<qti-rubric-block ${attributes} use="scoring" class="external-score-covers"${outcomeId === undefined ? "" : ` data-outcome-identifier="${outcomeId}"`}><qti-content-body><p>Rate once.</p><ul>${entries}</ul></qti-content-body></qti-rubric-block>`;
  const covers = (rubric: string): readonly Issue[] => validated({ declarations, rubric });
  const coversOnly = (issues: readonly Issue[], code: string): Issue[] => only(issues, `olah/covers/${code}`);

  it("accepts the block of the convention, with its covers listed once", () => {
    expect(covers(block("CONTENT", entry()))).toEqual([]);
    expect(
      covers(block("CONTENT", `${entry()}${entry("I2", "RESPONSE")}`)).filter(({ code }) =>
        code.startsWith("olah/covers"),
      ),
    ).toHaveLength(1);
  });

  it("[O6] reports a block for an outcome that the test does not declare", () => {
    const issues = coversOnly(covers(block("NOPE", entry())), "undeclared-outcome");
    expect(issues).toMatchObject([{ severity: "error", source: "olah convention §4.16" }]);
    expect(issues[0]?.message).toContain("NOPE");
  });

  it("[O7] reports a block for an outcome that is not external-scored", () => {
    expect(coversOnly(covers(block("PLAIN", entry())), "not-external")).toMatchObject([
      { severity: "error", source: "INFO §4.5.10" },
    ]);
  });

  it("[O8] reports a cover that names an item reference the test does not have", () => {
    const issues = coversOnly(covers(block("CONTENT", entry("W9"))), "unknown-item-ref");
    expect(issues).toMatchObject([{ severity: "error" }]);
    expect(issues[0]?.message).toContain("W9");
  });

  it("[O9] reports a cover that names a response the item does not declare", () => {
    const issues = coversOnly(covers(block("CONTENT", entry("I1", "NOPE"))), "unknown-response");
    expect(issues).toMatchObject([{ severity: "error" }]);
    expect(issues[0]?.message).toContain("NOPE");
  });

  it("[O10] reports the same cover twice in a block and two blocks for one outcome", () => {
    expect(coversOnly(covers(block("CONTENT", `${entry()}${entry()}`)), "duplicate")).toHaveLength(1);
    expect(coversOnly(covers(`${block("CONTENT", entry())}${block("CONTENT", entry())}`), "duplicate")).toHaveLength(1);
  });

  it("[O11] reports a block whose view lacks scorer or has candidate, a block without an outcome, and an entry without an attribute", () => {
    expect(coversOnly(covers(block("CONTENT", entry(), 'view="proctor"')), "malformed")).toHaveLength(1);
    expect(coversOnly(covers(block("CONTENT", entry(), 'view="scorer candidate"')), "malformed")).toHaveLength(1);
    expect(coversOnly(covers(block("CONTENT", entry(), 'view="candidate scorer"')), "malformed")).toHaveLength(1);
    expect(coversOnly(covers(block("CONTENT", entry(), 'view="proctor scorer"')), "malformed")).toEqual([]);
    expect(coversOnly(covers(block(undefined, entry())), "malformed")).toHaveLength(1);
    const lacking = `<li data-item-ref="I1">Task</li><li data-response-identifier="RESPONSE">Task</li>`;
    expect(coversOnly(covers(block("CONTENT", lacking)), "malformed")).toHaveLength(2);
  });

  it("[O11] warns about a block with the class token below the test, where it is not recognized", () => {
    const inSection = section(
      "S",
      itemRef("I1"),
      ' visible="true"',
      `<qti-rubric-block view="scorer" use="scoring" class="external-score-covers" data-outcome-identifier="CONTENT"><qti-content-body><p>x</p></qti-content-body></qti-rubric-block>`,
    );
    const issues = coversOnly(validated({ declarations, sections: inSection }), "malformed");
    expect(issues).toMatchObject([{ severity: "warning", source: "olah convention §4.16" }]);
    const inItem = check({
      body: '<qti-rubric-block view="scorer" use="scoring" class="external-score-covers"><qti-content-body><p>x</p></qti-content-body></qti-rubric-block>',
    });
    expect(coversOnly(inItem, "malformed")).toMatchObject([{ severity: "warning" }]);
    expect(coversOnly(covers(block("CONTENT", entry())), "malformed")).toEqual([]);
  });

  it("checks what the covers name only when the test can resolve its item references", () => {
    const xml = testXml({ declarations, rubric: block("CONTENT", entry("W9", "NOPE")) });
    expect(validateAsi(read(xml))).toEqual([]);
    expect(validateAsi(read(testXml({ declarations, rubric: block("NOPE", entry()) })))).toMatchObject([
      { code: "olah/covers/undeclared-outcome" },
    ]);
  });
});

// Packages ----------------------------------------------------------------------------------------------------------------

interface Entry {
  readonly identifier: string;
  readonly type: Manifest["resources"][number]["type"];
  /** The path of the main file, which is also listed as a file. */
  readonly href: string;
  /** More files of the resource. */
  readonly files?: readonly string[];
  readonly dependencies?: readonly string[];
}

/** Builds a package in memory from resources and the files they name; `unlisted` files are in the package only. */
function packageOf(entries: readonly Entry[], files: Files, unlisted: Files = {}): QtiPackage {
  const manifest: Manifest = {
    identifier: "m",
    metadata: { schema: "QTI Package" },
    resources: entries.map(({ identifier, type, href, files: more = [], dependencies = [] }) => ({
      identifier,
      type,
      href,
      files: [href, ...more].map((each) => ({ href: each })),
      dependencies,
      variants: [],
    })),
  };
  const encoder = new TextEncoder();
  const bytes = new Map(
    [...Object.entries(files), ...Object.entries(unlisted)].map(([path, text]) => [path, encoder.encode(text)]),
  );
  bytes.set("imsmanifest.xml", encoder.encode(writeManifest(manifest)));
  return openPackage({ paths: [...bytes.keys()], read: (path) => bytes.get(path) });
}

const ITEM_TYPE = "imsqti_item_xmlv3p0";
const TEST_TYPE = "imsqti_test_xmlv3p0";
const SIMPLE_ITEM = itemXml({ identifier: "Q1", declarations: single("string"), body: textEntry("") });

describe("validatePackage: the manifest and the files", () => {
  it("[K7] accepts a package whose files are all listed and present", () => {
    const pkg = packageOf([{ identifier: "q1", type: ITEM_TYPE, href: "q1.xml", files: ["media/a.png"] }], {
      "q1.xml": SIMPLE_ITEM,
      "media/a.png": "png",
    });
    expect(validatePackage(pkg)).toEqual([]);
  });

  it("[K7] reports a listed file that the package does not contain, and a file that the manifest does not list", () => {
    const pkg = packageOf(
      [{ identifier: "q1", type: ITEM_TYPE, href: "q1.xml", files: ["media/gone.png"] }],
      { "q1.xml": SIMPLE_ITEM },
      { "extra.txt": "x" },
    );
    const issues = validatePackage(pkg);
    expect(only(issues, "olah/validate/missing-file")).toMatchObject([
      { severity: "error", source: "BIND §8.1", location: { path: "imsmanifest.xml" } },
    ]);
    expect(only(issues, "olah/validate/missing-file")[0]?.message).toContain('"media/gone.png"');
    expect(only(issues, "olah/validate/unlisted-file")).toMatchObject([
      { severity: "error", source: "BIND §8.1, CAT §2.6" },
    ]);
    expect(only(issues, "olah/validate/unlisted-file")[0]?.message).toContain('"extra.txt"');
  });

  it("[K7] reports a listed file that is outside the package", () => {
    const manifest: Manifest = {
      identifier: "m",
      metadata: { schema: "QTI Package" },
      resources: [
        { identifier: "a", type: "webcontent", files: [{ href: "../outside.png" }], dependencies: [], variants: [] },
      ],
    };
    const bytes = new TextEncoder().encode(writeManifest(manifest));
    const pkg = openPackage({ paths: ["imsmanifest.xml"], read: () => bytes });
    expect(only(validatePackage(pkg), "olah/validate/outside-package")).toHaveLength(1);
  });

  it("[B89] reports a resource whose file holds another kind of document than its type says", () => {
    const section_ = `<qti-assessment-section ${NS} identifier="S" title="S" visible="true">${itemRef("Q1")}</qti-assessment-section>`;
    const pkg = packageOf([{ identifier: "q1", type: ITEM_TYPE, href: "s.xml" }], { "s.xml": section_ });
    expect(only(validatePackage(pkg), "olah/validate/resource-type")).toMatchObject([
      { severity: "error", source: "BIND §8.1" },
    ]);
    expect(only(validatePackage(pkg), "olah/validate/resource-type")[0]?.message).toContain("holds a section");
  });

  it("[B89] reports a document that cannot be read, in the findings of its file", () => {
    const pkg = packageOf([{ identifier: "q1", type: ITEM_TYPE, href: "q1.xml" }], {
      "q1.xml": "<qti-assessment-item",
    });
    const issues = validatePackage(pkg);
    expect(issues).toMatchObject([{ severity: "error", location: { path: "q1.xml" } }]);
  });

  it("[K6] reports an item whose identifier is not the identifier its LOM metadata gives", () => {
    const withLom = (identifier: string): QtiPackage => {
      const manifest = `<manifest xmlns="http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1" identifier="m"><metadata><schema>QTI Package</schema><schemaversion>3.0.0</schemaversion></metadata><organizations/><resources><resource identifier="q1" type="${ITEM_TYPE}" href="q1.xml"><metadata><lom:lom xmlns:lom="http://ltsc.ieee.org/xsd/LOM"><lom:general><lom:identifier><lom:entry>\n  ${identifier}\n</lom:entry></lom:identifier></lom:general></lom:lom></metadata><file href="q1.xml"/></resource></resources></manifest>`;
      const encoder = new TextEncoder();
      const files = new Map([
        ["imsmanifest.xml", encoder.encode(manifest)],
        ["q1.xml", encoder.encode(SIMPLE_ITEM)],
      ]);
      return openPackage({ paths: [...files.keys()], read: (path) => files.get(path) });
    };
    expect(validatePackage(withLom("Q1"))).toEqual([]);
    const issues = only(validatePackage(withLom("Other")), "olah/validate/metadata-identifier");
    expect(issues).toMatchObject([{ severity: "error", source: "INFO §4.1.1" }]);
  });

  it("[K29] reports a personal needs profile and a results report in a package, in any of the namespaces", () => {
    const pnp = (namespace: string): string => `<access-for-all-pnp xmlns="${namespace}"/>`;
    const report =
      '<assessmentResult xmlns="http://www.imsglobal.org/xsd/imsqti_result_v3p0"><context/></assessmentResult>';
    const entries: Entry[] = [
      { identifier: "q1", type: ITEM_TYPE, href: "q1.xml", files: ["a.xml", "b.xml", "c.xml", "d.xml"] },
    ];
    const files = {
      "q1.xml": SIMPLE_ITEM,
      "a.xml": pnp("http://www.imsglobal.org/xsd/qti/qtiv3p0/imsafa3p0pnp_v1p0"),
      "b.xml": pnp("http://www.imsglobal.org/xsd/qtiv3p0/imsafa3p0pnp_v1p0"),
      "c.xml": report,
      "d.xml": "<other/>",
    };
    const issues = validatePackage(packageOf(entries, files));
    expect(only(issues, "olah/validate/pnp-in-package")).toHaveLength(2);
    expect(only(issues, "olah/validate/results-in-package")).toMatchObject([{ severity: "error", source: "BIND §7" }]);
    expect(
      validatePackage(
        packageOf(
          entries.map((entry) => ({ ...entry, files: ["d.xml"] })),
          { "q1.xml": SIMPLE_ITEM, "d.xml": "<other/>" },
        ),
      ),
    ).toEqual([]);
  });

  it("does not report a file that is not well-formed, which is not a profile or a report", () => {
    const pkg = packageOf([{ identifier: "q1", type: ITEM_TYPE, href: "q1.xml", files: ["bad.xml"] }], {
      "q1.xml": SIMPLE_ITEM,
      "bad.xml": "<a",
    });
    expect(validatePackage(pkg)).toEqual([]);
  });
});

describe("validatePackage: the documents", () => {
  const TestXml = (children: string): string =>
    `<qti-assessment-test ${NS} identifier="T" title="T"><qti-test-part identifier="P" navigation-mode="linear" submission-mode="individual">${section("S", children)}</qti-test-part></qti-assessment-test>`;
  const entries: Entry[] = [
    { identifier: "test", type: TEST_TYPE, href: "test.xml", dependencies: ["q1"] },
    { identifier: "q1", type: ITEM_TYPE, href: "q1.xml" },
  ];

  it("checks each item and each test with the resolvers of the package, each document once", () => {
    const broken = itemXml({ identifier: "Q1", processing: rules(setOutcome("MISSING", int("1"))) });
    const pkg = packageOf(entries, { "test.xml": TestXml(itemRef("Q1", "", "q1.xml")), "q1.xml": broken });
    const issues = validatePackage(pkg);
    expect(only(issues, "olah/validate/undeclared-variable")).toMatchObject([{ location: { path: "q1.xml" } }]);
    expect(issues.filter(({ location }) => location?.path === "test.xml")).toEqual([]);
  });

  it("reports an item reference of a test that no resource of the manifest serves", () => {
    const pkg = packageOf([{ identifier: "test", type: TEST_TYPE, href: "test.xml" }], {
      "test.xml": TestXml(itemRef("Q1", "", "q1.xml")),
    });
    expect(validatePackage(pkg)).toMatchObject([{ code: "olah/package/unknown-resource" }]);
  });

  it("resolves a response processing template that the package holds, relative to the item", () => {
    const rpt = `<qti-response-processing ${NS}>${setOutcome("SCORE", flt("1"))}</qti-response-processing>`;
    const item = itemXml({
      identifier: "Q1",
      declarations: outcome("SCORE", "single", "float"),
      processing: '<qti-response-processing template="t/own.xml"/>',
    });
    const of = (templateXml: string): QtiPackage =>
      packageOf(
        [
          { identifier: "q1", type: ITEM_TYPE, href: "q1.xml", dependencies: ["rpt"] },
          { identifier: "rpt", type: "imsqti_rptemplate_xmlv3p0", href: "t/own.xml" },
        ],
        { "q1.xml": item, "t/own.xml": templateXml },
      );
    expect(validatePackage(of(rpt))).toEqual([]);
    expect(
      codesOf(validatePackage(packageOf([{ identifier: "q1", type: ITEM_TYPE, href: "q1.xml" }], { "q1.xml": item }))),
    ).toEqual(["olah/validate/unknown-template"]);
    const own = new Map([
      ["t/own.xml", itemOf(itemXml({ processing: rules(setOutcome("SCORE", flt("1"))) })).responseProcessing],
    ]);
    expect(validatePackage(of(rpt), { resolveTemplate: (uri) => own.get(uri) })).toEqual([]);
  });
});

describe("validatePackage: the files that documents name", () => {
  const Engine = '<qti-adaptive-engine-ref identifier="E" href="https://cat.example.org"/>';
  const adaptive = (refs: string): string =>
    `<qti-assessment-test ${NS} identifier="T" title="T"><qti-test-part identifier="P" navigation-mode="linear" submission-mode="individual">${section("A", `<qti-adaptive-selection>${Engine}${refs}</qti-adaptive-selection>${itemRef("Q1", "", "q1.xml")}`)}</qti-test-part></qti-assessment-test>`;
  const base_ = (files: readonly string[]): Entry[] => [
    { identifier: "test", type: TEST_TYPE, href: "test.xml", dependencies: ["q1"], files },
    { identifier: "q1", type: ITEM_TYPE, href: "q1.xml" },
  ];

  it("[B92] accepts the configuration files of an adaptive section that the package holds and lists", () => {
    const refs =
      '<qti-adaptive-settings-ref identifier="S1" href="settings.data"/><qti-usagedata-ref identifier="U" href="usage.xml"/><qti-metadata-ref identifier="M" href="metadata.json"/>';
    const files = {
      "test.xml": adaptive(refs),
      "q1.xml": SIMPLE_ITEM,
      "settings.data": "{}",
      "usage.xml": "<u/>",
      "metadata.json": "{}",
    };
    expect(validatePackage(packageOf(base_(["settings.data", "usage.xml", "metadata.json"]), files))).toEqual([]);
  });

  it("[B92] reports a configuration file that the package lacks or the manifest does not list, and ignores an address with a scheme", () => {
    const refs =
      '<qti-adaptive-settings-ref identifier="S1" href="settings.data"/><qti-usagedata-ref identifier="U" href="usage.xml"/><qti-metadata-ref identifier="M" href="https://example.org/metadata.json"/>';
    const files = { "test.xml": adaptive(refs), "q1.xml": SIMPLE_ITEM, "usage.xml": "<u/>" };
    const issues = validatePackage(packageOf(base_([]), files));
    expect(only(issues, "olah/validate/missing-file")).toMatchObject([
      { severity: "error", source: "CAT §2.6", location: { path: "test.xml" } },
    ]);
    expect(only(issues, "olah/validate/missing-file")[0]?.message).toContain("settings");
    expect(
      only(issues, "olah/validate/unlisted-file")
        .map(({ message }) => message)
        .join(),
    ).toContain("usage.xml");
    expect(issues.map(({ message }) => message).join()).not.toContain("metadata.json");
  });

  it("[B92] resolves the addresses of a section document against its path", () => {
    const section_ = `<qti-assessment-section ${NS} identifier="A" title="A" visible="true"><qti-adaptive-selection>${Engine}<qti-adaptive-settings-ref identifier="S1" href="cfg/settings.data"/></qti-adaptive-selection>${itemRef("Q1", "", "../q1.xml")}</qti-assessment-section>`;
    const pkg = packageOf(
      [
        {
          identifier: "sec",
          type: "imsqti_section_xmlv3p0",
          href: "sections/a.xml",
          files: ["sections/cfg/settings.data"],
        },
      ],
      { "sections/a.xml": section_, "sections/cfg/settings.data": "{}" },
    );
    expect(validatePackage(pkg)).toEqual([]);
  });

  const pci = (attributes: string, modules = ""): string =>
    itemXml({
      identifier: "P1",
      declarations: single("string"),
      body: `<qti-portable-custom-interaction response-identifier="R" custom-interaction-type-identifier="urn:fdc:example.org:pci" ${attributes}>${modules}<qti-interaction-markup><div/></qti-interaction-markup></qti-portable-custom-interaction>`,
    });
  const modules =
    '<qti-interaction-modules><qti-interaction-module id="tap" primary-path="modules/tap.js" fallback-path="https://cdn.example.org/tap"/></qti-interaction-modules>';

  it("[J9] accepts the module files of a portable custom interaction that the package holds and lists", () => {
    const pkg = packageOf([{ identifier: "p1", type: ITEM_TYPE, href: "p1.xml", files: ["modules/tap.js"] }], {
      "p1.xml": pci("", modules),
      "modules/tap.js": "js",
    });
    expect(validatePackage(pkg)).toEqual([]);
  });

  it("[J9] reports a module file that is missing or unlisted, reads the extension a path leaves out, and ignores a module the interaction does not name", () => {
    const unlisted = packageOf(
      [{ identifier: "p1", type: ITEM_TYPE, href: "p1.xml" }],
      { "p1.xml": pci("", modules) },
      { "modules/tap.js": "js" },
    );
    expect(
      only(validatePackage(unlisted), "olah/validate/unlisted-file")
        .map(({ message }) => message)
        .join(),
    ).toContain("modules/tap.js");
    const missing = packageOf([{ identifier: "p1", type: ITEM_TYPE, href: "p1.xml" }], { "p1.xml": pci("", modules) });
    expect(only(validatePackage(missing), "olah/validate/missing-file")).toMatchObject([
      { severity: "error", source: "BPIG §3.7.12.2", location: { path: "p1.xml" } },
    ]);
    const configuration = JSON.stringify({ paths: { tap: "modules/tap", other: "modules/other" } });
    const configured = packageOf(
      [
        {
          identifier: "p1",
          type: ITEM_TYPE,
          href: "p1.xml",
          files: ["modules/module_resolution.js", "modules/tap.js"],
        },
      ],
      { "p1.xml": pci('module="tap"'), "modules/module_resolution.js": configuration, "modules/tap.js": "js" },
    );
    expect(validatePackage(configured)).toEqual([]);
  });

  it("[J6][J7] reports a module that no configuration locates, a missing module, and a type identifier that is not a Federated Content URN", () => {
    const pkg = packageOf([{ identifier: "p1", type: ITEM_TYPE, href: "p1.xml" }], {
      "p1.xml": pci('module="nowhere"').replace("urn:fdc:example.org:pci", "my-pci"),
    });
    expect(codesOf(validatePackage(pkg)).sort()).toEqual([
      "olah/pci/module-not-configured",
      "olah/pci/type-identifier",
    ]);
    const none = itemXml({
      identifier: "P1",
      declarations: single("string"),
      body: '<qti-portable-custom-interaction response-identifier="R" custom-interaction-type-identifier="urn:fdc:x"><qti-interaction-markup><div/></qti-interaction-markup></qti-portable-custom-interaction>',
    });
    expect(
      codesOf(validatePackage(packageOf([{ identifier: "p1", type: ITEM_TYPE, href: "p1.xml" }], { "p1.xml": none }))),
    ).toContain("olah/pci/no-module");
  });

  it("[J9] reports a module resolution file that is not valid", () => {
    const pkg = packageOf(
      [{ identifier: "p1", type: ITEM_TYPE, href: "p1.xml", files: ["modules/module_resolution.js"] }],
      { "p1.xml": pci('module="tap"'), "modules/module_resolution.js": "not json" },
    );
    expect(only(validatePackage(pkg), "olah/validate/module-resolution")).toMatchObject([
      { severity: "error", source: "BPIG §3.7.12.2" },
    ]);
  });
});

// Results and personal needs profiles -------------------------------------------------------------------------------------

function itemResult(
  identifier: string,
  sequenceIndex: number | undefined,
  variables: AssessmentResult["itemResults"][number]["variables"] = [],
): AssessmentResult["itemResults"][number] {
  return {
    identifier,
    ...(sequenceIndex === undefined ? {} : { sequenceIndex }),
    datestamp: "2026-10-30T10:00:00",
    sessionStatus: "final",
    variables,
    supports: [],
  };
}

const scoreOutcome = (
  baseType: "float" | "integer",
  extra: object = {},
): AssessmentResult["itemResults"][number]["variables"][number] => ({
  kind: "outcome",
  identifier: "SCORE",
  cardinality: "single",
  baseType,
  value:
    baseType === "float"
      ? { cardinality: "single", baseType: "float", value: 1 }
      : { cardinality: "single", baseType: "integer", value: 1 },
  ...extra,
});

const report = (
  itemResults: AssessmentResult["itemResults"],
  testResult?: Partial<NonNullable<AssessmentResult["testResult"]>>,
): AssessmentResult => ({
  context: { sessionIdentifiers: [] },
  ...(testResult === undefined
    ? {}
    : {
        testResult: { identifier: "T", datestamp: "2026-10-30T10:00:00", variables: [], supports: [], ...testResult },
      }),
  itemResults,
});

describe("validateResults", () => {
  it("[RR §2.4.5] accepts a report whose item results each have a sequenceIndex of their own", () => {
    expect(validateResults(report([itemResult("A", 1, [scoreOutcome("float")]), itemResult("B", 2)], {}))).toEqual([]);
    expect(validateResults(report([itemResult("A", undefined)]))).toEqual([]);
  });

  it("[RR §2.4.5] reports an item result of a test result that has no sequenceIndex or shares one", () => {
    const missing = validateResults(report([itemResult("A", undefined)], {}));
    expect(missing).toMatchObject([{ code: "olah/validate/sequence-index", severity: "error", source: "RR §2.4.5" }]);
    const shared = validateResults(report([itemResult("A", 1), itemResult("B", 1)], {}));
    expect(shared).toMatchObject([{ code: "olah/validate/sequence-index", severity: "error" }]);
    expect(shared[0]?.message).toContain('"B"');
    // The attempts at one item instance are item results that share its position.
    expect(validateResults(report([itemResult("A", 1), itemResult("A", 1)], {}))).toEqual([]);
  });

  it("[RR §2.4.5] reports a variable reported twice in one result", () => {
    const twice = validateResults(report([itemResult("A", 1, [scoreOutcome("float"), scoreOutcome("float")])]));
    expect(twice).toMatchObject([
      { code: "olah/validate/duplicate-identifier", severity: "error", source: "RR §2.4.5" },
    ]);
  });

  it("[T23][G40] warns when SCORE is not a float in a report, as in an item", () => {
    expect(validateResults(report([itemResult("A", 1, [scoreOutcome("integer")])]))).toMatchObject([
      { code: "olah/validate/standard-outcome", severity: "warning", source: "INFO §2.2.2.3, BPIG §3.5" },
    ]);
  });

  it("[RR §2.4.7] reports a normal-maximum that is not positive", () => {
    expect(validateResults(report([itemResult("A", 1, [scoreOutcome("float", { normalMaximum: 0 })])]))).toMatchObject([
      { code: "olah/validate/normal-maximum", severity: "error", source: "RR §2.4.7" },
    ]);
    expect(validateResults(report([itemResult("A", 1, [scoreOutcome("float", { normalMaximum: 10 })])]))).toEqual([]);
  });

  it("[RR §2.6.4] reports a value for a support that was prohibited, in an item result and in a test result", () => {
    const support = (assignment: "assigned" | "prohibited", value?: string) => ({
      name: "spoken",
      assignment,
      ...(value === undefined ? {} : { value }),
    });
    const item = {
      ...itemResult("A", 1),
      supports: [support("prohibited", "on"), support("prohibited"), support("assigned", "on")],
    };
    const issues = validateResults(report([item], { supports: [support("prohibited", "on")] }));
    expect(issues).toMatchObject([
      { code: "olah/validate/support-value", location: { element: "assessmentResult/testResult/support" } },
      { code: "olah/validate/support-value", location: { element: "assessmentResult/itemResult/support" } },
    ]);
  });

  it("throws a DataError for a result that is not an object of the model", () => {
    for (const bad of [
      null,
      "x",
      {},
      { itemResults: "x" },
      { itemResults: [null] },
      { itemResults: [{ variables: [], supports: "x" }] },
    ]) {
      expect(() => validateResults(json<AssessmentResult>(JSON.stringify(bad)))).toThrow(DataError);
    }
  });
});

describe("validatePnp and validatePnpNamespace", () => {
  const PnpNs = "http://www.imsglobal.org/xsd/qti/qtiv3p0/imsafa3p0pnp_v1p0";
  const profile = (inner: string, namespace = PnpNs): PersonalNeedsProfile => {
    const read = readPnp(`<access-for-all-pnp xmlns="${namespace}">${inner}</access-for-all-pnp>`);
    if (Array.isArray(read)) throw new Error("The test reads one profile.");
    return read as PersonalNeedsProfile;
  };

  it("[BPIG §5.3.3] accepts a prohibited support that is listed only in the prohibit set", () => {
    expect(
      validatePnp(
        profile(
          "<prohibit-set><magnification/></prohibit-set><additional-testing-time><unlimited/></additional-testing-time>",
        ),
      ),
    ).toEqual([]);
  });

  it("[BPIG §5.3.3] reports a prohibited support that an activate set lists, and warns about one that the profile also assigns", () => {
    const listed = validatePnp(
      profile(
        "<prohibit-set><magnification/></prohibit-set><activate-as-option-set><magnification/></activate-as-option-set>",
      ),
    );
    expect(listed).toMatchObject([{ code: "olah/validate/pnp-prohibited", severity: "error", source: "BPIG §5.3.3" }]);
    const assigned = validatePnp(
      profile(
        "<additional-testing-time><unlimited/></additional-testing-time><prohibit-set><additional-testing-time/></prohibit-set>",
      ),
    );
    expect(assigned).toMatchObject([
      { code: "olah/validate/pnp-prohibited", severity: "warning", source: "BPIG §5.3.3" },
    ]);
  });

  it("[BPIG §5.3] warns about a support that is both an option and active from the start", () => {
    const both = validatePnp(
      profile(
        "<activate-as-option-set><spoken/></activate-as-option-set><activate-at-initialization-set><spoken/></activate-at-initialization-set>",
      ),
    );
    expect(both).toMatchObject([{ code: "olah/validate/pnp-sets", severity: "warning", source: "BPIG §5.3" }]);
  });

  it("[L15] reports the two namespaces that 1EdTech's own documents use, reads them and writes the namespace of the schema", () => {
    const alternates = [
      "http://www.imsglobal.org/xsd/qtiv3p0/imsafa3p0pnp_v1p0",
      "http://www.imsglobal.org/xsd/qt/qtiv3p0/imsafa3p0pnp_v1p0",
    ];
    for (const namespace of alternates) {
      const xml = `<access-for-all-pnp xmlns="${namespace}"><spoken/><prohibit-set><magnification/></prohibit-set></access-for-all-pnp>`;
      const issues = validatePnpNamespace(parseXml(xml));
      expect(issues).toMatchObject([
        {
          code: "olah/validate/pnp-namespace",
          severity: "error",
          source: "BPIG §5, BIND §7",
          location: { element: "access-for-all-pnp" },
        },
      ]);
      expect(issues[0]?.message).toContain(namespace);
      expect(validatePnp(profile("<spoken/>", namespace))).toEqual([]);
    }
    expect(
      validatePnpNamespace(parseXml(`<access-for-all-pnp xmlns="${PnpNs}"><spoken/></access-for-all-pnp>`)),
    ).toEqual([]);
  });

  it("[L15] reports an alternate namespace once for each part of a document that uses it, not for each element", () => {
    const xml = `<access-for-all-pnp-records xmlns="${PnpNs}"><access-for-all-pnp-record><person-sourced-id source-system="s">1</person-sourced-id><access-for-all-pnp xmlns="http://www.imsglobal.org/xsd/qtiv3p0/imsafa3p0pnp_v1p0"><spoken/></access-for-all-pnp></access-for-all-pnp-record></access-for-all-pnp-records>`;
    const issues = validatePnpNamespace(parseXml(xml));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.location?.element).toBe(
      "access-for-all-pnp-records/access-for-all-pnp-record/access-for-all-pnp",
    );
  });

  it("throws a DataError for a profile and a root that are not objects", () => {
    for (const bad of [null, "x", 1]) {
      expect(() => validatePnp(json<PersonalNeedsProfile>(JSON.stringify(bad)))).toThrow(DataError);
      expect(() => validatePnpNamespace(json(JSON.stringify(bad)))).toThrow(DataError);
    }
  });
});

// Entry points ----------------------------------------------------------------------------------------------------------

describe("the entry points", () => {
  const document = (): AsiDocument => read(itemXml());

  it("[L12] throw a DataError for an option or an argument of the wrong type, as JavaScript and JSON pass them", () => {
    expect(() => validateAsi(document(), json("null"))).toThrow(DataError);
    expect(() => validateAsi(document(), json('{"path":1}'))).toThrow("The option path must be a string, found 1.");
    expect(() => validateAsi(document(), json('{"customOperators":{}}'))).toThrow(
      "The option customOperators must be a Map",
    );
    expect(() => validateAsi(document(), json('{"resolveTemplate":1}'))).toThrow(
      "The option resolveTemplate must be a function",
    );
    expect(() => validateAsi(json<AsiDocument>("null"))).toThrow(DataError);
    expect(() => validateAsi(json<AsiDocument>('{"kind":"other"}'))).toThrow(
      'The kind of a document must be one of "item"',
    );
    expect(() =>
      validateAsi(json<AsiDocument>('{"kind":"item","item":{"kind":"assessment-item","responseDeclarations":"x"}}')),
    ).toThrow(DataError);
  });

  it("[L12] check the shape of a model deeply before they read it", () => {
    const item = itemOf(itemXml());
    const withBody = (children: unknown): AsiDocument =>
      json<AsiDocument>(JSON.stringify({ kind: "item", item: { ...item, body: { ...item.body, children } } }));
    expect(() => validateAsi(withBody("x"))).toThrow("The property children of qti-item-body must be an array");
    expect(() => validateAsi(withBody([1]))).toThrow("A member of children of qti-item-body must be an object");
    expect(() => validateAsi(withBody([{ kind: "nope" }]))).toThrow(
      'has the kind "nope", which the property does not accept',
    );
  });

  it("[L12] check the arguments of validateTest and validatePackage", () => {
    const test = testOf(testXml());
    const resolvers = resolversOf({});
    expect(() => validateTest(json<AssessmentTest>("null"), "t.xml", resolvers)).toThrow(DataError);
    expect(() => validateTest(json<AssessmentTest>('{"kind":"assessment-item"}'), "t.xml", resolvers)).toThrow(
      'found the kind "assessment-item"',
    );
    expect(() => validateTest(test, json<string>("1"), resolvers)).toThrow("The base must be a string");
    expect(() => validateTest(test, "t.xml", json<Resolvers>("null"))).toThrow(DataError);
    expect(() => validateTest(test, "t.xml", json<Resolvers>('{"items":1}'))).toThrow(
      "The resolvers must have a function items",
    );
    expect(() => validateTest(test, "t.xml", resolvers, json("1"))).toThrow(DataError);
    expect(() => validatePackage(json<QtiPackage>("null"))).toThrow(DataError);
  });

  it("[L12] report an error of a resolver that is not one of olah's, because it is a defect and not a finding", () => {
    const crashing: Resolvers = {
      ...resolversOf({}),
      items: () => {
        throw new TypeError("a defect");
      },
    };
    expect(() => validateTest(testOf(testXml()), "t.xml", crashing)).toThrow(TypeError);
  });

  it("[L12] report a resolver's error of olah as an issue of the reference", () => {
    const refusing: Resolvers = {
      ...resolversOf({}),
      items: () => {
        throw new DataError("The resolver cannot read this.");
      },
    };
    expect(validateTest(testOf(testXml()), "t.xml", refusing)).toMatchObject([
      {
        code: "olah/validate/unresolved-reference",
        severity: "error",
        message: "The resolver cannot read this.",
        location: { path: "t.xml" },
      },
    ]);
  });

  it("[L12] name the file in the location of an issue, and the element path of the offending element", () => {
    const issues = check({ body: '<h1 role="button">a</h1>' }, { path: "items/a.xml" });
    expect(issues[0]?.location).toEqual({ path: "items/a.xml", element: "qti-assessment-item/qti-item-body/h1" });
    expect(check({ body: '<h1 role="button">a</h1>' })[0]?.location).toEqual({
      element: "qti-assessment-item/qti-item-body/h1",
    });
  });
});

// Properties ------------------------------------------------------------------------------------------------------------

/** The text of one value of each base type, which a default value can give a variable. */
const SAMPLES: Readonly<Record<BaseType, string>> = {
  boolean: "true",
  directedPair: "a b",
  duration: "1",
  file: "f.bin",
  float: "1.5",
  identifier: "a",
  integer: "1",
  pair: "a b",
  point: "1 2",
  string: "a",
  uri: "http://example.org/a",
};

/** A variable's type, as the properties generate it: a record has no base type. */
type Shape =
  | { readonly cardinality: "single" | "multiple" | "ordered"; readonly baseType: BaseType }
  | { readonly cardinality: "record" };

const shapes: fc.Arbitrary<Shape> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.record({
      cardinality: fc.constantFrom("single" as const, "multiple" as const, "ordered" as const),
      baseType: fc.constantFrom(...BASE_TYPES),
    }),
  },
  { weight: 1, arbitrary: fc.constant<Shape>({ cardinality: "record" }) },
);

/** The declaration of an outcome of a shape whose default value is a value of it. */
function declared(identifier: string, shape: Shape): string {
  if (shape.cardinality === "record") {
    return outcome(
      identifier,
      "record",
      "",
      "",
      '<qti-default-value><qti-value field-identifier="f" base-type="string">a</qti-value></qti-default-value>',
    ).replace(' base-type=""', "");
  }
  const text = `<qti-value>${SAMPLES[shape.baseType]}</qti-value>`;
  const values = shape.cardinality === "single" ? text : text.repeat(2);
  return outcome(identifier, shape.cardinality, shape.baseType, "", `<qti-default-value>${values}</qti-default-value>`);
}

describe("properties", () => {
  const Kinds = [...OPERATOR_SIGNATURES].filter(([, signature]) => signature.maxOperands > 0).map(([kind]) => kind);

  /** An item with a variable V0, V1, … of each shape and an outcome OUT that the rule assigns `expression` to. */
  function itemWith(shapesOf: readonly Shape[], expression: Expression): AssessmentItem {
    const declarations = `${shapesOf.map((shape, index) => declared(`V${index}`, shape)).join("")}${outcome("OUT", "single", "boolean")}`;
    const item = itemOf(itemXml({ declarations, processing: rules(setOutcome("OUT", "<qti-null/>")) }));
    const [rule] = item.responseProcessing?.rules ?? [];
    if (rule?.kind !== "set-outcome-value") throw new Error("The test builds a rule.");
    return { ...item, responseProcessing: { kind: "response-processing", rules: [{ ...rule, expression }] } };
  }

  it("[L3][P] reports an operand mismatch exactly when evaluating the operands would fail on the signature of the operator", () => {
    fc.assert(
      fc.property(fc.constantFrom(...Kinds), fc.array(shapes, { maxLength: 4 }), (kind, operandShapes) => {
        const operands: Expression[] = operandShapes.map((_, index) => ({ kind: "variable", identifier: `V${index}` }));
        // The pattern is the one attribute that a static check reads of an expression besides its operands.
        const expression = json<Expression>(
          JSON.stringify({ kind, operands, pattern: "a", extensions: [], extensionElements: [] }),
        );
        const item = itemWith(operandShapes, expression);
        const statically = validateAsi({ kind: "item", item }).some(
          ({ code }) => code === "olah/validate/operand-type" || code === "olah/validate/operand-count",
        );
        let dynamically = false;
        try {
          evaluate(expression, createItemVariables(item), item, { random: createRandom(1) });
        } catch (error) {
          dynamically = error instanceof ProcessingError && /^The operator qti-[a-z-]+ takes /.test(error.message);
        }
        expect(statically, `${kind} of ${JSON.stringify(operandShapes)}`).toBe(dynamically);
      }),
      FUZZ,
    );
  });

  /** A linear section of `count` items I1, I2, … where item `from` has a conditional branch rule to item `to` for each pair. */
  function branching(count: number, jumps: readonly (readonly [from: number, to: number])[]): readonly Issue[] {
    const names = Array.from({ length: count }, (_, index) => `I${index + 1}`);
    const condition = `<qti-is-null>${variable("I1.SCORE")}</qti-is-null>`;
    const refs = names.map((name, index) => {
      const rules = jumps.filter(([from]) => from === index).map(([, to]) => branch(`I${to + 1}`, condition));
      return itemRef(name, rules.join(""));
    });
    const files = Object.fromEntries(names.map((name) => [`${name}.xml`, name === "I1" ? SCORED : itemFile(name)]));
    const xml = testXml({ declarations: testOutcomes, sections: section("S", refs.join("")) });
    return validateTest(testOf(xml), "test.xml", resolversOf(files));
  }

  const layouts = fc.integer({ min: 2, max: 7 }).chain((count) =>
    fc.tuple(
      fc.constant(count),
      fc.array(fc.tuple(fc.integer({ min: 0, max: count - 1 }), fc.integer({ min: 0, max: count - 1 })), {
        maxLength: 6,
      }),
    ),
  );

  it("[L7][P] accepts branch rules that jump forward, whichever items they connect, and warns about no item", () => {
    fc.assert(
      fc.property(layouts, ([count, pairs]) => {
        const forward = pairs.filter(([from, to]) => to > from);
        expect(branching(count, forward)).toEqual([]);
      }),
      FUZZ,
    );
  });

  it("[L7][P] reports each branch rule that does not jump forward, and no other", () => {
    fc.assert(
      fc.property(layouts, ([count, pairs]) => {
        const expected = pairs.filter(([from, to]) => to <= from).length;
        const reported = only(branching(count, pairs), "olah/validate/branch-target").length;
        expect(reported).toBe(expected);
      }),
      FUZZ,
    );
  });
});
