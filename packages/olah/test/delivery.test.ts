import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { itemSessionFromJson, itemSessionToJson } from "../src/delivery/item-session-json.js";
import {
  ASI_NAMESPACE,
  type AssessmentItem,
  type AssessmentSection,
  type AssessmentTest,
  additionalTestingTime,
  ancestry,
  applyItemAction,
  closeItem,
  container,
  createRandom,
  DataError,
  DEFAULT_PLAN_LIMITS,
  type DeliveryEvent,
  type EffectiveSessionControl,
  type ItemAction,
  type ItemKey,
  type ItemSession,
  type ItemSessionContext,
  type ItemSessionView,
  type ItemStep,
  itemFeedback,
  itemResponses,
  nextItem,
  type PersonalNeedsProfile,
  type PlannedChild,
  PNP_NAMESPACE,
  ProcessingError,
  partOf,
  planItems,
  planTest,
  presentItem,
  previousItem,
  type Random,
  type Refusal,
  type RuleContext,
  readAsi,
  readPnp,
  record,
  resolveStructure,
  restoreRandom,
  resultStatus,
  runOutcomeProcessing,
  SecurityError,
  type SingleValue,
  sessionControl,
  single,
  standaloneSessionControl,
  startItemSession,
  suspendItem,
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

/** An item of the ASI namespace, from its attributes and content. */
function itemOf(attributes: string, content: string): AssessmentItem {
  const document = readAsi(
    `<qti-assessment-item xmlns="${ASI_NAMESPACE}" identifier="item" title="Item" ${attributes}>${content}</qti-assessment-item>`,
  );
  return document.kind === "item" ? document.item : fail(`Expected an item, found ${document.kind}.`);
}

const CHOICES = `<qti-simple-choice identifier="A">A</qti-simple-choice><qti-simple-choice identifier="B">B</qti-simple-choice><qti-simple-choice identifier="C">C</qti-simple-choice>`;

/**
 * An item that counts its response processing runs in `RUNS`, scores 1 for the correct response `B`, and has a hint: an
 * end attempt interaction bound to `HINT`. An adaptive one completes when the response is correct.
 */
function counterItem(options: { adaptive?: boolean; countAttempt?: boolean; defaults?: string } = {}): AssessmentItem {
  const { adaptive = false, countAttempt, defaults = "" } = options;
  const counted = countAttempt === undefined ? "" : ` count-attempt="${countAttempt}"`;
  const completion = adaptive
    ? `<qti-set-outcome-value identifier="completionStatus"><qti-base-value base-type="identifier">completed</qti-base-value></qti-set-outcome-value>`
    : "";
  return itemOf(
    `adaptive="${adaptive}" time-dependent="false"`,
    `<qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier">${defaults}
      <qti-correct-response><qti-value>B</qti-value></qti-correct-response>
    </qti-response-declaration>
    <qti-response-declaration identifier="HINT" cardinality="single" base-type="boolean">
      <qti-default-value><qti-value>true</qti-value></qti-default-value>
    </qti-response-declaration>
    <qti-outcome-declaration identifier="RUNS" cardinality="single" base-type="integer"/>
    <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"/>
    <qti-outcome-declaration identifier="FEEDBACK" cardinality="single" base-type="identifier">
      <qti-default-value><qti-value>none</qti-value></qti-default-value>
    </qti-outcome-declaration>
    <qti-item-body>
      <qti-choice-interaction response-identifier="RESPONSE" max-choices="1">${CHOICES}</qti-choice-interaction>
      <p><qti-end-attempt-interaction response-identifier="HINT" title="Hint"${counted}/></p>
      <qti-feedback-block outcome-identifier="FEEDBACK" identifier="hint" show-hide="show"><qti-content-body><p>Think of B.</p></qti-content-body></qti-feedback-block>
    </qti-item-body>
    <qti-response-processing>
      <qti-set-outcome-value identifier="RUNS"><qti-sum><qti-variable identifier="RUNS"/><qti-base-value base-type="integer">1</qti-base-value></qti-sum></qti-set-outcome-value>
      <qti-response-condition>
        <qti-response-if><qti-variable identifier="HINT"/>
          <qti-set-outcome-value identifier="FEEDBACK"><qti-base-value base-type="identifier">hint</qti-base-value></qti-set-outcome-value>
        </qti-response-if>
      </qti-response-condition>
      <qti-response-condition>
        <qti-response-if><qti-match><qti-variable identifier="RESPONSE"/><qti-correct identifier="RESPONSE"/></qti-match>
          <qti-set-outcome-value identifier="SCORE"><qti-base-value base-type="float">1</qti-base-value></qti-set-outcome-value>
          ${completion}
        </qti-response-if>
      </qti-response-condition>
    </qti-response-processing>`,
  );
}

/** The item session control of INFO §7.19 with its defaults, and the attributes given. */
function controlWith(attributes: Partial<EffectiveSessionControl> = {}): EffectiveSessionControl {
  return {
    showFeedback: false,
    allowReview: true,
    showSolution: false,
    allowComment: false,
    allowSkipping: true,
    validateResponses: false,
    ...attributes,
  };
}

function contextOf(
  item: AssessmentItem,
  attributes: Partial<EffectiveSessionControl> = {},
  random: Random = createRandom(1),
): ItemSessionContext {
  return { item, control: controlWith(attributes), random };
}

const KEY: ItemKey = { ref: "q", instance: 1 };

/** The session and events of an accepted step. */
function accepted(step: ItemStep): { readonly session: ItemSession; readonly events: readonly DeliveryEvent[] } {
  return step.ok ? step : fail(`The step was refused: ${step.refusal.code}: ${step.refusal.message}`);
}

/** The refusal of a step that is refused. */
function refused(step: ItemStep): Refusal {
  return step.ok ? fail("The step was accepted.") : step.refusal;
}

/** A session of the context, started and presented at the time given. */
function presented(context: ItemSessionContext, at = 0): ItemSession {
  const started = accepted(startItemSession(KEY, at, context)).session;
  return accepted(presentItem(started, at, context)).session;
}

/** Applies an action at a time: by default 1 millisecond after the latest change of the session. */
function act(
  session: ItemSession,
  context: ItemSessionContext,
  action: ItemAction,
  at = session.updatedAt + 1,
): ItemStep {
  return applyItemAction(session, { ...action, at }, context);
}

/** Applies actions in order and returns the last session; each must be accepted. */
function acts(session: ItemSession, context: ItemSessionContext, ...actions: ItemAction[]): ItemSession {
  return actions.reduce((current, action) => accepted(act(current, context, action)).session, session);
}

const respond = (identifier: string, value: Value | null): ItemAction => ({
  type: "set-responses",
  item: KEY,
  responses: new Map([[identifier, value]]),
});
const SUBMIT: ItemAction = { type: "submit", item: KEY };
const SKIP: ItemAction = { type: "skip", item: KEY };
const HINT: ItemAction = { type: "end-attempt", item: KEY, interaction: "HINT" };
const NEXT: ItemAction = { type: "next-attempt", item: KEY };

const outcome = (session: ItemSession, name: string): Value | null => session.variables.outcomes.get(name) ?? null;
const response = (session: ItemSession, name: string): Value | null => session.variables.responses.get(name) ?? null;
const attempts = (session: ItemSession): Value | null => response(session, "numAttempts");
const integer = (value: number): SingleValue => single("integer", value);
const float = (value: number): SingleValue => single("float", value);
const text = (value: string): SingleValue => single("string", value) ?? fail("A string value cannot be empty.");

describe("applyItemAction", () => {
  const DefaultA = "<qti-default-value><qti-value>A</qti-value></qti-default-value>";

  it("[B96][B3] keeps the drafts apart from the submitted responses until the attempt ends", () => {
    const context = contextOf(counterItem({ defaults: DefaultA }));
    const session = presented(context);
    expect(attempts(session)).toEqual(integer(1));
    const answered = acts(session, context, respond("RESPONSE", identifier("B")));
    expect(answered.drafts.get("RESPONSE")).toEqual(identifier("B"));
    expect(response(answered, "RESPONSE")).toEqual(identifier("A"));
    expect(outcome(answered, "SCORE")).toEqual(float(0));
    const submitted = acts(answered, context, SUBMIT);
    expect(response(submitted, "RESPONSE")).toEqual(identifier("B"));
    expect(outcome(submitted, "SCORE")).toEqual(float(1));
    expect(attempts(submitted)).toEqual(integer(1));
  });

  it("[B8][B31] closes a non-adaptive item after one attempt when no control sets max-attempts", () => {
    const context = contextOf(counterItem());
    const step = accepted(
      act(acts(presented(context), context, respond("RESPONSE", identifier("A"))), context, SUBMIT),
    );
    expect(step.session.status).toBe("closed");
    expect(step.events.map(({ type, detail }) => [type, detail])).toEqual([
      ["attempt-ended", "submit"],
      ["response-processed", undefined],
    ]);
    expect(refused(act(step.session, context, respond("RESPONSE", identifier("B"))))).toMatchObject({
      code: "item-closed",
      source: "INFO §2.2.1",
    });
    expect(refused(act(step.session, context, SUBMIT)).code).toBe("item-closed");
    expect(refused(act(step.session, context, HINT)).code).toBe("item-closed");
    expect(refused(act(step.session, context, NEXT)).code).toBe("attempts-exhausted");
  });

  it("[B8][B31] resets the outcomes of a non-adaptive item before each response processing and keeps the last", () => {
    const context = contextOf(counterItem(), { maxAttempts: 2 });
    const first = acts(presented(context), context, respond("RESPONSE", identifier("B")), SUBMIT);
    expect([first.status, first.attempting]).toEqual(["interacting", false]);
    expect([outcome(first, "RUNS"), outcome(first, "SCORE")]).toEqual([integer(1), float(1)]);
    const second = acts(first, context, respond("RESPONSE", identifier("A")), SUBMIT);
    expect(attempts(second)).toEqual(integer(2));
    expect([outcome(second, "RUNS"), outcome(second, "SCORE")]).toEqual([integer(1), float(0)]);
    expect(second.status).toBe("closed");
  });

  it("[B31] allows any number of attempts when max-attempts is 0", () => {
    const context = contextOf(counterItem(), { maxAttempts: 0 });
    const session = acts(presented(context), context, SUBMIT, SUBMIT, SUBMIT, SUBMIT, SUBMIT);
    expect([session.status, session.countedAttempts]).toEqual(["interacting", 5]);
    expect(attempts(session)).toEqual(integer(5));
  });

  it("[B9][E10] keeps the outcomes of an adaptive item between attempts, ignores max-attempts and closes it at completion", () => {
    const context = contextOf(counterItem({ adaptive: true }), { maxAttempts: 1 });
    const wrong = acts(
      presented(context),
      context,
      respond("RESPONSE", identifier("A")),
      SUBMIT,
      respond("RESPONSE", identifier("C")),
      SUBMIT,
    );
    expect([wrong.status, outcome(wrong, "RUNS"), outcome(wrong, "completionStatus")]).toEqual([
      "interacting",
      integer(2),
      identifier("unknown"),
    ]);
    const right = acts(wrong, context, respond("RESPONSE", identifier("B")), SUBMIT);
    expect([right.status, outcome(right, "RUNS"), outcome(right, "completionStatus")]).toEqual([
      "closed",
      integer(3),
      identifier("completed"),
    ]);
    expect(attempts(right)).toEqual(integer(3));
    expect(refused(act(right, context, NEXT)).code).toBe("attempts-exhausted");
  });

  it("[B3] starts the next attempt with next-attempt, or with the next action on the item, and once only", () => {
    const context = contextOf(counterItem(), { maxAttempts: 0 });
    const ended = acts(presented(context), context, SUBMIT);
    expect([ended.attempting, attempts(ended)]).toEqual([false, integer(1)]);
    const next = acts(ended, context, NEXT);
    expect([next.attempting, attempts(next)]).toEqual([true, integer(2)]);
    expect(act(next, context, NEXT)).toEqual({ ok: true, session: next, events: [] });
    const answered = acts(ended, context, respond("RESPONSE", identifier("B")));
    expect([answered.attempting, attempts(answered)]).toEqual([true, integer(2)]);
    expect(answered.drafts.get("RESPONSE")).toEqual(identifier("B"));
  });

  it("[B10][G16] sets the variable of an end attempt interaction to true when it ends the attempt and false otherwise, ignoring its default", () => {
    const context = contextOf(counterItem(), { maxAttempts: 0 });
    const session = presented(context);
    expect(response(session, "HINT")).toBeNull();
    const step = accepted(act(session, context, HINT));
    expect(step.events[0]).toEqual({ type: "attempt-ended", at: 1, item: KEY, detail: "end-attempt" });
    expect([response(step.session, "HINT"), outcome(step.session, "FEEDBACK")]).toEqual([
      bool(true),
      identifier("hint"),
    ]);
    const submitted = acts(step.session, context, SUBMIT);
    expect([response(submitted, "HINT"), outcome(submitted, "FEEDBACK")]).toEqual([bool(false), identifier("none")]);
  });

  it("[B10][G16] leaves an attempt that an end attempt interaction with count-attempt false ends out of max-attempts, while numAttempts counts it (D8)", () => {
    const free = contextOf(counterItem({ countAttempt: false }));
    const hinted = acts(presented(free), free, HINT);
    expect([hinted.status, hinted.countedAttempts, attempts(hinted)]).toEqual(["interacting", 0, integer(1)]);
    const done = acts(hinted, free, SUBMIT);
    expect([done.status, done.countedAttempts, attempts(done)]).toEqual(["closed", 1, integer(2)]);
    for (const options of [{}, { countAttempt: true }]) {
      const counted = contextOf(counterItem(options));
      expect(acts(presented(counted), counted, HINT).status).toBe("closed");
    }
  });

  it("[B10] refuses an end attempt that names no end attempt interaction", () => {
    const context = contextOf(counterItem());
    expect(
      refused(act(presented(context), context, { type: "end-attempt", item: KEY, interaction: "RESPONSE" })),
    ).toMatchObject({ code: "invalid-response", source: "INFO §2.4.5" });
  });

  it("[B32] refuses a submission of only NULL or default responses, and a skip, when skipping is not allowed", () => {
    const context = contextOf(counterItem({ defaults: DefaultA }), { allowSkipping: false });
    const session = presented(context);
    expect(refused(act(session, context, SUBMIT))).toMatchObject({
      code: "skipping-not-allowed",
      source: "INFO §7.19.6",
    });
    const defaulted = acts(session, context, respond("RESPONSE", identifier("A")));
    expect(refused(act(defaulted, context, SUBMIT)).code).toBe("skipping-not-allowed");
    expect(refused(act(defaulted, context, SKIP)).code).toBe("skipping-not-allowed");
    expect(acts(defaulted, context, respond("RESPONSE", identifier("C")), SUBMIT).status).toBe("closed");
    expect(acts(session, context, HINT).status).toBe("closed");
  });

  it("[B32] never blocks an item without response variables, and submits NULL responses for a skip", () => {
    const reading = itemOf('time-dependent="false"', "<qti-item-body><p>Read this.</p></qti-item-body>");
    const strict = contextOf(reading, { allowSkipping: false });
    expect(acts(presented(strict), strict, SUBMIT).status).toBe("closed");
    expect(acts(presented(strict), strict, SKIP).status).toBe("closed");
    const context = contextOf(counterItem());
    const step = accepted(act(acts(presented(context), context, respond("RESPONSE", identifier("B"))), context, SKIP));
    expect(step.events[0]?.detail).toBe("skip");
    expect([response(step.session, "RESPONSE"), outcome(step.session, "SCORE")]).toEqual([null, float(0)]);
  });

  it("[B33] refuses a submission with an invalid response of a visible interaction under validate-responses, but not a skip", () => {
    const item = itemOf(
      'time-dependent="false"',
      `<qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier"/>
      <qti-response-declaration identifier="LATER" cardinality="single" base-type="identifier"/>
      <qti-outcome-declaration identifier="STAGE" cardinality="single" base-type="identifier"/>
      <qti-item-body>
        <qti-choice-interaction response-identifier="RESPONSE" min-choices="1" max-choices="1">${CHOICES}</qti-choice-interaction>
        <qti-feedback-block outcome-identifier="STAGE" identifier="two" show-hide="show"><qti-content-body>
          <qti-choice-interaction response-identifier="LATER" min-choices="1" max-choices="1">${CHOICES}</qti-choice-interaction>
        </qti-content-body></qti-feedback-block>
      </qti-item-body>`,
    );
    const context = contextOf(item, { validateResponses: true });
    const session = presented(context);
    expect(refused(act(session, context, SUBMIT))).toMatchObject({
      code: "invalid-response",
      message: 'The responses "RESPONSE" are not valid, and the item session control validates responses.',
      source: "INFO §7.19.7",
    });
    expect(acts(session, context, respond("RESPONSE", identifier("A")), SUBMIT).status).toBe("closed");
    expect(acts(session, context, SKIP).status).toBe("closed");
    expect(acts(session, contextOf(item), SUBMIT).status).toBe("closed");
  });

  it("[B34] lets review, the solution and comments follow the item session control", () => {
    const item = counterItem();
    const review: ItemAction = { type: "review", item: KEY };
    const solution: ItemAction = { type: "solution", item: KEY };
    const comment = (text: string): ItemAction => ({ type: "comment", item: KEY, text });
    const open = contextOf(item, { maxAttempts: 0 });
    expect(refused(act(presented(open), open, review))).toMatchObject({
      code: "review-not-allowed",
      source: "INFO §7.19.3",
    });
    expect(refused(act(presented(open), open, solution))).toMatchObject({
      code: "solution-not-allowed",
      source: "INFO §7.19.4",
    });
    expect(refused(act(presented(open), open, comment("Hard."))).code).toBe("comment-not-allowed");
    const strict = contextOf(item, { allowReview: false });
    const shut = acts(presented(strict), strict, SUBMIT);
    expect(refused(act(shut, strict, review)).code).toBe("review-not-allowed");
    expect(refused(act(shut, strict, solution)).code).toBe("solution-not-allowed");
    const open2 = contextOf(item, { showSolution: true, allowComment: true });
    const commented = acts(presented(open2), open2, comment("Hard."), SUBMIT, comment("Fair, after all."));
    expect(commented.comment).toBe("Fair, after all.");
    const reviewed = acts(commented, open2, review);
    expect(reviewed.status).toBe("review");
    expect(acts(reviewed, open2, solution).status).toBe("solution");
    expect(acts(acts(reviewed, open2, solution), open2, review).status).toBe("review");
  });

  it("[B1][E4] refuses actions on an item not presented or suspended, of another instance, or earlier than the latest change", () => {
    const context = contextOf(counterItem());
    const started = accepted(startItemSession(KEY, 0, context)).session;
    expect(refused(act(started, context, SUBMIT))).toMatchObject({ code: "not-current", source: "INFO §2.2.1" });
    const session = presented(context, 10);
    const suspended = accepted(suspendItem(session, 20)).session;
    expect(refused(act(suspended, context, SUBMIT)).code).toBe("suspended");
    expect(refused(applyItemAction(session, { ...SUBMIT, item: { ref: "q", instance: 2 }, at: 30 }, context))).toEqual({
      code: "unknown-item",
      message: 'The action names the item instance "q" 2, not the instance "q" 1 of the session.',
      source: "INFO §2.2.1",
    });
    expect(refused(act(session, context, SUBMIT, 9))).toEqual({
      code: "clock-regression",
      message: "The step at 9 is earlier than the latest change of the item session at 10.",
      source: "INFO §2.2.2.2",
    });
  });

  it("[E4] refuses a variable the candidate does not set, a value of another type, and an integer beyond the safe integers (D3)", () => {
    const item = itemOf(
      'time-dependent="false"',
      `<qti-response-declaration identifier="N" cardinality="single" base-type="integer"/>
      <qti-response-declaration identifier="X" cardinality="single" base-type="float"/>
      <qti-response-declaration identifier="HINT" cardinality="single" base-type="boolean"/>
      <qti-item-body><p><qti-text-entry-interaction response-identifier="N"/> <qti-text-entry-interaction response-identifier="X"/></p>
        <p><qti-end-attempt-interaction response-identifier="HINT" title="Hint"/></p></qti-item-body>`,
    );
    const context = contextOf(item);
    const session = presented(context);
    for (const [name, value] of [
      ["numAttempts", integer(2)],
      ["HINT", bool(true)],
      ["UNDECLARED", integer(1)],
    ] as const) {
      expect(refused(act(session, context, respond(name, value)))).toMatchObject({
        code: "invalid-response",
        message: `The item has no response variable "${name}" that the candidate sets.`,
      });
    }
    expect(refused(act(session, context, respond("N", float(1.5))))).toEqual({
      code: "invalid-response",
      message: "The response variable N is a single integer, found a single float.",
      source: "INFO §2.2.2.2",
    });
    const huge = json<Value>('{"cardinality": "single", "baseType": "integer", "value": 9007199254740993}');
    expect(refused(act(session, context, respond("N", huge)))).toMatchObject({
      code: "value-out-of-range",
      source: "BIND §2.9",
    });
    expect(acts(session, context, respond("X", integer(2))).drafts.get("X")).toEqual(float(2));
  });

  it("[E29] stores the latest state of each portable custom interaction, and refuses a state for another interaction", () => {
    const item = itemOf(
      'time-dependent="false"',
      `<qti-response-declaration identifier="R" cardinality="single" base-type="string"/>
      <qti-response-declaration identifier="TEXT" cardinality="single" base-type="string"/>
      <qti-item-body><qti-portable-custom-interaction response-identifier="R" custom-interaction-type-identifier="urn:fdc:example.com:pci:graph" module="graph"><qti-interaction-markup><p>Graph</p></qti-interaction-markup></qti-portable-custom-interaction>
        <p><qti-text-entry-interaction response-identifier="TEXT"/></p></qti-item-body>`,
    );
    const context = contextOf(item);
    const states = (state: string, name = "R"): ItemAction => ({
      type: "set-responses",
      item: KEY,
      responses: new Map([["R", single("string", state)]]),
      pciStates: new Map([[name, `{"points":${state}}`]]),
    });
    const session = acts(presented(context), context, states("1"), states("2"));
    expect(session.pciStates).toEqual(new Map([["R", '{"points":2}']]));
    expect(refused(act(session, context, states("3", "TEXT")))).toMatchObject({
      code: "invalid-response",
      source: "BPIG §3.7.12",
    });
    expect(acts(session, context, respond("TEXT", single("string", "x"))).pciStates).toEqual(session.pciStates);
  });

  it("refuses arguments of other types", () => {
    const context = contextOf(counterItem());
    const session = presented(context);
    expect(() => applyItemAction(json("null"), { ...SUBMIT, at: 1 }, context)).toThrow(
      "The item session must be an object from startItemSession, found null.",
    );
    expect(() => applyItemAction(session, json("null"), context)).toThrow(DataError);
    expect(() =>
      applyItemAction(session, json('{"type": "dance", "item": {"ref": "q", "instance": 1}, "at": 1}'), context),
    ).toThrow(
      'The type of the action must be "set-responses", "submit", "skip", "end-attempt", "next-attempt", "review", "solution" or "comment", found "dance".',
    );
    expect(() =>
      applyItemAction(session, json('{"type": "submit", "item": {"ref": "q", "instance": 1}, "at": "1"}'), context),
    ).toThrow('The time must be a finite number, found "1".');
    expect(() =>
      applyItemAction(
        session,
        json('{"type": "set-responses", "item": {"ref": "q", "instance": 1}, "at": 1, "responses": {}}'),
        context,
      ),
    ).toThrow("The responses of set-responses must be a Map from response identifier to value, found an object.");
    expect(() =>
      applyItemAction(session, { ...respond("RESPONSE", json('{"cardinality": "single"}')), at: 1 }, context),
    ).toThrow(DataError);
    expect(() => applyItemAction(session, { ...SUBMIT, at: 1 }, json("null"))).toThrow(DataError);
    expect(() =>
      applyItemAction(session, { ...SUBMIT, at: 1 }, { ...context, control: json('{"showFeedback": "no"}') }),
    ).toThrow('The showFeedback of the item session control must be a boolean, found "no".');
    expect(() => applyItemAction(session, { ...SUBMIT, at: 1 }, { ...context, random: json("{}") })).toThrow(DataError);
  });
});

describe("itemFeedback", () => {
  it("[B31][B16] shows the feedback between attempts, and the body as at the start of the attempt while a non-adaptive attempt is open", () => {
    const item = counterItem();
    const context = contextOf(item, { maxAttempts: 2 });
    const hinted = acts(presented(context), context, HINT);
    expect(itemFeedback(hinted, item, context.control)).toEqual({ outcomes: hinted.variables.outcomes, modal: true });
    const next = acts(hinted, context, NEXT);
    const during = itemFeedback(next, item, context.control);
    expect([during.outcomes.get("FEEDBACK"), during.outcomes.get("RUNS"), during.modal]).toEqual([
      identifier("none"),
      integer(0),
      false,
    ]);
  });

  it("[B9] keeps the feedback of earlier attempts while an attempt of an adaptive item is open", () => {
    const item = counterItem({ adaptive: true });
    const context = contextOf(item);
    const next = acts(presented(context), context, HINT, NEXT);
    const during = itemFeedback(next, item, context.control);
    expect([during.outcomes.get("FEEDBACK"), during.modal]).toEqual([identifier("hint"), false]);
  });

  it("[B95] shows the final outcomes of an adaptive item in review without show-feedback, which decides once it closed", () => {
    const adaptive = counterItem({ adaptive: true });
    const context = contextOf(adaptive, { showSolution: true });
    const closed = acts(presented(context), context, HINT, respond("RESPONSE", identifier("B")), SUBMIT);
    const atClose = itemFeedback(closed, adaptive, context.control);
    expect([atClose.outcomes.get("FEEDBACK"), atClose.outcomes.get("SCORE"), atClose.modal]).toEqual([
      identifier("none"),
      float(0),
      false,
    ]);
    expect(itemFeedback(closed, adaptive, controlWith({ showFeedback: true })).outcomes).toBe(
      closed.variables.outcomes,
    );
    const reviewed = acts(closed, context, { type: "review", item: KEY });
    expect(itemFeedback(reviewed, adaptive, context.control)).toEqual({
      outcomes: reviewed.variables.outcomes,
      modal: true,
    });
    const solved = acts(closed, context, { type: "solution", item: KEY });
    const hidden = itemFeedback(solved, adaptive, controlWith({ allowReview: false, showSolution: true }));
    expect(hidden.outcomes.get("FEEDBACK")).toEqual(identifier("none"));
  });

  it("[B16] reviews a non-adaptive item with its feedback only when show-feedback is true", () => {
    const item = counterItem();
    const context = contextOf(item);
    const reviewed = acts(presented(context), context, HINT, { type: "review", item: KEY });
    expect(itemFeedback(reviewed, item, context.control).outcomes.get("FEEDBACK")).toEqual(identifier("none"));
    expect(itemFeedback(reviewed, item, controlWith({ showFeedback: true })).outcomes.get("FEEDBACK")).toEqual(
      identifier("hint"),
    );
  });

  it("refuses arguments of other types", () => {
    const item = counterItem();
    const session = presented(contextOf(item));
    expect(() => itemFeedback(json("null"), item, controlWith())).toThrow(DataError);
    expect(() => itemFeedback(session, json("null"), controlWith())).toThrow(DataError);
    expect(() => itemFeedback(session, item, json('{"maxAttempts": -1}'))).toThrow(DataError);
  });
});

describe("itemResponses", () => {
  it("[B58] shows the correct responses in the solution state, NULL where none is declared, and keeps the candidate's", () => {
    const context = contextOf(counterItem(), { showSolution: true });
    const answered = acts(presented(context), context, respond("RESPONSE", identifier("A")));
    expect(itemResponses(answered)).toBe(answered.drafts);
    const closed = acts(answered, context, SUBMIT);
    expect(itemResponses(closed)).toEqual(
      new Map([
        ["RESPONSE", identifier("A")],
        ["HINT", bool(false)],
      ]),
    );
    const solved = acts(closed, context, { type: "solution", item: KEY });
    expect(itemResponses(solved)).toEqual(
      new Map([
        ["RESPONSE", identifier("B")],
        ["HINT", null],
      ]),
    );
    expect(response(solved, "RESPONSE")).toEqual(identifier("A"));
    expect(itemResponses(acts(solved, context, { type: "review", item: KEY }))).toEqual(itemResponses(closed));
  });

  it("refuses an argument that is not an item session", () => {
    expect(() => itemResponses(json('{"status": "initial"}'))).toThrow(DataError);
  });
});

describe("startItemSession", () => {
  it("[B6][B7][T18][T19][T20] starts with NULL responses, no attempt, no time, completionStatus not_attempted and the initial outcomes", () => {
    const context = contextOf(
      counterItem({ defaults: "<qti-default-value><qti-value>A</qti-value></qti-default-value>" }),
    );
    const step = accepted(startItemSession(KEY, 100, context));
    expect(step.events).toEqual([]);
    const { session } = step;
    expect([session.status, session.attempting, session.updatedAt, session.since]).toEqual([
      "initial",
      false,
      100,
      null,
    ]);
    expect(session.variables.responses).toEqual(
      new Map([
        ["numAttempts", integer(0)],
        ["duration", single("duration", 0)],
        ["RESPONSE", null],
        ["HINT", null],
      ]),
    );
    expect(session.variables.outcomes).toEqual(
      new Map([
        ["completionStatus", identifier("not_attempted")],
        ["RUNS", integer(0)],
        ["SCORE", float(0)],
        ["FEEDBACK", identifier("none")],
      ]),
    );
    expect(session.drafts).toEqual(
      new Map([
        ["RESPONSE", null],
        ["HINT", null],
      ]),
    );
  });

  const Template = itemOf(
    'time-dependent="false"',
    `<qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="integer"/>
    <qti-outcome-declaration identifier="ECHO" cardinality="single" base-type="integer"/>
    <qti-template-declaration identifier="N" cardinality="single" base-type="integer"/>
    <qti-template-processing><qti-set-template-value identifier="N"><qti-random-integer min="1" max="1000000"/></qti-set-template-value></qti-template-processing>
    <qti-item-body><p><qti-text-entry-interaction response-identifier="RESPONSE"/></p></qti-item-body>
    <qti-response-processing><qti-set-outcome-value identifier="ECHO"><qti-variable identifier="N"/></qti-set-outcome-value></qti-response-processing>`,
  );

  it("[B11][B59] runs template processing once at the start, so that each instance records the values of its own clone", () => {
    const oracle = createRandom(5);
    // qti-random-integer draws an index over the admissible values: 1 + floor(uniform × 1000000) (§2.5).
    const draws = [oracle.uniform(), oracle.uniform()].map((uniform) => 1 + Math.floor(uniform * 1_000_000));
    const random = createRandom(5);
    const context = contextOf(Template, {}, random);
    const first = accepted(startItemSession(KEY, 0, context)).session;
    const second = accepted(startItemSession({ ref: "q", instance: 2 }, 0, context)).session;
    expect([first.variables.templates.get("N"), second.variables.templates.get("N")]).toEqual(draws.map(integer));
    const done = acts(accepted(presentItem(first, 1, context)).session, context, SUBMIT);
    expect([done.variables.templates.get("N"), outcome(done, "ECHO")]).toEqual([
      integer(draws[0] ?? 0),
      integer(draws[0] ?? 0),
    ]);
  });

  it("[T21] sets the context values before template processing, so that template and response processing read QTI_CONTEXT", () => {
    const item = itemOf(
      'time-dependent="false"',
      `<qti-outcome-declaration identifier="WHO" cardinality="single" base-type="string"/>
      <qti-template-declaration identifier="SEEN" cardinality="single" base-type="string"/>
      <qti-template-processing><qti-set-template-value identifier="SEEN"><qti-field-value field-identifier="candidateIdentifier"><qti-variable identifier="QTI_CONTEXT"/></qti-field-value></qti-set-template-value></qti-template-processing>
      <qti-item-body><p>Hello.</p></qti-item-body>
      <qti-response-processing><qti-set-outcome-value identifier="WHO"><qti-field-value field-identifier="candidateIdentifier"><qti-variable identifier="QTI_CONTEXT"/></qti-field-value></qti-set-outcome-value></qti-response-processing>`,
    );
    const context = contextOf(item);
    const contextValues = new Map([["QTI_CONTEXT", record([["candidateIdentifier", text("c-7")]])]]);
    const started = accepted(startItemSession(KEY, 0, context, { contextValues })).session;
    expect(started.variables.templates.get("SEEN")).toEqual(single("string", "c-7"));
    const done = acts(accepted(presentItem(started, 1, context)).session, context, SUBMIT);
    expect(outcome(done, "WHO")).toEqual(single("string", "c-7"));
  });

  it("[E26] keeps the template defaults and reports processing-failed when template processing fails", () => {
    const item = itemOf(
      'time-dependent="false"',
      `<qti-template-declaration identifier="T" cardinality="single" base-type="integer"><qti-default-value><qti-value>7</qti-value></qti-default-value></qti-template-declaration>
      <qti-template-processing><qti-set-template-value identifier="T"><qti-container-size><qti-repeat number-repeats="5"><qti-base-value base-type="integer">1</qti-base-value></qti-repeat></qti-container-size></qti-set-template-value></qti-template-processing>
      <qti-item-body><p>Count.</p></qti-item-body>`,
    );
    const step = accepted(startItemSession(KEY, 3, { ...contextOf(item), limits: { maxContainerSize: 2 } }));
    expect(step.session.variables.templates.get("T")).toEqual(integer(7));
    expect(step.events).toEqual([
      {
        type: "processing-failed",
        at: 3,
        item: KEY,
        detail: "The operator qti-repeat builds a container of 5 values, more than the limit maxContainerSize of 2.",
      },
    ]);
  });

  it("refuses arguments of other types", () => {
    const context = contextOf(counterItem());
    expect(() => startItemSession(json("null"), 0, context)).toThrow(
      "The item instance must be an object with a ref and an instance, found null.",
    );
    expect(() => startItemSession(KEY, json('"0"'), context)).toThrow('The time must be a finite number, found "0".');
    expect(() => startItemSession(KEY, 0, json("null"))).toThrow(DataError);
    expect(() => startItemSession(KEY, 0, { ...context, item: json('{"kind": "assessment-test"}') })).toThrow(
      DataError,
    );
    expect(() => startItemSession(KEY, 0, context, json("null"))).toThrow("The options must be an object, found null.");
    expect(() => startItemSession(KEY, 0, context, { contextValues: json("{}") })).toThrow(DataError);
    expect(() => startItemSession(KEY, 0, context, { contextValues: new Map([["QTI_CONTEXT", integer(1)]]) })).toThrow(
      DataError,
    );
  });
});

describe("presentItem", () => {
  it("[B1][B3][B5][B6][B55] starts the first attempt at the first presentation, with the defaults and completionStatus unknown", () => {
    const context = contextOf(
      counterItem({ defaults: "<qti-default-value><qti-value>A</qti-value></qti-default-value>" }),
    );
    const started = accepted(startItemSession(KEY, 0, context)).session;
    const step = accepted(presentItem(started, 5, context));
    expect(step.events).toEqual([{ type: "presented", at: 5, item: KEY }]);
    const { session } = step;
    expect([session.status, session.attempting, session.since, attempts(session)]).toEqual([
      "interacting",
      true,
      5,
      integer(1),
    ]);
    expect([response(session, "RESPONSE"), response(session, "HINT")]).toEqual([identifier("A"), null]);
    expect(session.drafts).toEqual(
      new Map([
        ["RESPONSE", null],
        ["HINT", null],
      ]),
    );
    expect(outcome(session, "completionStatus")).toEqual(identifier("unknown"));
  });

  it("[B57][B54] draws the order of the choices at the first presentation; an order interaction with a default keeps its order", () => {
    const item = itemOf(
      'time-dependent="false"',
      `<qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier"/>
      <qti-response-declaration identifier="ORDER" cardinality="ordered" base-type="identifier">
        <qti-default-value><qti-value>C</qti-value><qti-value>A</qti-value><qti-value>B</qti-value></qti-default-value>
      </qti-response-declaration>
      <qti-item-body>
        <qti-choice-interaction response-identifier="RESPONSE" shuffle="true" max-choices="1">${CHOICES}</qti-choice-interaction>
        <qti-order-interaction response-identifier="ORDER" shuffle="true">${CHOICES}</qti-order-interaction>
      </qti-item-body>`,
    );
    // Fisher–Yates from the last index: 0 swaps C to the front ([C B A]), then 0 swaps B to it ([B C A]).
    const random = scripted(0, 0);
    const context = contextOf(item, {}, random);
    const session = presented(context);
    expect(session.choiceOrders).toEqual(
      new Map([
        ["RESPONSE", [["B", "C", "A"]]],
        ["ORDER", [["A", "B", "C"]]],
      ]),
    );
    expect(session.drafts.get("ORDER")).toEqual(container("ordered", "identifier", ["C", "A", "B"]));
    const resumed = accepted(presentItem(accepted(suspendItem(session, 1)).session, 2, context)).session;
    expect([resumed.choiceOrders, random.left()]).toEqual([session.choiceOrders, 0]);
  });

  it("[B1] resumes a suspended session without a new attempt, and leaves a presented or closed session as it is", () => {
    const context = contextOf(counterItem());
    const session = presented(context);
    const step = accepted(presentItem(accepted(suspendItem(session, 4)).session, 9, context));
    expect([step.session.status, step.session.since, attempts(step.session), step.events]).toEqual([
      "interacting",
      9,
      integer(1),
      [{ type: "presented", at: 9, item: KEY }],
    ]);
    expect(accepted(presentItem(session, 10, context))).toEqual({ ok: true, session, events: [] });
    const closed = acts(session, context, SUBMIT);
    expect(accepted(presentItem(closed, 10, context)).session).toBe(closed);
    expect(refused(presentItem(session, -1, context)).code).toBe("clock-regression");
  });

  it("refuses arguments of other types", () => {
    const context = contextOf(counterItem());
    const started = accepted(startItemSession(KEY, 0, context)).session;
    expect(() => presentItem(json("[]"), 0, context)).toThrow(DataError);
    expect(() => presentItem(started, Number.NaN, context)).toThrow("The time must be a finite number, found NaN.");
    expect(() => presentItem(started, 0, json("null"))).toThrow(DataError);
  });
});

describe("suspendItem", () => {
  it("[B4][T19][G20] counts the time of the candidate sessions only, truncated to the millisecond", () => {
    const item = itemOf(
      'time-dependent="true"',
      `<qti-outcome-declaration identifier="ELAPSED" cardinality="single" base-type="duration"/>
      <qti-item-body><p>Wait.</p></qti-item-body>
      <qti-response-processing><qti-set-outcome-value identifier="ELAPSED"><qti-variable identifier="duration"/></qti-set-outcome-value></qti-response-processing>`,
    );
    const context = contextOf(item);
    const suspended = accepted(suspendItem(presented(context, 1000), 2500.5)).session;
    expect([suspended.status, suspended.since, suspended.spent]).toEqual(["suspended", null, 1500.5]);
    expect(response(suspended, "duration")).toEqual(single("duration", 1.5));
    const resumed = accepted(presentItem(suspended, 9000, context)).session;
    const done = accepted(act(resumed, context, SUBMIT, 9250.25)).session;
    expect([response(done, "duration"), outcome(done, "ELAPSED")]).toEqual([
      single("duration", 1.75),
      single("duration", 1.75),
    ]);
  });

  it("[B1] leaves a session that is not interacting as it is, and refuses a time earlier than its latest change", () => {
    const context = contextOf(counterItem());
    const started = accepted(startItemSession(KEY, 0, context)).session;
    expect(accepted(suspendItem(started, 1)).session).toBe(started);
    expect(refused(suspendItem(presented(context, 5), 4)).code).toBe("clock-regression");
    expect(() => suspendItem(started, json("null"))).toThrow(DataError);
    expect(() => suspendItem(json("1"), 0)).toThrow(DataError);
  });
});

describe("closeItem", () => {
  it("[B6][B1] closes a session that was never presented without an attempt, so its responses stay NULL", () => {
    const context = contextOf(
      counterItem({ defaults: "<qti-default-value><qti-value>A</qti-value></qti-default-value>" }),
    );
    const step = accepted(closeItem(accepted(startItemSession(KEY, 0, context)).session, 3, context));
    expect([step.session.status, response(step.session, "RESPONSE"), attempts(step.session), step.events]).toEqual([
      "closed",
      null,
      integer(0),
      [],
    ]);
    expect(resultStatus(step.session, context.item)).toBe("initial");
  });

  it("[B1] ends an open attempt with the drafts when it closes, whatever attempts are left", () => {
    const context = contextOf(counterItem(), { maxAttempts: 0 });
    const answered = acts(presented(context), context, respond("RESPONSE", identifier("B")));
    for (const session of [answered, accepted(suspendItem(answered, 5)).session]) {
      const step = accepted(closeItem(session, 6, context));
      expect([step.session.status, response(step.session, "RESPONSE"), outcome(step.session, "SCORE")]).toEqual([
        "closed",
        identifier("B"),
        float(1),
      ]);
      expect(step.events.map(({ type, detail }) => [type, detail])).toEqual([
        ["attempt-ended", "close"],
        ["response-processed", undefined],
      ]);
    }
  });

  it("[B1] closes a session between attempts without processing again", () => {
    const context = contextOf(counterItem(), { maxAttempts: 0 });
    const ended = acts(presented(context), context, SUBMIT);
    const step = accepted(closeItem(ended, 8, context));
    expect([step.session.status, outcome(step.session, "RUNS"), step.session.since, step.events]).toEqual([
      "closed",
      integer(1),
      null,
      [],
    ]);
    expect(accepted(closeItem(step.session, 9, context)).session).toBe(step.session);
  });

  it("refuses arguments of other types", () => {
    const context = contextOf(counterItem());
    expect(() => closeItem(presented(context), 1, json("null"))).toThrow(DataError);
    expect(() => closeItem(json("null"), 1, context)).toThrow(DataError);
  });
});

describe("itemSessionToJson", () => {
  it("[E29][B59] writes a session as JSON that reads back equal", () => {
    const item = itemOf(
      'time-dependent="false"',
      `<qti-response-declaration identifier="R" cardinality="multiple" base-type="pair"/>
      <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"/>
      <qti-template-declaration identifier="N" cardinality="ordered" base-type="integer"/>
      <qti-template-processing><qti-set-template-value identifier="N"><qti-ordered><qti-random-integer min="1" max="9"/><qti-base-value base-type="integer">0</qti-base-value></qti-ordered></qti-set-template-value></qti-template-processing>
      <qti-item-body><qti-portable-custom-interaction response-identifier="R" custom-interaction-type-identifier="urn:fdc:example.com:pci:pairs" module="pairs"><qti-interaction-markup><p>Pairs</p></qti-interaction-markup></qti-portable-custom-interaction></qti-item-body>`,
    );
    const context = contextOf(item, { allowComment: true });
    const session = acts(
      presented(context),
      context,
      {
        type: "set-responses",
        item: KEY,
        responses: new Map([["R", container("multiple", "pair", [["A", "B"]])]]),
        pciStates: new Map([["R", '{"__proto__": 1}']]),
      },
      { type: "comment", item: KEY, text: "Pairs again." },
    );
    const read = itemSessionFromJson(JSON.parse(JSON.stringify(itemSessionToJson(session))));
    expect(read).toEqual(session);
    expect(read.variables.templates.get("N")).toEqual(session.variables.templates.get("N"));
  });

  it("refuses data that is not a session", () => {
    const context = contextOf(counterItem());
    const written = JSON.parse(JSON.stringify(itemSessionToJson(presented(context))));
    expect(() => itemSessionFromJson(null)).toThrow("An item session must be an object, found null.");
    expect(() => itemSessionFromJson({ ...written, status: "paused" })).toThrow(DataError);
    expect(() =>
      itemSessionFromJson({
        ...written,
        drafts: [
          ["RESPONSE", null],
          ["RESPONSE", null],
        ],
      }),
    ).toThrow('The drafts of the item session has the identifier "RESPONSE" twice.');
    expect(() => itemSessionFromJson({ ...written, drafts: [["RESPONSE", { value: 1 }]] })).toThrow(DataError);
    expect(() => itemSessionFromJson({ ...written, pciStates: [["R", 1]] })).toThrow(DataError);
    expect(() => itemSessionFromJson({ ...written, choiceOrders: [["R", "A"]] })).toThrow(DataError);
    expect(() => itemSessionFromJson({ ...written, variables: { ...written.variables, outcomes: {} } })).toThrow(
      DataError,
    );
  });
});

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
      'The limit maxPlanNodes must be a positive integer, found "3".',
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

describe("resultStatus", () => {
  it("[B2] reports initial before the first attempt, pendingSubmission during one, and final after response processing", () => {
    const item = counterItem();
    const context = contextOf(item, { maxAttempts: 2 });
    const started = accepted(startItemSession(KEY, 0, context)).session;
    const session = accepted(presentItem(started, 1, context)).session;
    const ended = acts(session, context, SUBMIT);
    const next = acts(ended, context, NEXT);
    expect(
      [started, session, ended, next, acts(next, context, SUBMIT)].map((each) => resultStatus(each, item)),
    ).toEqual(["initial", "pendingSubmission", "final", "pendingSubmission", "final"]);
    expect(resultStatus(accepted(suspendItem(session, 2)).session, item)).toBe("pendingSubmission");
  });

  it("[B2] reports pendingExternalScoring after response processing of an item with an externally scored outcome", () => {
    const item = itemOf(
      'time-dependent="false"',
      `<qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="string"/>
      <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float" external-scored="human"/>
      <qti-item-body><qti-extended-text-interaction response-identifier="RESPONSE"/></qti-item-body>`,
    );
    const context = contextOf(item);
    const closed = acts(presented(context), context, respond("RESPONSE", single("string", "An essay.")), SUBMIT);
    expect(resultStatus(closed, item)).toBe("pendingExternalScoring");
  });

  /** An item whose response processing fails for the response `X`: it repeats a value beyond `maxContainerSize`. */
  function failingItem(adaptive: boolean): AssessmentItem {
    return itemOf(
      `adaptive="${adaptive}" time-dependent="false"`,
      `<qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier"/>
      <qti-outcome-declaration identifier="STAGE" cardinality="single" base-type="integer"><qti-default-value><qti-value>-1</qti-value></qti-default-value></qti-outcome-declaration>
      <qti-outcome-declaration identifier="SIZE" cardinality="single" base-type="integer"/>
      <qti-item-body><qti-choice-interaction response-identifier="RESPONSE" max-choices="1"><qti-simple-choice identifier="X">X</qti-simple-choice><qti-simple-choice identifier="Y">Y</qti-simple-choice></qti-choice-interaction></qti-item-body>
      <qti-response-processing>
        <qti-set-outcome-value identifier="STAGE"><qti-base-value base-type="integer">1</qti-base-value></qti-set-outcome-value>
        <qti-response-condition><qti-response-if>
          <qti-match><qti-variable identifier="RESPONSE"/><qti-base-value base-type="identifier">X</qti-base-value></qti-match>
          <qti-set-outcome-value identifier="SIZE"><qti-container-size><qti-repeat number-repeats="5"><qti-variable identifier="STAGE"/></qti-repeat></qti-container-size></qti-set-outcome-value>
          <qti-set-outcome-value identifier="STAGE"><qti-base-value base-type="integer">2</qti-base-value></qti-set-outcome-value>
        </qti-response-if></qti-response-condition>
      </qti-response-processing>`,
    );
  }

  it("[B2][E26] reports pendingResponseProcessing when response processing fails, with the outcomes it started from", () => {
    const item = failingItem(false);
    const context: ItemSessionContext = { ...contextOf(item, { maxAttempts: 0 }), limits: { maxContainerSize: 2 } };
    const step = accepted(
      act(acts(presented(context), context, respond("RESPONSE", identifier("X"))), context, SUBMIT),
    );
    expect(step.events.map(({ type }) => type)).toEqual(["attempt-ended", "processing-failed"]);
    expect(step.events[1]?.detail).toBe(
      "The operator qti-repeat builds a container of 5 values, more than the limit maxContainerSize of 2.",
    );
    expect([outcome(step.session, "STAGE"), outcome(step.session, "SIZE")]).toEqual([integer(-1), integer(0)]);
    expect([step.session.processingFailed, resultStatus(step.session, item)]).toEqual([
      true,
      "pendingResponseProcessing",
    ]);
    const recovered = acts(step.session, context, respond("RESPONSE", identifier("Y")), SUBMIT);
    expect([outcome(recovered, "STAGE"), resultStatus(recovered, item)]).toEqual([integer(1), "final"]);
  });

  it("[E26] keeps the outcomes of the earlier attempt of an adaptive item when its response processing fails", () => {
    const item = failingItem(true);
    const context: ItemSessionContext = { ...contextOf(item), limits: { maxContainerSize: 2 } };
    const first = acts(presented(context), context, respond("RESPONSE", identifier("Y")), SUBMIT);
    const failed = acts(first, context, respond("RESPONSE", identifier("X")), SUBMIT);
    expect([outcome(failed, "STAGE"), failed.status, resultStatus(failed, item)]).toEqual([
      integer(1),
      "interacting",
      "pendingResponseProcessing",
    ]);
  });

  it("refuses arguments of other types", () => {
    const item = counterItem();
    expect(() => resultStatus(json("null"), item)).toThrow(DataError);
    expect(() => resultStatus(presented(contextOf(item)), json("null"))).toThrow(DataError);
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
  it("[E12] gives an item delivered alone its feedback and review, and applies the control given to it", () => {
    expect(standaloneSessionControl()).toEqual(controlWith({ showFeedback: true }));
    const given = structureOf(
      part(
        "P",
        section("S", refs("a")),
        "linear",
        '<qti-item-session-control max-attempts="3" show-feedback="false" show-solution="true"/>',
      ),
    ).part("P")?.model.itemSessionControl;
    expect(standaloneSessionControl(given)).toEqual(controlWith({ maxAttempts: 3, showSolution: true }));
    const item = counterItem();
    const context: ItemSessionContext = { item, control: standaloneSessionControl(), random: createRandom(1) };
    const closed = acts(presented(context), context, SUBMIT);
    expect([closed.status, itemFeedback(closed, item, context.control).modal]).toEqual(["closed", true]);
    expect(acts(closed, context, { type: "review", item: KEY }).status).toBe("review");
  });

  it("[E12] refuses a control that is not an item session control", () => {
    expect(() => standaloneSessionControl(json("null"))).toThrow(DataError);
    expect(() => standaloneSessionControl(json('{"kind": "assessment-item"}'))).toThrow(
      'The item session control must be the model of a qti-item-session-control, found the kind "assessment-item".',
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
  /** A move of the candidate or the engine on a session, with the milliseconds since the move before. */
  const sessionMoves = fc.array(
    fc.record({
      move: fc.constantFrom(
        "respond",
        "submit",
        "skip",
        "hint",
        "next",
        "review",
        "solution",
        "comment",
        "suspend",
        "present",
        "close",
      ),
      choice: fc.constantFrom("A", "B", "C", null),
      gap: fc.integer({ min: 0, max: 500 }),
    }),
    { maxLength: 25 },
  );

  type Move = typeof sessionMoves extends fc.Arbitrary<(infer T)[]> ? T : never;

  const sessionControls = fc.record({
    maxAttempts: fc.option(fc.integer({ min: 0, max: 3 }), { nil: undefined }),
    showFeedback: fc.boolean(),
    allowReview: fc.boolean(),
    showSolution: fc.boolean(),
    allowComment: fc.boolean(),
    allowSkipping: fc.boolean(),
    validateResponses: fc.boolean(),
  });

  function step(session: ItemSession, { move, choice }: Move, at: number, context: ItemSessionContext): ItemStep {
    const apply = (action: ItemAction): ItemStep => applyItemAction(session, { ...action, at }, context);
    switch (move) {
      case "respond":
        return apply(respond("RESPONSE", choice === null ? null : identifier(choice)));
      case "submit":
        return apply(SUBMIT);
      case "skip":
        return apply(SKIP);
      case "hint":
        return apply(HINT);
      case "next":
        return apply(NEXT);
      case "review":
      case "solution":
        return apply({ type: move, item: KEY });
      case "comment":
        return apply({ type: "comment", item: KEY, text: `At ${at}.` });
      case "suspend":
        return suspendItem(session, at);
      case "present":
        return presentItem(session, at, context);
      case "close":
        return closeItem(session, at, context);
    }
  }

  /** Runs moves from a presentation at time 0; returns every accepted step. */
  function play(
    context: ItemSessionContext,
    moves: readonly Move[],
  ): { session: ItemSession; events: DeliveryEvent[] } {
    let session = presented(context);
    const events: DeliveryEvent[] = [];
    let at = 0;
    for (const move of moves) {
      at += move.gap;
      const next = step(session, move, at, context);
      if (next.ok) {
        session = next.session;
        events.push(...next.events);
      }
    }
    return { session, events };
  }

  /** A test whose outcome ANSWER is the response of the item `q`. */
  const reading = structureOf(
    `${part("P", section("S", refs("q")))}<qti-outcome-processing><qti-set-outcome-value identifier="ANSWER"><qti-variable identifier="q.RESPONSE"/></qti-set-outcome-value></qti-outcome-processing>`,
  );

  /** What outcome processing of the test reads as the response of `q` in the session. */
  function readByTest(session: ItemSession, item: AssessmentItem): Value | null {
    const view: ItemSessionView = {
      ref: (reading.itemRef("q") ?? fail("No q.")).model,
      item,
      variables: session.variables,
    };
    const scope: TestScope = { itemSessions: () => [view], itemSession: () => view, variable: () => undefined };
    const outcomes = runOutcomeProcessing(reading.test.model, new Map(), scope, { random: createRandom(1) });
    return outcomes.get("ANSWER") ?? null;
  }

  it("[B1][B3][B4][B8][B9][B10][B31][B96][E2] keeps the rules of attempts, outcomes, time and drafts over any sequence of actions", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.option(fc.boolean(), { nil: undefined }),
        sessionControls,
        sessionMoves,
        seeds,
        (adaptive, countAttempt, attributes, moves, seed) => {
          const item = counterItem({ adaptive, ...(countAttempt === undefined ? {} : { countAttempt }) });
          const context = contextOf(item, attributes, createRandom(seed));
          const maxAttempts = adaptive ? 0 : (attributes.maxAttempts ?? 1);
          let session = presented(context);
          let at = 0;
          let spent = 0;
          let submitted: Value | null = null;
          let processed = 0;
          for (const move of moves) {
            const before = JSON.stringify(itemSessionToJson(session));
            const next = step(session, move, at + move.gap, context);
            expect(JSON.stringify(itemSessionToJson(session))).toBe(before);
            if (session.status === "interacting") spent += move.gap;
            at += move.gap;
            if (!next.ok) {
              expect(next.refusal.code).not.toBe("clock-regression");
              continue;
            }
            const after = next.session;
            const types = next.events.map(({ type }) => type);
            const responding = ["respond", "submit", "skip", "hint"].includes(move.move);
            expect(["closed", "review", "solution"].includes(session.status) && responding).toBe(false);
            const count = (each: ItemSession): number => {
              const value = attempts(each);
              return value?.cardinality === "single" ? Number(value.value) : 0;
            };
            expect(count(after) - count(session)).toBeGreaterThanOrEqual(0);
            expect(count(after) - count(session)).toBeLessThanOrEqual(1);
            if (types.includes("attempt-ended")) submitted = after.drafts.get("RESPONSE") ?? null;
            expect(response(after, "RESPONSE")).toEqual(submitted);
            expect(readByTest(after, item)).toEqual(submitted);
            if (types.includes("response-processed")) {
              processed += 1;
              expect(outcome(after, "RUNS")).toEqual(integer(adaptive ? processed : 1));
            }
            if (after.status === "interacting" && maxAttempts > 0)
              expect(after.countedAttempts).toBeLessThan(maxAttempts);
            if (after.status === "interacting" && adaptive) {
              expect(outcome(after, "completionStatus")).not.toEqual(identifier("completed"));
            }
            expect(after.spent + (after.since === null ? 0 : at - after.since)).toBe(spent);
            if (after.since === null)
              expect(response(after, "duration")).toEqual(single("duration", Math.floor(after.spent) / 1000));
            expect(itemSessionFromJson(JSON.parse(JSON.stringify(itemSessionToJson(after))))).toEqual(after);
            session = after;
          }
        },
      ),
    );
  });

  it("[B3][E3] replays a session exactly from the same seed and actions", () => {
    fc.assert(
      fc.property(fc.boolean(), sessionControls, sessionMoves, seeds, (adaptive, attributes, moves, seed) => {
        const item = counterItem({ adaptive });
        const run = (): ReturnType<typeof play> => play(contextOf(item, attributes, createRandom(seed)), moves);
        expect(run()).toEqual(run());
      }),
    );
  });

  it("[E29] keeps any PCI state through the JSON form of the session", () => {
    const item = itemOf(
      'time-dependent="false"',
      `<qti-response-declaration identifier="__proto__" cardinality="single" base-type="string"/>
      <qti-item-body><qti-portable-custom-interaction response-identifier="__proto__" custom-interaction-type-identifier="urn:fdc:example.com:pci:any" module="any"><qti-interaction-markup><p>Any</p></qti-interaction-markup></qti-portable-custom-interaction></qti-item-body>`,
    );
    const context = contextOf(item);
    fc.assert(
      fc.property(fc.string(), (state) => {
        const session = acts(presented(context), context, {
          type: "set-responses",
          item: KEY,
          responses: new Map(),
          pciStates: new Map([["__proto__", state]]),
        });
        const read = itemSessionFromJson(JSON.parse(JSON.stringify(itemSessionToJson(session))));
        expect(read.pciStates.get("__proto__")).toBe(state);
        expect(read).toEqual(session);
      }),
    );
  });
});
