import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  ASI_NAMESPACE,
  type AssessmentSection,
  type AssessmentTest,
  additionalTestingTime,
  ancestry,
  createRandom,
  DataError,
  DEFAULT_PLAN_LIMITS,
  type ItemKey,
  nextItem,
  type PersonalNeedsProfile,
  type PlannedChild,
  PNP_NAMESPACE,
  ProcessingError,
  partOf,
  planItems,
  planTest,
  previousItem,
  type Random,
  type RuleContext,
  readAsi,
  readPnp,
  resolveStructure,
  restoreRandom,
  SecurityError,
  type SingleValue,
  sessionControl,
  single,
  type TestingTime,
  type TestPlan,
  type TestScope,
  type TestStructure,
  timeLimits,
  type Value,
} from "../src/index.js";

/** Parses JSON text, which is how plain JavaScript passes a value of the wrong type. */
function json<T = never>(text: string): T {
  return JSON.parse(text);
}

function fail(message: string): never {
  throw new Error(message);
}

/** The item references of the identifiers, in the order given. */
const refs = (...identifiers: string[]): string =>
  identifiers.map((id) => `<qti-assessment-item-ref identifier="${id}" href="${id}.xml"/>`).join("");

/** An item reference whose content, such as pre-conditions, is given. */
const itemRef = (id: string, content = "", attributes = ""): string =>
  `<qti-assessment-item-ref identifier="${id}" href="${id}.xml"${attributes}>${content}</qti-assessment-item-ref>`;

/** A section; its content follows the order of the schema: rules, limits, selection, ordering, then children. */
const section = (id: string, content: string, attributes = 'visible="true"'): string =>
  `<qti-assessment-section identifier="${id}" title="${id}" ${attributes}>${content}</qti-assessment-section>`;

/** A test part; `head` holds its pre-conditions, branch rules, item session control and time limits. */
const part = (id: string, sections: string, mode: "linear" | "nonlinear" = "nonlinear", head = ""): string =>
  `<qti-test-part identifier="${id}" navigation-mode="${mode}" submission-mode="individual">${head}${sections}</qti-test-part>`;

/** The outcomes that the expressions below read. */
const OUTCOMES = `<qti-outcome-declaration identifier="ANSWER" cardinality="single" base-type="identifier"/>
  <qti-outcome-declaration identifier="GO" cardinality="single" base-type="boolean"/>`;

const GO = '<qti-variable identifier="GO"/>';
const NOT_GO = `<qti-not>${GO}</qti-not>`;
const answered = (value: string): string =>
  `<qti-match><qti-variable identifier="ANSWER"/><qti-base-value base-type="identifier">${value}</qti-base-value></qti-match>`;
const pre = (expression: string): string => `<qti-pre-condition>${expression}</qti-pre-condition>`;
const branch = (target: string, expression: string): string =>
  `<qti-branch-rule target="${target}">${expression}</qti-branch-rule>`;
const limits = (attributes: string): string => `<qti-time-limits ${attributes}/>`;

function testOf(content: string): AssessmentTest {
  const document = readAsi(
    `<qti-assessment-test xmlns="${ASI_NAMESPACE}" identifier="T" title="T">${OUTCOMES}${content}</qti-assessment-test>`,
  );
  return document.kind === "test" ? document.test : fail(`Expected a test, found ${document.kind}.`);
}

function sectionOf(xml: string): AssessmentSection {
  const document = readAsi(
    xml.replace("<qti-assessment-section ", `<qti-assessment-section xmlns="${ASI_NAMESPACE}" `),
  );
  return document.kind === "section" ? document.section : fail(`Expected a section, found ${document.kind}.`);
}

const NO_SECTIONS = { sections: (): never => fail("The test has no section reference.") };

/** The structure of a test; its section references name the documents given, by href. */
function structureOf(
  content: string,
  documents: Readonly<Record<string, string>> = {},
  base = "test.xml",
  calls: [string, string][] = [],
): TestStructure {
  const sections = new Map(Object.entries(documents).map(([href, xml]) => [href, sectionOf(xml)]));
  return resolveStructure(testOf(content), base, {
    sections: (href, from) => {
      calls.push([href, from]);
      return sections.get(href) ?? fail(`The test has no document ${href}.`);
    },
  });
}

const nonlinear = (...sections: string[]): TestStructure => structureOf(part("P", sections.join("")));
const linear = (...sections: string[]): TestStructure => structureOf(part("P", sections.join(""), "linear"));

/** A source of random numbers that returns the numbers given and fails when it runs out. */
function scripted(...draws: number[]): Random & { left(): number } {
  const queue = [...draws];
  return {
    uniform: () => queue.shift() ?? fail("The test drew more numbers than it scripted."),
    left: () => queue.length,
  };
}

const plan = (structure: TestStructure, seed = 1): TestPlan => planTest(structure, { random: createRandom(seed) });
const planWith = (structure: TestStructure, random: Random): TestPlan => planTest(structure, { random });

const shown = (key: ItemKey): string => (key.instance > 1 ? `${key.ref}#${key.instance}` : key.ref);

/** The item instances of a plan, such as `["a", "b#2"]`. */
const itemsOf = (testPlan: TestPlan, partIdentifier?: string): string[] =>
  planItems(testPlan, partIdentifier).map(shown);

function outline(children: readonly PlannedChild[]): string {
  return children
    .map((child) =>
      child.kind === "item"
        ? shown(child.key)
        : `${child.instance > 1 ? `${child.identifier}#${child.instance}` : child.identifier}[${outline(child.children)}]`,
    )
    .join(" ");
}

/** A plan as text: the parts in braces with their sections, such as `P{S[a b] U[c]}`. */
const outlineOf = (testPlan: TestPlan): string =>
  testPlan.parts.map((entry) => `${entry.identifier}{${outline(entry.children)}}`).join(" ");

const bool = (value: boolean): SingleValue => single("boolean", value);
const identifier = (value: string): SingleValue => single("identifier", value);

const NO_SESSIONS: TestScope = { itemSessions: () => [], itemSession: () => undefined, variable: () => undefined };

/** What pre-conditions and branch rules read: the outcomes given, and no item sessions. */
function rules(outcomes: Readonly<Record<string, Value | null>> = {}): RuleContext {
  return { outcomes: new Map(Object.entries(outcomes)), scope: NO_SESSIONS, context: { random: createRandom(1) } };
}

/** The item instances that the candidate meets: `nextItem` from the start until it gives none. */
function walk(structure: TestStructure, testPlan: TestPlan, context: RuleContext = rules()): string[] {
  const met: string[] = [];
  let at = nextItem(structure, testPlan, undefined, context);
  while (at !== undefined) {
    met.push(shown(at));
    if (met.length > 1000) return fail("The walk does not end.");
    at = nextItem(structure, testPlan, at, context);
  }
  return met;
}

const GO_TRUE = rules({ GO: bool(true) });
const GO_FALSE = rules({ GO: bool(false) });

/** The chi-square statistic of observed counts against equal expected counts. */
function chiSquare(counts: readonly number[]): number {
  const expected = counts.reduce((sum, count) => sum + count, 0) / counts.length;
  return counts.reduce((sum, observed) => sum + (observed - expected) ** 2 / expected, 0);
}

/** The chi-square values that a uniform draw exceeds with probability 0.001, by degrees of freedom (standard tables). */
const CHI_SQUARE_CRITICAL = { 2: 13.816, 3: 16.266, 5: 20.515, 11: 31.264 } as const;

/** Counts how often each outcome occurs over the seeds 1 to `seeds`. */
function tally(seeds: number, outcome: (seed: number) => string, categories: readonly string[]): number[] {
  const counts = new Map(categories.map((category) => [category, 0]));
  for (let seed = 1; seed <= seeds; seed++) {
    const category = outcome(seed);
    counts.set(category, (counts.get(category) ?? fail(`Unexpected outcome ${category}.`)) + 1);
  }
  return [...counts.values()];
}

describe("nextItem", () => {
  it("[B26] gives the next item of the plan in a nonlinear part, ignoring pre-conditions and branch rules", () => {
    const structure = nonlinear(section("S", itemRef("a", branch("c", GO)) + itemRef("b", pre(NOT_GO)) + itemRef("c")));
    expect(walk(structure, plan(structure), GO_TRUE)).toEqual(["a", "b", "c"]);
  });

  it("[B26] goes on in the next part after the last item of a part, and ends after the last part", () => {
    const structure = structureOf(
      part("P1", section("S1", refs("a", "b"))) + part("P2", section("S2", refs("c")), "linear"),
    );
    expect(walk(structure, plan(structure))).toEqual(["a", "b", "c"]);
  });

  it("[B26] ends the test when the plan has no item", () => {
    const structure = nonlinear(section("S", ""));
    expect(nextItem(structure, plan(structure), undefined, rules())).toBeUndefined();
  });

  it("[B28] skips an item whose pre-condition is false, and presents one whose is true (RTEST-13)", () => {
    // INFO §2.8.3: item160 follows a response Y to item034 and item063 a response N.
    const structure = linear(
      section(
        "A",
        itemRef("item034") + itemRef("item160", pre(answered("Y"))) + itemRef("item063", pre(answered("N"))),
      ),
    );
    expect(walk(structure, plan(structure), rules({ ANSWER: identifier("Y") }))).toEqual(["item034", "item160"]);
    expect(walk(structure, plan(structure), rules({ ANSWER: identifier("N") }))).toEqual(["item034", "item063"]);
  });

  it("[B28] skips an item whose pre-condition is NULL, as it is when no response was given", () => {
    const structure = linear(section("A", itemRef("first") + itemRef("second", pre(answered("Y")))));
    expect(walk(structure, plan(structure))).toEqual(["first"]);
  });

  it("[B28] evaluates the pre-conditions of a node in order and stops at the first that is false", () => {
    const undeclared = '<qti-variable identifier="NOT_DECLARED"/>';
    const structure = linear(section("A", itemRef("first") + itemRef("second", pre(NOT_GO) + pre(undeclared))));
    expect(walk(structure, plan(structure), GO_TRUE)).toEqual(["first"]);
    expect(() => walk(structure, plan(structure), GO_FALSE)).toThrow(ProcessingError);
  });

  it("[B28] skips a section and a test part with everything in them when their pre-condition is false", () => {
    // RTEST-COMPLETE: the section SA has a pre-condition.
    const structure = structureOf(
      part(
        "P1",
        section("A", itemRef("a1")) +
          section("B", pre(NOT_GO) + itemRef("b1") + itemRef("b2")) +
          section("C", itemRef("c1")),
        "linear",
      ) +
        part("P2", section("D", itemRef("d1")), "linear", pre(NOT_GO)) +
        part("P3", section("E", itemRef("e1")), "linear"),
    );
    expect(walk(structure, plan(structure), GO_TRUE)).toEqual(["a1", "c1", "e1"]);
    expect(walk(structure, plan(structure), GO_FALSE)).toEqual(["a1", "b1", "b2", "c1", "d1", "e1"]);
  });

  it("[B28] passes over a node that has no item to present, also at the start of the test", () => {
    const structure = structureOf(
      part("P1", section("A", itemRef("a", pre(NOT_GO))), "linear") + part("P2", section("B", itemRef("b")), "linear"),
    );
    const testPlan = plan(structure);
    expect(nextItem(structure, testPlan, undefined, GO_TRUE)).toEqual({ ref: "b", instance: 1 });
  });

  it("[B28] ignores the pre-conditions of a nonlinear part and of what it holds", () => {
    const structure = structureOf(part("P", section("S", itemRef("a", pre(NOT_GO))), "nonlinear", pre(NOT_GO)));
    expect(walk(structure, plan(structure), GO_TRUE)).toEqual(["a"]);
  });

  it("[B29] jumps over items to the target of the first branch rule that is true (RTEST-13)", () => {
    // INFO §2.8.3.2: item347 skips item653 for the response N, and exits the section unless the response is Y.
    const rulesOfFirst =
      branch("item656", answered("N")) + branch("EXIT_SECTION", `<qti-not>${answered("Y")}</qti-not>`);
    const structure = linear(
      section("B", itemRef("item347", rulesOfFirst) + itemRef("item653") + itemRef("item656")),
      section("C", itemRef("last")),
    );
    const testPlan = plan(structure);
    expect(walk(structure, testPlan, rules({ ANSWER: identifier("N") }))).toEqual(["item347", "item656", "last"]);
    expect(walk(structure, testPlan, rules({ ANSWER: identifier("Y") }))).toEqual([
      "item347",
      "item653",
      "item656",
      "last",
    ]);
    expect(walk(structure, testPlan, rules({ ANSWER: identifier("X") }))).toEqual(["item347", "last"]);
  });

  it("[B29] lets the first true branch rule decide, and treats a NULL one as false", () => {
    const structure = linear(
      section("S", itemRef("a", branch("c", answered("Y")) + branch("d", answered("Y"))) + refs("b", "c", "d")),
    );
    expect(walk(structure, plan(structure), rules({ ANSWER: identifier("Y") }))).toEqual(["a", "c", "d"]);
    expect(walk(structure, plan(structure))).toEqual(["a", "b", "c", "d"]);
  });

  it("[B29] evaluates the branch rules of a section and of a test part when they are completed", () => {
    const sections = structureOf(
      part(
        "P",
        section("S1", branch("S3", GO) + itemRef("a")) + section("S2", itemRef("b")) + section("S3", itemRef("c")),
        "linear",
      ),
    );
    expect(walk(sections, plan(sections), GO_TRUE)).toEqual(["a", "c"]);
    expect(walk(sections, plan(sections), GO_FALSE)).toEqual(["a", "b", "c"]);
    const parts = structureOf(
      part("P1", section("S1", itemRef("a")), "linear", branch("P3", GO)) +
        part("P2", section("S2", itemRef("b")), "linear") +
        part("P3", section("S3", itemRef("c")), "linear"),
    );
    expect(walk(parts, plan(parts), GO_TRUE)).toEqual(["a", "c"]);
    expect(walk(parts, plan(parts), GO_FALSE)).toEqual(["a", "b", "c"]);
  });

  it("[B29] completes a section that was entered but has nothing to present, so that its branch rules follow", () => {
    const adaptive =
      '<qti-adaptive-selection><qti-adaptive-engine-ref identifier="e" href="http://example.org/engine"/></qti-adaptive-selection>';
    const walks = (middle: string): [string[], string[]] => {
      const structure = linear(
        section("S1", itemRef("a")),
        middle,
        section("S3", itemRef("c")),
        section("S4", itemRef("d")),
      );
      return [walk(structure, plan(structure), GO_TRUE), walk(structure, plan(structure), GO_FALSE)];
    };
    // Every item of S2 is skipped when GO is true; S2 is still entered and completed, and its rule skips S3.
    expect(walks(section("S2", branch("S4", GO) + itemRef("b", pre(NOT_GO))))).toEqual([
      ["a", "d"],
      ["a", "b", "c", "d"],
    ]);
    // An adaptive section has no item in the plan.
    expect(walks(section("S2", adaptive + branch("S4", GO)))).toEqual([
      ["a", "d"],
      ["a", "c", "d"],
    ]);
  });

  it("[B29] does not evaluate the branch rules of a node that was skipped", () => {
    const structure = linear(
      section("A", itemRef("a")),
      section("B", pre(NOT_GO) + branch("EXIT_TEST", GO) + itemRef("b")),
      section("C", itemRef("c")),
    );
    expect(walk(structure, plan(structure), GO_TRUE)).toEqual(["a", "c"]);
  });

  it("[B29] ends the test at EXIT_TEST, and completes the test part at EXIT_TESTPART", () => {
    const exit = (target: string, head = ""): TestStructure =>
      structureOf(
        part(
          "P1",
          section("S1", itemRef("a", branch(target, GO)) + itemRef("b")) + section("S2", itemRef("c")),
          "linear",
          head,
        ) +
          part("P2", section("S3", itemRef("d")), "linear") +
          part("P3", section("S4", itemRef("e")), "linear"),
      );
    expect(walk(exit("EXIT_TEST"), plan(exit("EXIT_TEST")), GO_TRUE)).toEqual(["a"]);
    expect(walk(exit("EXIT_TESTPART"), plan(exit("EXIT_TESTPART")), GO_TRUE)).toEqual(["a", "d", "e"]);
    // The branch rules of the part follow the exit.
    const withRule = exit("EXIT_TESTPART", branch("P3", GO));
    expect(walk(withRule, plan(withRule), GO_TRUE)).toEqual(["a", "e"]);
  });

  it("[B29] lets EXIT_SECTION complete the section, so that the branch rules of the section follow", () => {
    const structure = linear(
      section("S1", branch("S3", GO) + itemRef("a", branch("EXIT_SECTION", GO)) + itemRef("b")),
      section("S2", itemRef("c")),
      section("S3", itemRef("d")),
    );
    expect(walk(structure, plan(structure), GO_TRUE)).toEqual(["a", "d"]);
  });

  it("[B29] goes on after a section or part that has EXIT_SECTION or EXIT_TESTPART, which have nothing to leave", () => {
    const structure = structureOf(
      part(
        "P1",
        section("S1", branch("EXIT_SECTION", GO) + itemRef("a")) + section("S2", itemRef("b")),
        "linear",
        branch("EXIT_SECTION", GO),
      ) + part("P2", section("S3", itemRef("c")), "linear"),
    );
    expect(walk(structure, plan(structure), GO_TRUE)).toEqual(["a", "b", "c"]);
  });

  it("[B29] enters a target section or item with the pre-conditions of what it enters", () => {
    const structure = linear(
      section("S1", itemRef("a", branch("c", GO)) + itemRef("b")),
      section("S2", pre(NOT_GO) + itemRef("c") + itemRef("d")),
      section("S3", itemRef("e", pre(NOT_GO)) + itemRef("f")),
    );
    // The target c lies in S2, whose pre-condition is false: S2 is skipped.
    expect(walk(structure, plan(structure), GO_TRUE)).toEqual(["a", "f"]);
    const target = linear(
      section("S1", itemRef("a", branch("c", GO)) + itemRef("b") + itemRef("c", pre(NOT_GO)) + itemRef("d")),
    );
    // The target c has a false pre-condition of its own: the walk goes on after it.
    expect(walk(target, plan(target), GO_TRUE)).toEqual(["a", "d"]);
  });

  it("[B29] does not evaluate a rule whose target is behind, inside the node, in another part, or not in the plan", () => {
    const undeclared = '<qti-variable identifier="NOT_DECLARED"/>';
    const toNowhere = branch("a", undeclared) + branch("other", undeclared) + branch("y", undeclared);
    const structure = structureOf(
      part(
        "P1",
        section(
          "S1",
          itemRef("a") +
            itemRef("b", toNowhere) +
            section("S2", `<qti-selection select="1"/>${refs("x", "y")}`) +
            section("S4", branch("last", undeclared) + refs("inside", "last")),
        ),
        "linear",
      ) + part("P2", section("S3", itemRef("other")), "linear"),
    );
    // The selection of S2 leaves y out. The rule to a is behind, the rule of S4 to its own last item lies inside S4, and
    // the one to other is in another part.
    expect(walk(structure, planWith(structure, scripted(0.99)))).toEqual(["a", "b", "x", "inside", "last", "other"]);
  });

  it("[B29] enters the sections of a target that the walk is not in, and none that it is in", () => {
    let evaluations = 0;
    const counting: TestScope = {
      ...NO_SESSIONS,
      variable: () => {
        evaluations += 1;
        return bool(true);
      },
    };
    const structure = linear(
      section("S", pre('<qti-variable identifier="COUNTED"/>') + itemRef("a", branch("c", GO)) + refs("b", "c")),
    );
    const context = { ...GO_TRUE, scope: counting };
    expect(walk(structure, plan(structure), context)).toEqual(["a", "c"]);
    // S is entered once, when the walk starts; the jump from a to c inside S does not enter it again.
    expect(evaluations).toBe(1);
  });

  it("[B29] leads a rule to the first occurrence ahead of a target that selection repeated", () => {
    const structure = linear(
      section("S1", itemRef("a", branch("t", GO)) + itemRef("m")),
      section("S2", `<qti-selection select="2" with-replacement="true"/>${refs("t")}`),
    );
    expect(walk(structure, planWith(structure, scripted(0, 0)), GO_TRUE)).toEqual(["a", "t", "t#2"]);
  });

  it("[B28][B29] raises a ProcessingError for an expression that is not a single boolean", () => {
    const integer = '<qti-base-value base-type="integer">1</qti-base-value>';
    const structure = linear(section("S", itemRef("a", pre(integer))));
    expect(() => walk(structure, plan(structure))).toThrow("must give a single boolean, found single integer");
  });

  it("[E11] follows the instances of an item reference that selection with replacement repeated", () => {
    const structure = nonlinear(section("S", `<qti-selection select="3" with-replacement="true"/>${refs("a")}`));
    const testPlan = planWith(structure, scripted(0, 0, 0));
    expect(walk(structure, testPlan)).toEqual(["a", "a#2", "a#3"]);
  });

  it("[B26] gives an item before another only in a nonlinear part (previousItem)", () => {
    const structure = structureOf(
      part("P1", section("S1", refs("a", "b"))) + part("P2", section("S2", refs("c", "d")), "linear"),
    );
    const testPlan = plan(structure);
    const key = (ref: string): ItemKey => ({ ref, instance: 1 });
    expect(previousItem(structure, testPlan, key("b"))).toEqual(key("a"));
    expect(previousItem(structure, testPlan, key("a"))).toBeUndefined();
    expect(previousItem(structure, testPlan, key("d"))).toBeUndefined();
  });

  it("[B26] refuses an item instance that is not in the plan, and arguments of other types", () => {
    const structure = nonlinear(section("S", refs("a")));
    const testPlan = plan(structure);
    expect(() => nextItem(structure, testPlan, { ref: "b", instance: 1 }, rules())).toThrow(
      'The plan has no item instance "b" 1.',
    );
    expect(() => previousItem(structure, testPlan, { ref: "a", instance: 2 })).toThrow(
      'The plan has no item instance "a" 2.',
    );
    expect(() => nextItem(structure, testPlan, json('{"ref":"a","instance":0}'), rules())).toThrow(
      "The instance of the item instance must be a positive integer, found 0.",
    );
    expect(() => nextItem(structure, testPlan, json('{"ref":1,"instance":1}'), rules())).toThrow(
      "The ref of the item instance must be a string, found 1.",
    );
    expect(() => nextItem(structure, testPlan, json("null"), rules())).toThrow(DataError);
    expect(() => nextItem(json("null"), testPlan, undefined, rules())).toThrow(DataError);
    expect(() => nextItem(structure, json('{"parts":1}'), undefined, rules())).toThrow(DataError);
    expect(() => nextItem(structure, testPlan, undefined, json("null"))).toThrow(DataError);
    expect(() => previousItem(structure, testPlan, json("null"))).toThrow(DataError);
    const reading = linear(section("S", itemRef("a", pre(GO))));
    for (const context of ['{"outcomes":{},"scope":{},"context":{}}', '{"outcomes":null}', "null"]) {
      expect(() => nextItem(reading, plan(reading), undefined, json(context))).toThrow(DataError);
    }
  });

  it("[B26] refuses a plan that names what the structure does not have", () => {
    const structure = linear(section("S", refs("a")));
    const other = linear(section("T", refs("b")));
    expect(() => nextItem(structure, plan(other), undefined, rules())).toThrow(
      'The plan names "T", which the structure does not have.',
    );
  });
});

describe("planTest", () => {
  it("[B23] keeps the test parts and the sections of a part in document order, with their items", () => {
    const structure = structureOf(
      part("P1", section("S", refs("a", "b")) + section("T", refs("c"))) +
        part("P2", section("U", refs("d")), "linear"),
    );
    expect(outlineOf(plan(structure, 7))).toBe("P1{S[a b] T[c]} P2{U[d]}");
  });

  it("[B23] keeps the order of the children without ordering and with shuffle false, and draws nothing", () => {
    const withoutOrdering = nonlinear(section("S", refs("a", "b", "c")));
    const withoutShuffle = nonlinear(section("S", `<qti-ordering shuffle="false"/>${refs("a", "b", "c")}`));
    for (const structure of [withoutOrdering, withoutShuffle]) {
      const random = scripted();
      expect(outlineOf(planWith(structure, random))).toBe("P{S[a b c]}");
    }
  });

  it("[B23] shuffles by Fisher–Yates from the last index, with floor(uniform × n) as the draw", () => {
    // [x, y, z]: i = 2 draws floor(0.5 × 3) = 1 and swaps the places 2 and 1, giving [x, z, y];
    // i = 1 draws floor(0.5 × 2) = 1 and swaps the place 1 with itself.
    const structure = nonlinear(section("S", `<qti-ordering shuffle="true"/>${refs("x", "y", "z")}`));
    const random = scripted(0.5, 0.5);
    expect(outlineOf(planWith(structure, random))).toBe("P{S[x z y]}");
    expect(random.left()).toBe(0);
  });

  it("[B23] keeps fixed children in their places and shuffles the others among theirs", () => {
    // [a, b (fixed), c, d]: the movable places are 0, 2 and 3. i = 2 swaps the movable places 3 and 2 (draw 1), giving
    // [a, b, d, c]; i = 1 draws 1 and swaps a place with itself.
    const structure = nonlinear(
      section(
        "S",
        `<qti-ordering shuffle="true"/>${itemRef("a")}${itemRef("b", "", ' fixed="true"')}${refs("c", "d")}`,
      ),
    );
    const random = scripted(0.5, 0.5);
    expect(outlineOf(planWith(structure, random))).toBe("P{S[a b d c]}");
    expect(random.left()).toBe(0);
  });

  it("[B23] orders after selection, so that fixed places are those of the selected children", () => {
    // Selection of 3 of [a (fixed), b, c, d] draws three numbers that leave a, b, c; then the movable places 1 and 2
    // swap for the draw 0 (floor(0 × 2)).
    const structure = nonlinear(
      section(
        "S",
        '<qti-selection select="3"/><qti-ordering shuffle="true"/>' +
          itemRef("a", "", ' fixed="true"') +
          refs("b", "c", "d"),
      ),
    );
    const random = scripted(0.99, 0.99, 0.99, 0);
    expect(outlineOf(planWith(structure, random))).toBe("P{S[a c b]}");
    expect(random.left()).toBe(0);
  });

  it("[B24] keeps an invisible section together in a shuffled parent when it is kept together (RTEST-24)", () => {
    const sectionB = section(
      "sectionB",
      '<qti-ordering shuffle="true"/>' +
        refs("item434", "item065", "item365") +
        section(
          "sectionB1",
          `<qti-ordering shuffle="false"/>${refs("item347", "item653")}`,
          'visible="false" keep-together="true"',
        ) +
        refs("item656"),
    );
    const sectionA = section(
      "sectionA",
      `<qti-ordering shuffle="true"/>${itemRef("item034", "", ' fixed="true"')}${refs("item160", "item063")}`,
    );
    const structure = nonlinear(sectionA, sectionB);
    const seen = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) {
      const [first, second] = plan(structure, seed).parts[0]?.children ?? [];
      expect(first?.children[0]).toEqual({ kind: "item", key: { ref: "item034", instance: 1 } });
      const blocks = second?.children.filter((child) => child.kind === "section") ?? [];
      expect(blocks.map((block) => outline([block]))).toEqual(["sectionB1[item347 item653]"]);
      seen.add(outline(second?.children ?? []));
    }
    // Five children (the block counts as one) take every one of their 120 orders given enough seeds; many appear here.
    expect(seen.size).toBeGreaterThan(60);
  });

  it("[B24] mixes the children of an invisible section that is not kept together into its shuffled parent (RTEST-12)", () => {
    const sectionB = section(
      "sectionB",
      '<qti-selection select="2"/><qti-ordering shuffle="true"/>' +
        refs("item434", "item065", "item365") +
        section(
          "sectionB1",
          refs("item347", "item653", "item656"),
          'visible="false" keep-together="false" required="true"',
        ),
    );
    const structure = nonlinear(sectionB);
    expect(structure.section("sectionB1")?.dissolved).toBe(true);
    const orders = new Set<string>();
    const others = new Set<string>();
    for (let seed = 1; seed <= 300; seed++) {
      const [children] = plan(structure, seed).parts[0]?.children ?? [];
      const refsInOrder = (children?.children ?? []).map((child) => (child.kind === "item" ? child.key.ref : "block"));
      // Selection of 2 takes the required block as one child and one of the three items; the block's items are mixed in.
      expect(refsInOrder).toHaveLength(4);
      expect(refsInOrder).toContain("item347");
      expect(refsInOrder).toContain("item653");
      expect(refsInOrder).toContain("item656");
      expect(refsInOrder).not.toContain("block");
      others.add(refsInOrder.filter((ref) => ["item434", "item065", "item365"].includes(ref)).join());
      orders.add(refsInOrder.join(" "));
    }
    expect([...others].sort()).toEqual(["item065", "item365", "item434"]);
    // The three items of the block do not stay in their order and the other item lands between them.
    expect(orders.size).toBeGreaterThan(12);
    expect([...orders].some((order) => order.indexOf("item653") < order.indexOf("item347"))).toBe(true);
    expect(
      [...orders].some((order) => /^item\d+ (item347|item653|item656) (item434|item065|item365)/.test(order)),
    ).toBe(true);
  });

  it("[B24] keeps a visible section, and a fixed section, together whatever keep-together says", () => {
    const content = (attributes: string): TestStructure =>
      nonlinear(
        section("W", `<qti-ordering shuffle="true"/>${refs("x", "y")}${section("S", refs("m", "n"), attributes)}`),
      );
    for (const attributes of [
      'visible="true" keep-together="false"',
      'visible="false" keep-together="false" fixed="true"',
    ]) {
      const structure = content(attributes);
      expect(structure.section("S")?.dissolved).toBe(false);
      for (let seed = 1; seed <= 30; seed++) expect(outlineOf(plan(structure, seed))).toContain("S[m n]");
    }
  });

  it("[B24] does not mix when the parent does not shuffle", () => {
    const structure = nonlinear(
      section("W", refs("x") + section("S", refs("m", "n"), 'visible="false" keep-together="false"') + refs("y")),
    );
    expect(structure.section("S")?.dissolved).toBe(false);
    expect(outlineOf(plan(structure))).toBe("P{W[x S[m n] y]}");
  });

  it("[B24] mixes sections that lie in sections that are mixed in, at any depth", () => {
    const mixed = 'visible="false" keep-together="false"';
    const structure = nonlinear(
      section(
        "W",
        `<qti-ordering shuffle="true"/>${section("S1", section("S2", refs("p", "q"), mixed), mixed)}${refs("r")}`,
      ),
    );
    // S1 does not shuffle, yet S2 goes up with it into W.
    expect([structure.section("S1")?.dissolved, structure.section("S2")?.dissolved]).toEqual([true, true]);
    for (let seed = 1; seed <= 30; seed++) expect(outlineOf(plan(structure, seed))).toMatch(/^P\{W\[[pqr ]+\]\}$/);
  });

  it("[B24] lets a section that is mixed in select and order its own children first", () => {
    // S keeps one of m and n (draw 0.99 leaves m); W then shuffles [x, m, y]: i = 2 draws 0 and swaps the places 2 and 0
    // (y, m, x); i = 1 draws 1 and swaps a place with itself.
    const structure = nonlinear(
      section(
        "W",
        '<qti-ordering shuffle="true"/>' +
          refs("x") +
          section("S", `<qti-selection select="1"/>${refs("m", "n")}`, 'visible="false" keep-together="false"') +
          refs("y"),
      ),
    );
    const random = scripted(0.99, 0, 0.99);
    expect(outlineOf(planWith(structure, random))).toBe("P{W[y m x]}");
    expect(random.left()).toBe(0);
  });

  it("[B22][E11] numbers the instances of a reference in the order of presentation, after ordering", () => {
    // Selection of 4 with replacement from [a, b] draws a, a, b, a (a three times), then ordering draws 0, 0.99, 0.99:
    // the place 3 swaps with the place 0, giving [b, a, a, a].
    const structure = nonlinear(
      section(
        "S",
        `<qti-selection select="4" with-replacement="true"/><qti-ordering shuffle="true"/>${refs("a", "b")}`,
      ),
    );
    const random = scripted(0, 0, 0.99, 0, 0, 0.99, 0.99);
    const testPlan = planWith(structure, random);
    expect(outlineOf(testPlan)).toBe("P{S[b a a#2 a#3]}");
    expect(planItems(testPlan)).toEqual([
      { ref: "b", instance: 1 },
      { ref: "a", instance: 1 },
      { ref: "a", instance: 2 },
      { ref: "a", instance: 3 },
    ]);
  });

  it("[B22][E11] plans a section once for each selection, each with its own draws", () => {
    // W selects 2 times with replacement from [S]: two draws over one child. S keeps one of x and y: the first
    // occurrence draws 0.99 (x), the second 0 (y).
    const structure = nonlinear(
      section(
        "W",
        '<qti-selection select="2" with-replacement="true"/>' +
          section("S", `<qti-selection select="1"/>${refs("x", "y")}`),
      ),
    );
    const random = scripted(0.5, 0.5, 0.99, 0);
    expect(outlineOf(planWith(structure, random))).toBe("P{W[S[x] S#2[y]]}");
    expect(random.left()).toBe(0);
  });

  it("[B66] gives an adaptive section no items and takes no draw, though its pool is in the structure", () => {
    const adaptive =
      '<qti-adaptive-selection><qti-adaptive-engine-ref identifier="e" href="http://example.org/engine"/></qti-adaptive-selection>';
    const structure = nonlinear(section("A", adaptive + refs("a", "b")), section("B", refs("c")));
    const random = scripted();
    expect(outlineOf(planWith(structure, random))).toBe("P{A[] B[c]}");
    expect(structure.itemRef("a")?.model.href).toBe("a.xml");
  });

  it("[B22] refuses a plan beyond maxPlanNodes before drawing, so that a selection cannot exhaust memory", () => {
    const huge = nonlinear(section("S", `<qti-selection select="1000000" with-replacement="true"/>${refs("a")}`));
    const random = scripted();
    expect(() => planWith(huge, random)).toThrow(SecurityError);
    expect(() => planWith(huge, random)).toThrow(
      "The plan would hold more than the 10000 sections and items that the limit maxPlanNodes allows.",
    );
    expect(DEFAULT_PLAN_LIMITS).toEqual({ maxPlanNodes: 10_000 });
    const small = nonlinear(section("S", refs("a", "b", "c")));
    expect(outlineOf(planTest(small, { random: createRandom(1), limits: { maxPlanNodes: 4 } }))).toBe("P{S[a b c]}");
    expect(() => planTest(small, { random: createRandom(1), limits: { maxPlanNodes: 3 } })).toThrow(SecurityError);
  });

  it("[B27] lists the items of a test part together, as a part with simultaneous submission submits them", () => {
    const structure = structureOf(
      part("P1", section("S1", refs("a", "b")) + section("S2", refs("c"))) +
        part("P2", section("S3", refs("d")), "linear"),
    );
    const testPlan = plan(structure);
    expect(itemsOf(testPlan, "P1")).toEqual(["a", "b", "c"]);
    expect(itemsOf(testPlan, "P2")).toEqual(["d"]);
    expect(itemsOf(testPlan)).toEqual(["a", "b", "c", "d"]);
    expect(() => planItems(testPlan, "P3")).toThrow('The plan has no test part "P3".');
  });

  it("[B22] refuses options and arguments of other types", () => {
    const structure = nonlinear(section("S", refs("a")));
    const random = createRandom(1);
    expect(() => planTest(json("null"), { random })).toThrow(DataError);
    expect(() => planTest(json('{"test":{"parts":1}}'), { random })).toThrow(DataError);
    expect(() => planTest(structure, json("null"))).toThrow("The options must be an object, found null.");
    expect(() => planTest(structure, json("{}"))).toThrow(
      "The option random must be an object with a function uniform",
    );
    expect(() => planTest(structure, json('{"random":{"uniform":1}}'))).toThrow(
      "The option random must be an object with a function uniform, found 1.",
    );
    expect(() => planTest(structure, { random, limits: json("null") })).toThrow(
      "The option limits must be an object, found null.",
    );
    expect(() => planTest(structure, { random, limits: json('{"maxPlanNodes":"3"}') })).toThrow(
      'The option limits.maxPlanNodes must be a positive integer, found "3".',
    );
    expect(() => planTest(structure, { random, limits: { maxPlanNodes: 0 } })).toThrow(DataError);
    expect(() => planItems(json("null"))).toThrow(DataError);
    expect(() => planItems(json('{"parts":{}}'))).toThrow(DataError);
    expect(() => planItems(plan(structure), json("1"))).toThrow("The test part must be a string, found 1.");
  });

  it("[B23] refuses a random source that returns anything but a number in [0, 1)", () => {
    const structure = nonlinear(section("S", `<qti-ordering shuffle="true"/>${refs("a", "b")}`));
    for (const draw of [1, -0.1, Number.NaN, "0.5"]) {
      const random = { uniform: () => json<number>(JSON.stringify(draw)) };
      expect(() => planWith(structure, random)).toThrow(DataError);
    }
    expect(() => planWith(structure, { uniform: () => 1 })).toThrow(
      "The function uniform of the option random must return a number in [0, 1), found 1.",
    );
  });
});

describe("selection", () => {
  const abcd = (selection: string, ordering = ""): TestStructure =>
    nonlinear(section("S", selection + ordering + refs("a", "b", "c", "d")));

  it("[B21] selects every child in document order when the section has no selection, and draws nothing", () => {
    const random = scripted();
    expect(outlineOf(planWith(abcd(""), random))).toBe("P{S[a b c d]}");
  });

  it("[B21] draws nothing when the selection takes every child", () => {
    const random = scripted();
    expect(outlineOf(planWith(abcd('<qti-selection select="4"/>'), random))).toBe("P{S[a b c d]}");
  });

  it("[B21][G8] takes the first places of a shuffle of the children that are not required, in document order", () => {
    // Fisher–Yates over the places [0, 1, 2, 3] with the draws 0, 0, 0: i = 3 swaps 3 and 0, i = 2 swaps 2 and 0,
    // i = 1 swaps 1 and 0, giving [1, 2, 3, 0]; the first two places are b and c. With 0.99 each swap is with itself:
    // [0, 1, 2, 3], so a and b.
    const select = abcd('<qti-selection select="2"/>');
    expect(outlineOf(planWith(select, scripted(0, 0, 0)))).toBe("P{S[b c]}");
    expect(outlineOf(planWith(select, scripted(0.99, 0.99, 0.99)))).toBe("P{S[a b]}");
  });

  it("[B21] includes every required child, and counts a section as one child (RTEST-12)", () => {
    // INFO §4.2.2: section B selects 2 children, the section B1 is required, so B1 and one of the other three items.
    const structure = nonlinear(
      section(
        "sectionB",
        '<qti-selection select="2"/>' +
          refs("item434", "item065", "item365") +
          section("sectionB1", refs("item347", "item653", "item656"), 'visible="false" required="true"'),
      ),
    );
    expect(outlineOf(planWith(structure, scripted(0.99, 0.99)))).toBe(
      "P{sectionB[item434 sectionB1[item347 item653 item656]]}",
    );
    const chosen = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      const [children] = plan(structure, seed).parts[0]?.children ?? [];
      const kinds = (children?.children ?? []).map((child) => child.kind);
      expect(kinds.filter((kind) => kind === "section")).toHaveLength(1);
      expect(kinds).toHaveLength(2);
      chosen.add(outline(children?.children.filter((child) => child.kind === "item") ?? []));
    }
    expect([...chosen].sort()).toEqual(["item065", "item365", "item434"]);
  });

  it("[B21] selects a required item reference always, and keeps document order (RTEST-12 section A)", () => {
    const structure = nonlinear(
      section(
        "sectionA",
        '<qti-selection select="2"/><qti-ordering shuffle="false"/>' +
          itemRef("item034", "", ' required="true"') +
          refs("item160", "item063"),
      ),
    );
    const chosen = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      const [first, second] = itemsOf(plan(structure, seed));
      expect(first).toBe("item034");
      chosen.add(second ?? "");
    }
    expect([...chosen].sort()).toEqual(["item063", "item160"]);
  });

  it("[B21][G8] draws the subset uniformly among the children that are not required", () => {
    const one = abcd('<qti-selection select="1"/>');
    const picks = tally(4000, (seed) => itemsOf(plan(one, seed)).join(), ["a", "b", "c", "d"]);
    expect(chiSquare(picks)).toBeLessThan(CHI_SQUARE_CRITICAL[3]);
    const two = abcd('<qti-selection select="2"/>');
    const pairs = tally(6000, (seed) => itemsOf(plan(two, seed)).join(), ["a,b", "a,c", "a,d", "b,c", "b,d", "c,d"]);
    expect(chiSquare(pairs)).toBeLessThan(CHI_SQUARE_CRITICAL[5]);
    const withRequired = nonlinear(
      section("S", `<qti-selection select="2"/>${itemRef("r", "", ' required="true"')}${refs("a", "b", "c")}`),
    );
    const others = tally(3000, (seed) => itemsOf(plan(withRequired, seed)).slice(1).join(), ["a", "b", "c"]);
    expect(chiSquare(others)).toBeLessThan(CHI_SQUARE_CRITICAL[2]);
  });

  it("[B21] refuses a selection of fewer children than are required, or more than exist, or less than 0", () => {
    const required = nonlinear(
      section(
        "S",
        '<qti-selection select="1"/>' +
          itemRef("a", "", ' required="true"') +
          itemRef("b", "", ' required="true"') +
          refs("c"),
      ),
    );
    expect(() => plan(required)).toThrow(
      'The section "S" selects 1 of its 3 children, but 2 of them are required and must all be selected.',
    );
    expect(() => plan(abcd('<qti-selection select="5"/>'))).toThrow(
      'The section "S" selects 5 of its 4 children, which only a selection with replacement may do.',
    );
    expect(() => plan(abcd('<qti-selection select="-1"/>'))).toThrow(
      'The section "S" selects -1 of its 4 children, but select must be a non-negative integer.',
    );
    const nothing = nonlinear(section("S", '<qti-selection select="2" with-replacement="true"/>'));
    expect(() => plan(nothing)).toThrow(
      'The section "S" selects 2 of its 0 children, so there is nothing to select from.',
    );
    expect(() => plan(nonlinear(section("S", '<qti-selection select="1"/>')))).toThrow(DataError);
  });

  it("[B22] selects every required child once, then draws the others over all children, with replacement", () => {
    // [a (required), b, c] with 4 selections: a once, then three draws of floor(u × 3): 0 is a, 0.5 is b, 0.99 is c.
    const structure = nonlinear(
      section(
        "S",
        `<qti-selection select="4" with-replacement="true"/>${itemRef("a", "", ' required="true"')}${refs("b", "c")}`,
      ),
    );
    const random = scripted(0, 0.5, 0.99);
    expect(outlineOf(planWith(structure, random))).toBe("P{S[a a#2 b c]}");
    expect(random.left()).toBe(0);
  });

  it("[B22] lets select exceed the number of children when the selection is with replacement", () => {
    const structure = nonlinear(section("S", `<qti-selection select="5" with-replacement="true"/>${refs("a", "b")}`));
    expect(outlineOf(planWith(structure, scripted(0, 0, 0, 0, 0)))).toBe("P{S[a a#2 a#3 a#4 a#5]}");
  });

  it("[B22][G8] draws the remaining selections uniformly over all children, the required ones included", () => {
    const free = nonlinear(section("S", `<qti-selection select="1" with-replacement="true"/>${refs("a", "b", "c")}`));
    const single = tally(3000, (seed) => itemsOf(plan(free, seed)).join(), ["a", "b", "c"]);
    expect(chiSquare(single)).toBeLessThan(CHI_SQUARE_CRITICAL[2]);
    const required = nonlinear(
      section(
        "S",
        `<qti-selection select="2" with-replacement="true"/>${itemRef("r", "", ' required="true"')}${refs("a", "b")}`,
      ),
    );
    const second = tally(3000, (seed) => itemsOf(plan(required, seed)).slice(1).join().replace("r#2", "r"), [
      "r",
      "a",
      "b",
    ]);
    expect(chiSquare(second)).toBeLessThan(CHI_SQUARE_CRITICAL[2]);
  });

  it("[B21][B22] plans identically for equal seeds, and from a restored generator state", () => {
    const structure = nonlinear(
      section("S", `<qti-selection select="3"/><qti-ordering shuffle="true"/>${refs("a", "b", "c", "d", "e")}`),
    );
    expect(plan(structure, 9)).toEqual(plan(structure, 9));
    const random = createRandom(9);
    const state = random.state();
    const first = planWith(structure, random);
    const replayed = restoreRandom(state);
    expect(planWith(structure, replayed)).toEqual(first);
    expect(replayed.state()).toEqual(random.state());
  });
});

describe("sessionControl", () => {
  const control = (attributes: string): string => `<qti-item-session-control ${attributes}/>`;
  const item = (structure: TestStructure, ref: string) => sessionControl(structure.itemRef(ref) ?? fail(`No ${ref}.`));

  const nested = structureOf(
    part(
      "P",
      section(
        "outer",
        control('max-attempts="3" allow-review="false"') +
          section(
            "inner",
            control('show-solution="true"') +
              itemRef("a", control('max-attempts="0" allow-skipping="false"')) +
              itemRef("b"),
          ),
      ),
      "linear",
      control('show-feedback="true" max-attempts="1"'),
    ),
  );

  it("[B30] lets the test part, then each section from the outermost, then the item reference override attribute by attribute", () => {
    expect(item(nested, "a")).toEqual({
      maxAttempts: 0,
      showFeedback: true,
      allowReview: false,
      showSolution: true,
      allowComment: false,
      allowSkipping: false,
      validateResponses: false,
    });
    expect(item(nested, "b")).toEqual({
      maxAttempts: 3,
      showFeedback: true,
      allowReview: false,
      showSolution: true,
      allowComment: false,
      allowSkipping: true,
      validateResponses: false,
    });
  });

  it("[B30] follows the item session control of RTEST-13", () => {
    const structure = structureOf(
      part(
        "RTEST-13-A",
        section("sectionA", itemRef("item034", control('max-attempts="0"')) + refs("item160")) +
          section("sectionB", control('max-attempts="2"') + refs("item347")),
        "linear",
        control('show-feedback="true" max-attempts="1" show-solution="false"'),
      ),
    );
    const common = { showFeedback: true, showSolution: false, allowReview: true, allowComment: false };
    expect(item(structure, "item034")).toMatchObject({ ...common, maxAttempts: 0 });
    expect(item(structure, "item160")).toMatchObject({ ...common, maxAttempts: 1 });
    expect(item(structure, "item347")).toMatchObject({ ...common, maxAttempts: 2 });
  });

  it("[B30] gives the defaults when no level sets an attribute, and no maximum number of attempts", () => {
    const structure = nonlinear(section("S", refs("a")));
    const effective = item(structure, "a");
    expect(effective).toEqual({
      showFeedback: false,
      allowReview: true,
      showSolution: false,
      allowComment: false,
      allowSkipping: true,
      validateResponses: false,
    });
    expect("maxAttempts" in effective).toBe(false);
  });

  it("[B30] passes on the control of a section that ordering mixes into its parent", () => {
    const structure = nonlinear(
      section(
        "W",
        '<qti-ordering shuffle="true"/>' +
          section("S", control('allow-comment="true"') + refs("m"), 'visible="false" keep-together="false"'),
      ),
    );
    expect(structure.section("S")?.dissolved).toBe(true);
    expect(item(structure, "m").allowComment).toBe(true);
  });

  it("[B30] refuses what is not an item reference of a structure", () => {
    expect(() => sessionControl(json("null"))).toThrow("The item reference must be an object from resolveStructure");
    expect(() => sessionControl(json(JSON.stringify({ kind: "section" })))).toThrow(
      'The item reference must be a node of kind "item-ref", found the kind "section".',
    );
  });
});

describe("resolveStructure", () => {
  const SectionOne = section(
    "S1",
    `${refs("a")}<qti-assessment-section-ref identifier="S2" href="deeper/s2.xml"/>${refs("b")}`,
  );
  const SectionTwo = section("S2", refs("c"));
  const Documents = { "../sections/s1.xml": SectionOne, "deeper/s2.xml": SectionTwo };
  const Referencing = part(
    "P",
    `<qti-assessment-section-ref identifier="S1" href="../sections/s1.xml"/>${section("T", refs("t1"))}`,
  );

  it("[B25] replaces a section reference by the section it names, and resolves what it holds against its document", () => {
    const calls: [string, string][] = [];
    const structure = structureOf(Referencing, Documents, "tests/t.xml", calls);
    // INFO §7.5, BIND §8.2: the href is relative to the document that holds the reference.
    expect(calls).toEqual([
      ["../sections/s1.xml", "tests/t.xml"],
      ["deeper/s2.xml", "sections/s1.xml"],
    ]);
    expect(structure.section("S1")?.base).toBe("sections/s1.xml");
    expect(structure.section("S2")?.base).toBe("sections/deeper/s2.xml");
    expect(structure.itemRef("a")?.base).toBe("sections/s1.xml");
    expect(structure.itemRef("c")?.base).toBe("sections/deeper/s2.xml");
    expect(structure.itemRef("t1")?.base).toBe("tests/t.xml");
    expect(outlineOf(plan(structure))).toBe("P{S1[a S2[c] b] T[t1]}");
  });

  it("[B25] takes the required mark and the selection from the section that the reference names", () => {
    const required = section("S1", refs("a", "b"), 'visible="true" required="true"');
    const structure = structureOf(
      part(
        "P",
        section(
          "W",
          '<qti-selection select="1"/><qti-ordering shuffle="false"/>' +
            refs("x") +
            '<qti-assessment-section-ref identifier="S1" href="s1.xml"/>',
        ),
      ),
      { "s1.xml": required },
    );
    for (let seed = 1; seed <= 20; seed++) expect(outlineOf(plan(structure, seed))).toBe("P{W[S1[a b]]}");
  });

  it("[B25] refuses a reference whose identifier is not that of the section it names", () => {
    const wrong = structureOf.bind(null, part("P", '<qti-assessment-section-ref identifier="X" href="s1.xml"/>'));
    expect(() => wrong({ "s1.xml": section("S1", refs("a")) })).toThrow(
      'The section reference "X" names "s1.xml", whose section has the identifier "S1"; the two must be equal.',
    );
  });

  it("[B25] refuses identifiers that two test parts, sections or item references share", () => {
    expect(() => nonlinear(section("S", refs("a", "a")))).toThrow(
      'The identifier "a" names an item reference and an item reference; the identifiers of test parts, sections and item references must be unique in a test.',
    );
    expect(() => nonlinear(section("x", refs("x")))).toThrow(
      'The identifier "x" names a section and an item reference',
    );
    expect(() => structureOf(part("x", section("x", refs("a"))))).toThrow(
      'The identifier "x" names a test part and a section',
    );
    // The same document, referenced twice, gives its section twice.
    const twice = `<qti-assessment-section-ref identifier="S1" href="s1.xml"/><qti-assessment-section-ref identifier="S1" href="s1.xml"/>`;
    expect(() => structureOf(part("P", twice), { "s1.xml": section("S1", refs("a")) })).toThrow(
      'The identifier "S1" names a section and a section',
    );
  });

  it("[B25] refuses an xi:include that is left in a section", () => {
    const include = '<xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="more.xml"/>';
    expect(() => nonlinear(section("S", include))).toThrow(
      'The section "S" holds an xi:include, which must be resolved before the test is planned.',
    );
  });

  it("[B25] refuses a reference outside the package, and a resolver that returns no section", () => {
    const reference = part("P", '<qti-assessment-section-ref identifier="S1" href="/s1.xml"/>');
    expect(() => structureOf(reference, { "/s1.xml": section("S1", refs("a")) })).toThrow(
      'The reference "/s1.xml" in "test.xml" is outside the package.',
    );
    const own = part("P", '<qti-assessment-section-ref identifier="S1" href="s1.xml"/>');
    const test = testOf(own);
    expect(() => resolveStructure(test, "test.xml", { sections: () => json("null") })).toThrow(
      'The section that "s1.xml" names must be an object of the model of qti-assessment-section, found null.',
    );
    expect(() => resolveStructure(test, "test.xml", { sections: () => json('{"kind":"assessment-item"}') })).toThrow(
      'The reference "s1.xml" must name a qti-assessment-section, found the kind "assessment-item".',
    );
  });

  it("[B25] finds a part, a section and an item reference by identifier, and nothing for an identifier it does not have", () => {
    const structure = nonlinear(section("S", refs("a")));
    expect(structure.part("P")?.model.navigationMode).toBe("nonlinear");
    expect(structure.section("S")?.model.title).toBe("S");
    expect(structure.itemRef("a")?.model.href).toBe("a.xml");
    expect([
      structure.part("S"),
      structure.section("a"),
      structure.itemRef("P"),
      structure.section("__proto__"),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("[B30] lists the nodes that enclose a node from the outermost, and finds its test part", () => {
    const structure = structureOf(part("P", section("outer", section("inner", refs("a")))));
    const item = structure.itemRef("a") ?? fail("No a.");
    expect(ancestry(item).map((node) => (node.kind === "test" ? "test" : node.model.identifier))).toEqual([
      "test",
      "P",
      "outer",
      "inner",
    ]);
    expect(ancestry(structure.test)).toEqual([]);
    expect(partOf(item).model.identifier).toBe("P");
    const top = structure.section("outer") ?? fail("No outer.");
    expect(partOf(top)).toBe(structure.part("P"));
  });

  it("[B25] refuses arguments of other types", () => {
    const test = testOf(part("P", section("S", refs("a"))));
    expect(() => resolveStructure(json("null"), "test.xml", NO_SECTIONS)).toThrow(DataError);
    expect(() => resolveStructure(json('{"kind":"assessment-item"}'), "test.xml", NO_SECTIONS)).toThrow(
      'The test must be the model of a qti-assessment-test, found the kind "assessment-item".',
    );
    expect(() => resolveStructure(test, json("1"), NO_SECTIONS)).toThrow("The base must be a string, found 1.");
    expect(() => resolveStructure(test, "test.xml", json("null"))).toThrow(DataError);
    expect(() => resolveStructure(test, "test.xml", json("{}"))).toThrow(
      "The resolvers must have a function sections of an href and a base, found undefined.",
    );
  });
});

describe("timeLimits", () => {
  const TestLimits = limits('min-time="600" max-time="3600"');
  const SectionLimits = limits('min-time="60" max-time="1800" allow-late-submission="true"');

  /** RTEST-COMPLETE's limits at every level: a test and a part of 3600 s, a section of 1800 s, an item of 300 s. */
  const timed = (mode: "linear" | "nonlinear", test = TestLimits): TestStructure =>
    structureOf(
      test +
        part(
          "P",
          section("S", SectionLimits + itemRef("a", limits('min-time="30" max-time="300"')) + itemRef("b")),
          mode,
          limits('max-time="3600"'),
        ),
    );

  /** The limits of every scope of `timed`. */
  function everywhere(structure: TestStructure, extra?: TestingTime) {
    const at = (id: "a" | "b") => timeLimits(structure.itemRef(id) ?? fail(`No ${id}.`), extra);
    return {
      test: timeLimits(structure.test, extra),
      part: timeLimits(structure.part("P") ?? fail("No part."), extra),
      section: timeLimits(structure.section("S") ?? fail("No section."), extra),
      a: at("a"),
      b: at("b"),
    };
  }

  it("[B35] gives the limits that each scope declares, in seconds, without inheriting them", () => {
    expect(everywhere(timed("linear"))).toEqual({
      test: { minTime: 600, maxTime: 3600, allowLateSubmission: false },
      part: { maxTime: 3600, allowLateSubmission: false },
      section: { minTime: 60, maxTime: 1800, allowLateSubmission: true },
      a: { minTime: 30, maxTime: 300, allowLateSubmission: false },
      b: { allowLateSubmission: false },
    });
  });

  it("[B35] applies the minimum time of an item and a section only in a linear part, and that of a part and the test always", () => {
    expect(everywhere(timed("nonlinear"))).toEqual({
      test: { minTime: 600, maxTime: 3600, allowLateSubmission: false },
      part: { maxTime: 3600, allowLateSubmission: false },
      section: { maxTime: 1800, allowLateSubmission: true },
      a: { maxTime: 300, allowLateSubmission: false },
      b: { allowLateSubmission: false },
    });
    const minimum = structureOf(part("P", section("S", ""), "nonlinear", limits('min-time="90"')));
    expect(timeLimits(minimum.part("P") ?? fail("No part."))).toEqual({ minTime: 90, allowLateSubmission: false });
  });

  it("[B36][G41] multiplies every maximum time by the multiplier and leaves the minimum times", () => {
    const extra: TestingTime = { kind: "time-multiplier", multiplier: 1.5 };
    expect(everywhere(timed("linear"), extra)).toEqual({
      test: { minTime: 600, maxTime: 5400, allowLateSubmission: false },
      part: { maxTime: 5400, allowLateSubmission: false },
      section: { minTime: 60, maxTime: 2700, allowLateSubmission: true },
      a: { minTime: 30, maxTime: 450, allowLateSubmission: false },
      b: { allowLateSubmission: false },
    });
  });

  it("[B36][G41] adds the fixed minutes to the outermost maximum time only", () => {
    // The test has a maximum, so the part, the section and the item keep theirs: 3600 s + 30 min.
    const extra: TestingTime = { kind: "fixed-minutes", minutes: 30 };
    expect(everywhere(timed("linear"), extra)).toEqual({
      test: { minTime: 600, maxTime: 5400, allowLateSubmission: false },
      part: { maxTime: 3600, allowLateSubmission: false },
      section: { minTime: 60, maxTime: 1800, allowLateSubmission: true },
      a: { minTime: 30, maxTime: 300, allowLateSubmission: false },
      b: { allowLateSubmission: false },
    });
    // Without a maximum on the test the part is the outermost one on every path through it.
    expect(everywhere(timed("linear", ""), extra)).toMatchObject({
      test: { allowLateSubmission: false },
      part: { maxTime: 5400 },
      section: { maxTime: 1800 },
      a: { maxTime: 300 },
    });
  });

  it("[B36][G41] adds the fixed minutes to each outermost maximum when the paths differ", () => {
    const structure = structureOf(
      part("P1", section("S1", limits('max-time="100"') + itemRef("a", limits('max-time="50"'))), "linear") +
        part("P2", section("S2", itemRef("b", limits('max-time="70"')) + refs("c")), "linear"),
    );
    const extra: TestingTime = { kind: "fixed-minutes", minutes: 1 };
    const maximum = (id: string): number | undefined =>
      timeLimits(structure.itemRef(id) ?? fail(`No ${id}.`), extra).maxTime;
    const maximumOfSection = (id: string): number | undefined =>
      timeLimits(structure.section(id) ?? fail(`No ${id}.`), extra).maxTime;
    expect([maximumOfSection("S1"), maximum("a"), maximumOfSection("S2"), maximum("b"), maximum("c")]).toEqual([
      160,
      50,
      undefined,
      130,
      undefined,
    ]);
  });

  it("[B36][G41] removes every maximum time when the time is unlimited, and nothing else", () => {
    expect(everywhere(timed("linear"), { kind: "unlimited" })).toEqual({
      test: { minTime: 600, allowLateSubmission: false },
      part: { allowLateSubmission: false },
      section: { minTime: 60, allowLateSubmission: true },
      a: { minTime: 30, allowLateSubmission: false },
      b: { allowLateSubmission: false },
    });
  });

  it("[B36] leaves a scope without a maximum time without one, whatever the extra time", () => {
    const structure = nonlinear(section("S", refs("a")));
    const item = structure.itemRef("a") ?? fail("No a.");
    for (const extra of [
      { kind: "time-multiplier", multiplier: 2 },
      { kind: "fixed-minutes", minutes: 30 },
      { kind: "unlimited" },
    ] as const) {
      expect(timeLimits(item, extra)).toEqual({ allowLateSubmission: false });
    }
  });

  it("[B24][B36] gives a section that ordering mixes into its parent no limits and counts it no enclosing scope", () => {
    const structure = nonlinear(
      section(
        "W",
        '<qti-ordering shuffle="true"/>' +
          section(
            "S",
            limits('max-time="100"') + itemRef("a", limits('max-time="50"')),
            'visible="false" keep-together="false"',
          ),
      ),
    );
    const dissolved = structure.section("S") ?? fail("No S.");
    const item = structure.itemRef("a") ?? fail("No a.");
    expect(timeLimits(dissolved)).toEqual({ allowLateSubmission: false });
    expect(timeLimits(item, { kind: "fixed-minutes", minutes: 1 }).maxTime).toBe(110);
  });

  it("[B36] reads the extra time of a profile: a multiplier, fixed minutes or unlimited time", () => {
    const profile = (children: string): PersonalNeedsProfile => {
      const read = readPnp(`<access-for-all-pnp xmlns="${PNP_NAMESPACE}">${children}</access-for-all-pnp>`);
      return "supports" in read ? read : fail("The document is a bulk file.");
    };
    expect(
      additionalTestingTime(
        profile("<additional-testing-time><time-multiplier>1.5</time-multiplier></additional-testing-time>"),
      ),
    ).toEqual({
      kind: "time-multiplier",
      multiplier: 1.5,
    });
    expect(
      additionalTestingTime(
        profile("<additional-testing-time><fixed-minutes>30</fixed-minutes></additional-testing-time>"),
      ),
    ).toEqual({
      kind: "fixed-minutes",
      minutes: 30,
    });
    expect(additionalTestingTime(profile("<additional-testing-time><unlimited/></additional-testing-time>"))).toEqual({
      kind: "unlimited",
    });
    // The sets of the profile decide only whether the support is prohibited (BPIG §5.3).
    const option =
      "<additional-testing-time><unlimited/></additional-testing-time><activate-as-option-set><additional-testing-time/></activate-as-option-set>";
    expect(additionalTestingTime(profile(option))).toEqual({ kind: "unlimited" });
    const prohibited =
      "<additional-testing-time><unlimited/></additional-testing-time><prohibit-set><additional-testing-time/></prohibit-set>";
    expect(additionalTestingTime(profile(prohibited))).toBeUndefined();
    expect(additionalTestingTime(profile("<spoken/>"))).toBeUndefined();
    expect(additionalTestingTime(profile(""))).toBeUndefined();
  });

  it("[B36] refuses a node and extra time of other types, and a multiplier that is not positive", () => {
    const item = nonlinear(section("S", refs("a"))).itemRef("a") ?? fail("No a.");
    expect(() => timeLimits(json("null"))).toThrow("The node must be an object from resolveStructure, found null.");
    expect(() => timeLimits(item, json("null"))).toThrow("The extra testing time must be an object, found null.");
    expect(() => timeLimits(item, json('{"kind":"double"}'))).toThrow(
      'The kind of the extra testing time must be "time-multiplier", "fixed-minutes" or "unlimited", found "double".',
    );
    expect(() => timeLimits(item, json('{"kind":"time-multiplier","multiplier":"2"}'))).toThrow(
      'The multiplier of the extra testing time must be a finite number, found "2".',
    );
    expect(() => timeLimits(item, { kind: "time-multiplier", multiplier: 0 })).toThrow(
      "The multiplier of the extra testing time must be positive, found 0.",
    );
    expect(() => timeLimits(item, json('{"kind":"fixed-minutes","minutes":-1}'))).toThrow(
      "The minutes of the extra testing time must be a non-negative number, found -1.",
    );
    expect(() => additionalTestingTime(json("null"))).toThrow(DataError);
  });
});

/** A child of a generated section: an item reference or a section with children of its own. */
interface Shape {
  readonly kind: "item" | "section";
  readonly required: boolean;
  readonly fixed: boolean;
  readonly visible: boolean;
  readonly keepTogether: boolean;
  readonly shuffle: boolean;
  readonly selects: boolean;
  readonly withReplacement: boolean;
  /** Where in the range of valid selections the number to select lies. */
  readonly fraction: number;
  /** How many draws a selection with replacement makes beyond the required children. */
  readonly extra: number;
  readonly children: readonly Shape[];
}

const flags = {
  required: fc.boolean(),
  fixed: fc.boolean(),
  visible: fc.boolean(),
  keepTogether: fc.boolean(),
  shuffle: fc.boolean(),
  selects: fc.boolean(),
  withReplacement: fc.boolean(),
  fraction: fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true }),
  extra: fc.integer({ min: 0, max: 3 }),
};

/** Sections that nest, with children up to four and a depth up to three. */
const sections = fc.letrec<{ child: Shape; section: Shape }>((tie) => ({
  child: fc.oneof(
    { maxDepth: 3, depthSize: "small" },
    fc.record({ ...flags, kind: fc.constant("item" as const), children: fc.constant([]) }),
    tie("section"),
  ),
  section: fc.record({
    ...flags,
    kind: fc.constant("section" as const),
    children: fc.array(tie("child"), { maxLength: 4 }),
  }),
})).section;

/** A generated shape with the identifier it is rendered with. */
interface Named extends Shape {
  readonly id: string;
  readonly children: readonly Named[];
}

/** Gives the shapes identifiers in document order: n0 for the root, n1 for its first child, and so on. */
function name(shape: Shape, counter = { next: 0 }): Named {
  const id = `n${counter.next++}`;
  return { ...shape, id, children: shape.children.map((child) => name(child, counter)) };
}

/** The XML of a named section or item reference. */
function render(shape: Named): string {
  const marks = ` required="${shape.required}" fixed="${shape.fixed}"`;
  if (shape.kind === "item") return itemRef(shape.id, "", marks);
  const required = shape.children.filter((child) => child.required).length;
  const select = shape.withReplacement
    ? required + shape.extra
    : required + Math.floor(shape.fraction * (shape.children.length - required + 1));
  const selection =
    shape.selects && shape.children.length > 0
      ? `<qti-selection select="${select}"${shape.withReplacement ? ' with-replacement="true"' : ""}/>`
      : "";
  const ordering = shape.shuffle ? '<qti-ordering shuffle="true"/>' : "";
  return section(
    shape.id,
    selection + ordering + shape.children.map(render).join(""),
    `visible="${shape.visible}" keep-together="${shape.keepTogether}"${marks}`,
  );
}

const seeds = fc.integer({ min: 1, max: 1_000_000 });

/** The identifiers of the planned items and sections, in presentation order. */
function planned(children: readonly PlannedChild[]): { items: ItemKey[]; sections: [string, number][] } {
  const found: { items: ItemKey[]; sections: [string, number][] } = { items: [], sections: [] };
  for (const child of children) {
    if (child.kind === "item") {
      found.items.push(child.key);
    } else {
      found.sections.push([child.identifier, child.instance]);
      const inner = planned(child.children);
      found.items.push(...inner.items);
      found.sections.push(...inner.sections);
    }
  }
  return found;
}

describe("properties", () => {
  /** A section of items only: each with marks, and a selection and ordering. */
  const flat = fc.record({
    children: fc.array(fc.record({ required: fc.boolean(), fixed: fc.boolean() }), { minLength: 1, maxLength: 8 }),
    mode: fc.constantFrom("all", "without", "with"),
    fraction: flags.fraction,
    extra: fc.integer({ min: 0, max: 6 }),
    seed: seeds,
  });

  type Flat = typeof flat extends fc.Arbitrary<infer T> ? T : never;

  function flatStructure(value: Flat, shuffle: boolean): { structure: TestStructure; select: number } {
    const { children } = value;
    const required = children.filter((child) => child.required).length;
    const select =
      value.mode === "with"
        ? required + value.extra
        : required + Math.floor(value.fraction * (children.length - required + 1));
    const selection =
      value.mode === "all"
        ? ""
        : `<qti-selection select="${select}"${value.mode === "with" ? ' with-replacement="true"' : ""}/>`;
    const items = children.map((child, place) =>
      itemRef(`c${place}`, "", ` required="${child.required}" fixed="${child.fixed}"`),
    );
    const ordering = `<qti-ordering shuffle="${shuffle}"/>`;
    return { structure: nonlinear(section("S", selection + ordering + items.join(""))), select };
  }

  const refsOf = (testPlan: TestPlan): string[] => planItems(testPlan).map((key) => key.ref);

  it("[B21][B22] selects the number asked for, every required child, and repeats a child only with replacement", () => {
    fc.assert(
      fc.property(flat, (value) => {
        const { structure, select } = flatStructure(value, false);
        const chosen = refsOf(plan(structure, value.seed));
        const count = value.mode === "all" ? value.children.length : select;
        expect(chosen).toHaveLength(count);
        value.children.forEach((child, place) => {
          const times = chosen.filter((ref) => ref === `c${place}`).length;
          if (child.required) expect(times).toBeGreaterThanOrEqual(1);
          if (value.mode !== "with") expect(times).toBeLessThanOrEqual(1);
        });
        // Selection never reorders: without ordering the children keep document order.
        const places = chosen.map((ref) => Number(ref.slice(1)));
        expect(places).toEqual([...places].sort((a, b) => a - b));
      }),
    );
  });

  it("[B23] permutes the selected children and keeps the fixed ones in their places", () => {
    fc.assert(
      fc.property(flat, (value) => {
        const before = refsOf(plan(flatStructure(value, false).structure, value.seed));
        const after = refsOf(plan(flatStructure(value, true).structure, value.seed));
        // Ordering draws after selection, so the same seed selects the same children.
        expect([...after].sort()).toEqual([...before].sort());
        before.forEach((ref, place) => {
          if (value.children[Number(ref.slice(1))]?.fixed) expect(after[place]).toBe(ref);
        });
      }),
    );
  });

  it("[B23] shuffles every permutation of three children with equal probability", () => {
    const structure = nonlinear(section("S", `<qti-ordering shuffle="true"/>${refs("a", "b", "c")}`));
    const orders = tally(3600, (seed) => itemsOf(plan(structure, seed)).join(""), [
      "abc",
      "acb",
      "bac",
      "bca",
      "cab",
      "cba",
    ]);
    expect(chiSquare(orders)).toBeLessThan(CHI_SQUARE_CRITICAL[5]);
  });

  it("[B21][B22][B23][B24][E11] numbers the instances in order of presentation, and plans no section that is mixed in", () => {
    fc.assert(
      fc.property(sections, seeds, (shape, seed) => {
        const structure = nonlinear(render(name(shape)));
        const found = planned(plan(structure, seed).parts.flatMap((entry) => entry.children));
        const occurrences = [found.items.map((key): [string, number] => [key.ref, key.instance]), found.sections];
        for (const kind of occurrences) {
          const counts = new Map<string, number>();
          for (const [identifier, instance] of kind) {
            counts.set(identifier, (counts.get(identifier) ?? 0) + 1);
            expect(instance).toBe(counts.get(identifier));
          }
        }
        for (const [identifier] of found.sections) expect(structure.section(identifier)?.dissolved).toBe(false);
        for (const key of found.items) expect(structure.itemRef(key.ref)).toBeDefined();
      }),
      { numRuns: 300 },
    );
  });

  it("[B21][B22] keeps the required items of the section among its children, shuffled or not", () => {
    fc.assert(
      fc.property(sections, seeds, (shape, seed) => {
        const root = name(shape);
        const [top] = plan(nonlinear(render(root)), seed).parts.flatMap((entry) => entry.children);
        const direct = (top?.children ?? []).flatMap((child) => (child.kind === "item" ? [child.key.ref] : []));
        for (const child of root.children)
          if (child.kind === "item" && child.required) expect(direct).toContain(child.id);
      }),
    );
  });

  it("[E3] plans the same for the same seed, and replays exactly from a restored generator state", () => {
    fc.assert(
      fc.property(sections, seeds, (shape, seed) => {
        const structure = nonlinear(render(name(shape)));
        expect(plan(structure, seed)).toEqual(plan(structure, seed));
        const random = createRandom(seed);
        const state = random.state();
        const first = planWith(structure, random);
        const replayed = restoreRandom(state);
        expect(planWith(structure, replayed)).toEqual(first);
        expect(replayed.state()).toEqual(random.state());
        // The plan is plain data: it survives JSON unchanged.
        expect(JSON.parse(JSON.stringify(first))).toEqual(first);
      }),
    );
  });

  /** A linear test part for the walk: sections of items, with pre-conditions and branch rules to later items. */
  interface Condition {
    readonly pre: "none" | "go" | "no-go";
  }
  interface Jump {
    readonly offset: number;
    readonly when: "go" | "no-go";
  }
  interface NavItem extends Condition {
    readonly jump: Jump | undefined;
  }
  interface NavSection extends Condition {
    readonly items: readonly NavItem[];
  }

  const condition = fc.constantFrom<Condition["pre"]>("none", "go", "no-go");
  const navigation = fc.array(
    fc.record({
      pre: condition,
      items: fc.array(
        fc.record({
          pre: condition,
          jump: fc.option(fc.record({ offset: fc.nat(20), when: fc.constantFrom<Jump["when"]>("go", "no-go") }), {
            nil: undefined,
          }),
        }),
        { minLength: 1, maxLength: 4 },
      ),
    }),
    { minLength: 1, maxLength: 4 },
  );

  const preOf = (kind: Condition["pre"]): string => (kind === "none" ? "" : pre(kind === "go" ? GO : NOT_GO));

  /** The structure of generated sections, and what a candidate meets by the rules of INFO §2.8.3 when GO is true. */
  function navigate(shape: readonly NavSection[]): { structure: TestStructure; expected: string[] } {
    const flat = shape.flatMap((entry, place) => entry.items.map((item) => ({ item, section: place })));
    let at = 0;
    const xml = shape.map((entry, place) => {
      const items = entry.items.map((item) => {
        const index = at++;
        const ahead = flat.length - index - 1;
        const jump =
          item.jump === undefined || ahead === 0
            ? ""
            : branch(`i${index + 1 + (item.jump.offset % ahead)}`, item.jump.when === "go" ? GO : NOT_GO);
        return itemRef(`i${index}`, preOf(item.pre) + jump);
      });
      return section(`s${place}`, preOf(entry.pre) + items.join(""));
    });
    // The walk, as the rules say: a false pre-condition skips an item, or the section that holds it; a true branch
    // rule goes to its target, which is entered under the same rules.
    const expected: string[] = [];
    let next = 0;
    while (next < flat.length) {
      const here = flat[next];
      if (here === undefined) break;
      const owner = shape[here.section];
      if (owner?.pre === "no-go") {
        next = flat.findIndex((candidate) => candidate.section > here.section);
        if (next < 0) break;
        continue;
      }
      if (here.item.pre === "no-go") {
        next += 1;
        continue;
      }
      expected.push(`i${next}`);
      const ahead = flat.length - next - 1;
      const jump = here.item.jump;
      next = jump?.when === "go" && ahead > 0 ? next + 1 + (jump.offset % ahead) : next + 1;
    }
    return { structure: linear(...xml), expected };
  }

  it("[B28][B29] follows pre-conditions and branch rules exactly as the rules of a linear part say", () => {
    fc.assert(
      fc.property(navigation, (shape) => {
        const { structure, expected } = navigate(shape);
        expect(walk(structure, plan(structure), GO_TRUE)).toEqual(expected);
      }),
      { numRuns: 300 },
    );
  });

  it("[B26][B29] never moves backward in a linear part, and always ends", () => {
    fc.assert(
      fc.property(navigation, (shape) => {
        const { structure } = navigate(shape);
        const testPlan = plan(structure);
        const order = itemsOf(testPlan);
        const met = walk(structure, testPlan, GO_TRUE).map((shownKey) => order.indexOf(shownKey));
        expect(met).toEqual([...met].sort((a, b) => a - b));
        expect(new Set(met).size).toBe(met.length);
      }),
    );
  });

  const scopeLimits = fc.record({
    min: fc.option(fc.integer({ min: 1, max: 10_000 }), { nil: undefined }),
    max: fc.option(fc.integer({ min: 1, max: 10_000 }), { nil: undefined }),
  });
  const extraTime = fc.option(
    fc.oneof(
      fc.record({
        kind: fc.constant("time-multiplier" as const),
        multiplier: fc.double({ min: 0.1, max: 4, noNaN: true }),
      }),
      fc.record({ kind: fc.constant("fixed-minutes" as const), minutes: fc.integer({ min: 0, max: 600 }) }),
      fc.constant({ kind: "unlimited" as const }),
    ),
    { nil: undefined },
  );

  it("[B35][B36][G41] applies extra time to the maximum times only, by the arithmetic of G41", () => {
    fc.assert(
      fc.property(
        fc.tuple(scopeLimits, scopeLimits, scopeLimits, scopeLimits),
        fc.constantFrom<"linear" | "nonlinear">("linear", "nonlinear"),
        extraTime,
        ([test, partLimits, sectionLimits, item], mode, extra) => {
          const attributes = (declared: { min?: number | undefined; max?: number | undefined }): string =>
            declared.min === undefined && declared.max === undefined
              ? ""
              : limits(
                  [
                    declared.min === undefined ? "" : `min-time="${declared.min}"`,
                    declared.max === undefined ? "" : `max-time="${declared.max}"`,
                  ].join(" "),
                );
          const structure = structureOf(
            attributes(test) +
              part(
                "P",
                section("S", attributes(sectionLimits) + itemRef("a", attributes(item))),
                mode,
                attributes(partLimits),
              ),
          );
          const chain = [test, partLimits, sectionLimits, item];
          const nodes = [
            structure.test,
            structure.part("P") ?? fail("No part."),
            structure.section("S") ?? fail("No section."),
            structure.itemRef("a") ?? fail("No a."),
          ];
          chain.forEach((declared, place) => {
            const enclosed = chain.slice(0, place).some((outer) => outer.max !== undefined);
            const maximum = ((): number | undefined => {
              if (declared.max === undefined || extra === undefined) return declared.max;
              if (extra.kind === "time-multiplier") return declared.max * extra.multiplier;
              if (extra.kind === "fixed-minutes") return enclosed ? declared.max : declared.max + extra.minutes * 60;
              return undefined;
            })();
            const minimum = place >= 2 && mode === "nonlinear" ? undefined : declared.min;
            const node = nodes[place] ?? fail("No node.");
            expect(timeLimits(node, extra)).toEqual({
              ...(minimum === undefined ? {} : { minTime: minimum }),
              ...(maximum === undefined ? {} : { maxTime: maximum }),
              allowLateSubmission: false,
            });
          });
        },
      ),
    );
  });

  it("[B30] lets the nearest level that sets an attribute decide, and the default when none does", () => {
    const level = fc.record({
      showFeedback: fc.option(fc.boolean(), { nil: undefined }),
      allowReview: fc.option(fc.boolean(), { nil: undefined }),
      maxAttempts: fc.option(fc.integer({ min: 0, max: 5 }), { nil: undefined }),
    });
    const control = (value: {
      showFeedback?: boolean | undefined;
      allowReview?: boolean | undefined;
      maxAttempts?: number | undefined;
    }): string => {
      const attributes = [
        value.showFeedback === undefined ? "" : `show-feedback="${value.showFeedback}"`,
        value.allowReview === undefined ? "" : `allow-review="${value.allowReview}"`,
        value.maxAttempts === undefined ? "" : `max-attempts="${value.maxAttempts}"`,
      ].filter((attribute) => attribute !== "");
      return attributes.length === 0 ? "" : `<qti-item-session-control ${attributes.join(" ")}/>`;
    };
    fc.assert(
      fc.property(fc.tuple(level, level, level), ([top, middle, bottom]) => {
        const structure = structureOf(
          part("P", section("S", control(middle) + itemRef("a", control(bottom))), "linear", control(top)),
        );
        const effective = sessionControl(structure.itemRef("a") ?? fail("No a."));
        const nearest = <T>(read: (value: typeof top) => T | undefined, fallback: T): T =>
          read(bottom) ?? read(middle) ?? read(top) ?? fallback;
        expect(effective.showFeedback).toBe(nearest((value) => value.showFeedback, false));
        expect(effective.allowReview).toBe(nearest((value) => value.allowReview, true));
        expect(effective.maxAttempts).toBe(nearest((value) => value.maxAttempts, undefined));
      }),
    );
  });
});
