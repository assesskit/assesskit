import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CANDIDATE_ACTION_TYPES, itemSessionFromJson, itemSessionToJson } from "../src/delivery/internal.js";
import {
  type AccessForAllResource,
  type Action,
  ASI_NAMESPACE,
  type AssessmentItem,
  type AssessmentSection,
  type AssessmentTest,
  actionToJson,
  additionalTestingTime,
  ancestry,
  applyItemAction,
  BASE_TYPES,
  type CandidateAction,
  type CandidateView,
  type CatSectionRef,
  closeItem,
  container,
  createEngine,
  createRandom,
  DataError,
  DEFAULT_ACTION_LIMITS,
  DEFAULT_PLAN_LIMITS,
  type DeliveryEvent,
  type DeliveryEventType,
  type DeliveryState,
  deserializeState,
  type EffectiveSessionControl,
  type Engine,
  type EngineOptions,
  type HostAction,
  type ItemAction,
  type ItemKey,
  type ItemSession,
  type ItemSessionContext,
  type ItemSessionControl,
  type ItemSessionView,
  type ItemStep,
  itemFeedback,
  itemResponses,
  type LtiLink,
  nextItem,
  type PersonalNeedsProfile,
  type PlannedChild,
  PNP_NAMESPACE,
  ProcessingError,
  parseCandidateAction,
  partOf,
  planItems,
  planTest,
  presentItem,
  previousItem,
  type Random,
  type Refusal,
  type RefusalCode,
  type ResolvedItem,
  type Resolvers,
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
  type StartOptions,
  type Step,
  type SupportName,
  serializeState,
  sessionControl,
  single,
  stamp,
  standaloneSessionControl,
  startItemSession,
  suspendItem,
  type TestingTime,
  type TestPlan,
  type TestScope,
  type TestStructure,
  timeLimits,
  type Value,
  viewFromJson,
  viewToJson,
} from "../src/index.js";
import { identifier as identifierArbitrary, recordValue, valueArbitrary } from "./arbitraries/values.js";
import { fuzzJson } from "./fuzz.js";
import { runGuideSamples } from "./guide-samples.js";

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

/** The item session control of the information model with its defaults, and the attributes given. */
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

/** A test from its content: declarations, time limits, parts, outcome processing, in the order of the schema. */
function testDocument(content: string): AssessmentTest {
  const document = readAsi(
    `<qti-assessment-test xmlns="${ASI_NAMESPACE}" identifier="T" title="T">${content}</qti-assessment-test>`,
  );
  return document.kind === "test" ? document.test : fail(`Expected a test, found ${document.kind}.`);
}

/** A test part with its modes; `head` holds its pre-conditions, branch rules, item session control and time limits. */
const testPart = (
  id: string,
  sections: string,
  navigation: "linear" | "nonlinear",
  submission: "individual" | "simultaneous" = "individual",
  head = "",
): string =>
  `<qti-test-part identifier="${id}" navigation-mode="${navigation}" submission-mode="${submission}">${head}${sections}</qti-test-part>`;

const outcomeDeclaration = (id: string, baseType: string, defaultValue?: string): string =>
  `<qti-outcome-declaration identifier="${id}" cardinality="single" base-type="${baseType}">${defaultValue === undefined ? "" : `<qti-default-value><qti-value>${defaultValue}</qti-value></qti-default-value>`}</qti-outcome-declaration>`;
const variable = (id: string, attributes = ""): string => `<qti-variable identifier="${id}"${attributes}/>`;
const setOutcome = (id: string, expression: string): string =>
  `<qti-set-outcome-value identifier="${id}">${expression}</qti-set-outcome-value>`;
const outcomeProcessing = (...rules: string[]): string =>
  `<qti-outcome-processing>${rules.join("")}</qti-outcome-processing>`;

/** `TOTAL`, the sum of the `SCORE`s of the items, which outcome processing sets. */
const TOTAL = outcomeDeclaration("TOTAL", "float");
const SUM_SCORES = setOutcome("TOTAL", '<qti-sum><qti-test-variables variable-identifier="SCORE"/></qti-sum>');

/** The resolution of an item reference to an item, without variants. */
const resolution = (item: AssessmentItem, resource = item.identifier): ResolvedItem => ({
  resource,
  deliverable: { kind: "qti", item },
  hazards: [],
  variants: [],
});

/** An engine of a test whose item references name the items given by href; any other href names `counterItem()`. */
function engineOf(
  content: string,
  items: Readonly<Record<string, AssessmentItem | ResolvedItem>> = {},
  options: EngineOptions = {},
  catSections: ReadonlyMap<string, CatSectionRef> = new Map(),
): Engine {
  return createEngine(
    {
      kind: "test",
      test: testDocument(content),
      base: "test.xml",
      catSections,
      resolvers: {
        items: (href) => {
          const named = items[href] ?? counterItem();
          return "deliverable" in named ? named : resolution(named);
        },
        sections: NO_SECTIONS.sections,
        stimuli: () => fail("The test has no stimulus."),
      },
    },
    options,
  );
}

const key = (ref: string, instance = 1): ItemKey => ({ ref, instance });

/** A state and the events of the steps that led to it. */
interface Played {
  readonly state: DeliveryState;
  readonly events: readonly DeliveryEvent[];
}

/** Starts a session with the seed 1 at the time 0, unless the options say otherwise. */
function begun(engine: Engine, options: Partial<StartOptions> = {}): Played {
  const step = engine.start({ seed: 1, at: 0, ...options });
  return step.ok ? step : fail(`The start was refused: ${step.refusal.code}.`);
}

/** Applies actions in order, each of which must be accepted; returns the last state and the events of every step. */
function played(engine: Engine, state: DeliveryState, ...actions: Action[]): Played {
  const events: DeliveryEvent[] = [];
  let current = state;
  for (const action of actions) {
    const step = engine.apply(current, action);
    if (!step.ok)
      fail(`The action ${action.type} at ${action.at} was refused: ${step.refusal.code}: ${step.refusal.message}`);
    current = step.state;
    events.push(...step.events);
  }
  return { state: current, events };
}

/** The refusal of an action, which must be refused. */
function refusalOf(engine: Engine, state: DeliveryState, action: Action): Refusal {
  const step = engine.apply(state, action);
  return step.ok ? fail(`The action ${action.type} was accepted.`) : step.refusal;
}

const answer = (ref: string, choice: string, at: number, instance = 1): Action => ({
  type: "set-responses",
  item: key(ref, instance),
  responses: new Map([["RESPONSE", identifier(choice)]]),
  at,
});
const on = (type: "submit" | "skip", ref: string, at: number, instance = 1): Action => ({
  type,
  item: key(ref, instance),
  at,
});
const moveTo = (to: "next" | "previous" | ItemKey, at: number): Action => ({ type: "move", to, at });

/** The events as text: the type, the item or scope, the detail and the time, such as `time-out S1@10000`. */
const described = (events: readonly DeliveryEvent[]): string[] =>
  events.map((event) => {
    const words = [event.type, event.item === undefined ? event.scope : shown(event.item), event.detail];
    return `${words.filter((word) => word !== undefined).join(" ")}@${event.at}`;
  });

const sessionOf = (state: DeliveryState, ref: string, instance = 1): ItemSession =>
  state.items.find((item) => item.session.key.ref === ref && item.session.key.instance === instance)?.session ??
  fail(`${ref} was not presented.`);
const testOutcome = (state: DeliveryState, name: string): Value | null => state.outcomes.get(name) ?? null;

/** The model of a `qti-item-session-control` with the attributes given. */
const controlModel = (attributes: string): ItemSessionControl =>
  structureOf(part("P", section("S", refs("a")), "linear", `<qti-item-session-control ${attributes}/>`)).part("P")
    ?.model.itemSessionControl ?? fail("The part has no item session control.");

/** A profile from its supports and sets. */
function pnpOf(children: string): PersonalNeedsProfile {
  const read = readPnp(`<access-for-all-pnp xmlns="${PNP_NAMESPACE}">${children}</access-for-all-pnp>`);
  return "supports" in read ? read : fail("The document is a bulk file.");
}

/** An item that declares a template variable `T`, 7 by default, and sets `U` to `T` + 1 in template processing. */
const templated = (): AssessmentItem =>
  itemOf(
    'time-dependent="false"',
    `<qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier"/>
    <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"/>
    <qti-template-declaration identifier="T" cardinality="single" base-type="integer"><qti-default-value><qti-value>7</qti-value></qti-default-value></qti-template-declaration>
    <qti-template-declaration identifier="U" cardinality="single" base-type="integer"/>
    <qti-template-processing><qti-set-template-value identifier="U"><qti-sum>${variable("T")}<qti-base-value base-type="integer">1</qti-base-value></qti-sum></qti-set-template-value></qti-template-processing>
    <qti-item-body><qti-choice-interaction response-identifier="RESPONSE" max-choices="1">${CHOICES}</qti-choice-interaction></qti-item-body>`,
  );

/** The accessibility description of a variant: its hazards and the languages of its adaptation. */
const drd = (hazard: readonly string[], languageOfAdaptation: readonly string[] = []): AccessForAllResource => ({
  accessMode: [],
  accessModeAdapted: [],
  adaptationType: [],
  controlFlexibility: [],
  displayTransformability: [],
  hasAdaptation: [],
  hazard: json(JSON.stringify(hazard)),
  isAdaptationOf: [],
  languageOfAdaptation,
  adaptationDetail: [],
  adaptationMediaType: [],
  apiInteroperable: [],
  educationalLevelOfAdaptation: [],
  isFullAdaptationOf: [],
  isPartialAdaptationOf: [],
  extensions: [],
});

/** An item reference `a` resolved to the item `core` with the hazards given and its variants. */
function withVariants(
  hazards: readonly ("flashing" | "sound")[],
  variants: readonly { readonly resource: string; readonly drd: AccessForAllResource }[],
): ResolvedItem {
  return {
    resource: "core",
    deliverable: { kind: "qti", item: counterItem() },
    hazards,
    variants: variants.map((variant) => ({ ...variant, deliverable: { kind: "qti", item: counterItem() } })),
  };
}

/**
 * A resolver as a host writes it in JavaScript when its documents are in a store: it returns a promise, which the type of
 * a resolver does not allow.
 */
function awaiting<T>(resolver: (href: string, base: string) => T): (href: string, base: string) => T {
  return (href, base) => Promise.resolve(resolver(href, base)) as never;
}

describe("creating an engine", () => {
  it("refuses content that the static checks find an error in, and lists the errors", () => {
    const adaptive = counterItem({ adaptive: true });
    const simultaneous = testPart("P", section("S", refs("a")), "nonlinear", "simultaneous");
    expect(() => engineOf(simultaneous, { "a.xml": adaptive })).toThrow(
      'The test cannot be delivered: the static checks found an error. assesskit/validate/adaptive-simultaneous in test.xml: The item reference "a" names an adaptive item in the test part "P", which submits simultaneously; adaptive items need several attempts and so are not compatible with simultaneous submission.',
    );
    const custom = itemOf(
      'time-dependent="false"',
      `<qti-outcome-declaration identifier="X" cardinality="single" base-type="integer"/>
      <qti-response-processing><qti-set-outcome-value identifier="X"><qti-custom-operator definition="urn:x:count"/></qti-set-outcome-value></qti-response-processing>`,
    );
    const individual = testPart("P", section("S", refs("a")), "nonlinear");
    expect(() => engineOf(individual, { "a.xml": custom })).toThrow(/assesskit\/validate\/custom-operator/);
    const registered = new Map([["urn:x:count", () => integer(1)]]);
    expect(() => engineOf(individual, { "a.xml": custom }, { customOperators: registered })).not.toThrow();
    expect(() => createEngine({ kind: "item", item: custom, base: "x.xml" })).toThrow(
      /^The item cannot be delivered: the static checks found an error\. assesskit\/validate\/custom-operator in x\.xml/,
    );
  });

  it("refuses a resolver that returns a promise, whichever resolver it is", () => {
    const refused = (name: string): string =>
      `The resolver ${name} must return its value synchronously, found a promise.`;
    const stimulus = readAsi(
      `<qti-assessment-stimulus xmlns="${ASI_NAMESPACE}" identifier="passage" title="Passage"><qti-stimulus-body><p>Read</p></qti-stimulus-body></qti-assessment-stimulus>`,
    );
    if (stimulus.kind !== "stimulus") return fail(`Expected a stimulus, found ${stimulus.kind}.`);
    const named = itemOf(
      'time-dependent="false"',
      '<qti-assessment-stimulus-ref identifier="passage" href="passage.xml"/><qti-item-body><p>Q</p></qti-item-body>',
    );
    const resolvers: Resolvers = {
      items: () => resolution(named),
      sections: () => sectionOf(section("S1", refs("a"))),
      stimuli: () => stimulus.stimulus,
    };
    const test = testDocument(
      testPart("P", '<qti-assessment-section-ref identifier="S1" href="s1.xml"/>', "nonlinear"),
    );
    const create = (replaced: Partial<Resolvers>): Engine =>
      createEngine({ kind: "test", test, base: "test.xml", resolvers: { ...resolvers, ...replaced } });
    expect(() => create({})).not.toThrow();
    expect(() => create({ items: awaiting(resolvers.items) })).toThrow(refused("items"));
    expect(() => create({ sections: awaiting(resolvers.sections) })).toThrow(refused("sections"));
    expect(() => create({ stimuli: awaiting(resolvers.stimuli) })).toThrow(refused("stimuli"));
    const alone = (stimuli: Resolvers["stimuli"]): Engine =>
      createEngine({ kind: "item", item: named, base: "item.xml", resolvers: { stimuli } });
    expect(() => alone(resolvers.stimuli)).not.toThrow();
    expect(() => alone(awaiting(resolvers.stimuli))).toThrow(DataError);
    expect(() => alone(awaiting(resolvers.stimuli))).toThrow(refused("stimuli"));
  });

  it("delivers an item alone as one item of a nonlinear part, with its feedback and review shown", () => {
    const engine = createEngine({ kind: "item", item: counterItem(), base: "item.xml" });
    const { state, events } = begun(engine);
    expect(described(events)).toEqual(["section-entered item-section@0", "presented item@0"]);
    const done = played(engine, state, answer("item", "A", 10), on("submit", "item", 20));
    // One attempt for a non-adaptive item, as no control sets max-attempts; review is allowed.
    expect(sessionOf(done.state, "item").status).toBe("closed");
    const reviewed = played(engine, done.state, { type: "review", item: key("item"), at: 30 });
    expect(sessionOf(reviewed.state, "item").status).toBe("review");
    expect(described(played(engine, reviewed.state, { type: "end-test", at: 40 }).events)).toEqual([
      "part-ended item-part@40",
      "test-ended item@40",
    ]);
    // The control given applies, and an adaptive item closes at completion.
    const twice = createEngine({
      kind: "item",
      item: counterItem(),
      base: "item.xml",
      control: controlModel('max-attempts="2"'),
    });
    const first = played(twice, begun(twice).state, answer("item", "A", 10), on("submit", "item", 20));
    expect(sessionOf(first.state, "item").status).toBe("interacting");
    const adaptive = createEngine({ kind: "item", item: counterItem({ adaptive: true }), base: "item.xml" });
    const completed = played(adaptive, begun(adaptive).state, answer("item", "A", 1), on("submit", "item", 2));
    expect(sessionOf(completed.state, "item").status).toBe("interacting");
    const right = played(adaptive, completed.state, answer("item", "B", 3), on("submit", "item", 4));
    expect(sessionOf(right.state, "item").status).toBe("closed");
  });

  it("refuses definitions and options of other types", () => {
    const test = testDocument(testPart("P", section("S", refs("a")), "nonlinear"));
    const resolvers = {
      items: () => resolution(counterItem()),
      sections: NO_SECTIONS.sections,
      stimuli: () => fail("No."),
    };
    expect(() => createEngine(json("null"))).toThrow("The definition must be an object with a kind, found null.");
    expect(() => createEngine(json('{"kind":"exam"}'))).toThrow(
      'The kind of the definition must be "test" or "item", found "exam".',
    );
    expect(() => createEngine({ kind: "test", test: json("{}"), base: "t.xml", resolvers })).toThrow(
      "The test must be the model of a qti-assessment-test, found the kind undefined.",
    );
    expect(() => createEngine({ kind: "test", test, base: json("1"), resolvers })).toThrow(
      "The base must be a string, found 1.",
    );
    expect(() => createEngine({ kind: "test", test, base: "t.xml", resolvers }, json("null"))).toThrow(
      "The options must be an object, found null.",
    );
    expect(() =>
      createEngine({ kind: "test", test, base: "t.xml", resolvers }, { customOperators: json("{}") }),
    ).toThrow("The option customOperators must be a Map from a definition or class to a function, found an object.");
    expect(() =>
      createEngine({ kind: "test", test, base: "t.xml", resolvers }, { limits: json('{"maxPlanNodes":"9"}') }),
    ).toThrow('The limit maxPlanNodes must be a positive integer, found "9".');
    expect(() => createEngine({ kind: "item", item: json("[]"), base: "i.xml" })).toThrow(
      "The item must be an object of the model of qti-assessment-item, found an array.",
    );
    for (const [given, found] of [
      ["null", "null"],
      ["5", "5"],
      ['""', '""'],
    ] as const) {
      expect(() =>
        createEngine({ kind: "test", test, base: "t.xml", resolvers }, { contentVersion: json(given) }),
      ).toThrow(`The option contentVersion must be a non-empty string, found ${found}.`);
    }
  });
});

describe("starting a session", () => {
  const simple = testPart("P", section("S", refs("a", "b")), "linear");

  it("plans the session and presents its first item; a test with no item to present ends at once", () => {
    const engine = engineOf(simple);
    const { state, events } = begun(engine, { at: 5 });
    expect(described(events)).toEqual(["section-entered S@5", "presented a@5"]);
    expect(state.status).toBe("in-progress");
    expect(state.current).toEqual(key("a"));
    expect(planItems(state.plan).map(shown)).toEqual(["a", "b"]);
    const skipped = engineOf(`${OUTCOMES}${testPart("P", section("S", itemRef("a", pre(GO))), "linear")}`);
    const ended = begun(skipped);
    expect(described(ended.events)).toEqual(["test-ended T@0"]);
    expect(ended.state.status).toBe("ended");
    expect(ended.state.current).toBeUndefined();
  });

  it("plans from the seed as planTest does, and stores the generator after the draws of the start", () => {
    const shuffled = testPart(
      "P",
      section("S", `<qti-ordering shuffle="true"/>${refs("a", "b", "c", "d")}`),
      "nonlinear",
    );
    const engine = engineOf(shuffled);
    const structure = resolveStructure(testDocument(shuffled), "test.xml", NO_SECTIONS);
    const orders = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const random = createRandom(seed);
      const plan = planTest(structure, { random });
      const { state } = begun(engine, { seed });
      expect(state.plan).toEqual(plan);
      // The first item shuffles no choices, so the start draws only the plan.
      expect(state.random).toEqual(random.state());
      expect(begun(engine, { seed }).state).toEqual(state);
      orders.add(planItems(state.plan).map(shown).join(" "));
    }
    expect(orders.size).toBeGreaterThan(1);
  });

  it("gives the items not yet presented the context values of their own session, whatever sessions ran before", () => {
    const reader = itemOf(
      'time-dependent="false"',
      '<qti-context-declaration identifier="CITY" cardinality="single" base-type="string"/>',
    );
    const engine = engineOf(
      `${outcomeDeclaration("CITIES", "string").replace('cardinality="single"', 'cardinality="multiple"')}${testPart("P", section("S", refs("a", "b", "c")), "nonlinear")}${outcomeProcessing(
        setOutcome("CITIES", '<qti-test-variables variable-identifier="CITY" base-type="string"/>'),
      )}`,
      { "a.xml": reader, "b.xml": reader, "c.xml": reader },
    );
    const cities = (state: DeliveryState): Value | null => testOutcome(state, "CITIES");
    const many = (...values: string[]): Value => ({ cardinality: "multiple", baseType: "string", values });
    const jakarta = begun(engine, { context: new Map([["CITY", text("Jakarta")]]) }).state;
    const medan = begun(engine, { context: new Map([["CITY", text("Medan")]]) }).state;
    const plain = begun(engine).state;
    expect(cities(played(engine, jakarta, on("submit", "a", 1)).state)).toEqual(many("Jakarta", "Jakarta", "Jakarta"));
    expect(cities(played(engine, medan, on("submit", "a", 1)).state)).toEqual(many("Medan", "Medan", "Medan"));
    expect(cities(played(engine, jakarta, on("submit", "a", 2)).state)).toEqual(many("Jakarta", "Jakarta", "Jakarta"));
    expect(cities(played(engine, plain, on("submit", "a", 1)).state)).toBeNull();
  });

  it("gives the context values to the test and to the items that declare them, and the defaults otherwise", () => {
    const city =
      '<qti-context-declaration identifier="CITY" cardinality="single" base-type="string"><qti-default-value><qti-value>Bandung</qti-value></qti-default-value></qti-context-declaration>';
    const reader = itemOf(
      'time-dependent="false"',
      `<qti-context-declaration identifier="CITY" cardinality="single" base-type="string"/>
      <qti-template-declaration identifier="C" cardinality="single" base-type="string"/>
      <qti-template-processing><qti-set-template-value identifier="C">${variable("CITY")}</qti-set-template-value></qti-template-processing>`,
    );
    const engine = engineOf(
      `${city}${outcomeDeclaration("WHERE", "string")}${testPart("P", section("S", refs("a", "b")), "nonlinear")}${outcomeProcessing(setOutcome("WHERE", variable("CITY")))}`,
      { "a.xml": reader },
    );
    const given = begun(engine, { context: new Map([["CITY", text("Jakarta")]]) });
    expect(sessionOf(given.state, "a").variables.templates.get("C")).toEqual(text("Jakarta"));
    const submitted = played(engine, given.state, on("submit", "a", 1));
    expect(testOutcome(submitted.state, "WHERE")).toEqual(text("Jakarta"));
    // Without a value, the test reads its default, and the item its own, which it does not declare: NULL.
    const plain = begun(engine);
    expect(sessionOf(plain.state, "a").variables.templates.get("C")).toBeNull();
    expect(testOutcome(played(engine, plain.state, on("submit", "a", 1)).state, "WHERE")).toEqual(text("Bandung"));
    expect(() => engine.start({ seed: 1, at: 0, context: new Map([["TOWN", text("Bogor")]]) })).toThrow(
      'The option context gives "TOWN", which neither the test nor its items declare as a context variable.',
    );
    expect(() => engine.start({ seed: 1, at: 0, context: new Map([["CITY", integer(1)]]) })).toThrow(
      "The context variable CITY is a single string, found a single integer.",
    );
  });

  it("takes the supports of the profile, on from the start when active, and the universal ones as options", () => {
    const engine = engineOf(simple);
    const pnp = pnpOf(
      "<line-reader/><activate-as-option-set><dictionary-on-screen/></activate-as-option-set><activate-at-initialization-set><line-reader/></activate-at-initialization-set><prohibit-set><spell-checker-on-screen/></prohibit-set>",
    );
    const { state } = begun(engine, { pnp, universalSupports: ["calculator-on-screen", "spell-checker-on-screen"] });
    expect([...state.supports]).toEqual([
      ["line-reader", { state: "active", active: true, settings: { name: "line-reader", replaceAccessModes: [] } }],
      ["dictionary-on-screen", { state: "option", active: false }],
      ["spell-checker-on-screen", { state: "prohibited", active: false }],
      ["calculator-on-screen", { state: "option", active: false, universal: true }],
    ]);
    expect(state.items[0]?.supports).toEqual(["line-reader"]);
  });

  it("refuses options of other types", () => {
    const engine = engineOf(simple);
    expect(() => engine.start(json("null"))).toThrow("The options must be an object, found null.");
    expect(() => engine.start({ seed: 1.5, at: 0 })).toThrow("A seed must be a safe integer, found 1.5.");
    expect(() => engine.start({ seed: 1, at: json('"0"') })).toThrow(
      'The option at must be a finite number, found "0".',
    );
    expect(() => engine.start({ seed: 1, at: 0, universalSupports: json('["chocolate"]') })).toThrow(
      'A universal support must be a support name, found "chocolate".',
    );
    expect(() => engine.start({ seed: 1, at: 0, context: json("{}") })).toThrow(
      "The option context must be a Map from identifier to value, found an object.",
    );
    expect(() => engine.start({ seed: 1, at: 0, pnp: json("null") })).toThrow(
      "The option pnp must be an object of the model of a PNP, found null.",
    );
  });
});

describe("applying actions", () => {
  const linearAbc = `${TOTAL}${testPart("P", section("S", refs("a", "b", "c")), "linear")}${outcomeProcessing(SUM_SCORES)}`;
  const nonlinearAb = `${TOTAL}${testPart("P", section("S", refs("a", "b")), "nonlinear")}${outcomeProcessing(SUM_SCORES)}`;

  it("moves forward only in a linear part, submitting and closing the item it leaves", () => {
    const engine = engineOf(linearAbc);
    const { state } = begun(engine);
    const left = played(engine, state, answer("a", "B", 10), moveTo("next", 20));
    expect(described(left.events)).toEqual([
      "responses-set a@10",
      "attempt-ended a submit@20",
      "response-processed a@20",
      "outcome-processed T@20",
      "moved b@20",
      "presented b@20",
    ]);
    expect(sessionOf(left.state, "a").status).toBe("closed");
    expect(testOutcome(left.state, "TOTAL")).toEqual(float(1));
    expect(refusalOf(engine, left.state, moveTo("previous", 30)).code).toBe("linear-backward");
    expect(refusalOf(engine, left.state, moveTo(key("a"), 30)).code).toBe("linear-backward");
    expect(refusalOf(engine, state, moveTo(key("c"), 30))).toEqual({
      code: "not-current",
      message: "In a linear test part the candidate moves to the next item only.",
    });
    const atC = played(engine, left.state, moveTo(key("c"), 30));
    expect(atC.state.current).toEqual(key("c"));
    const ended = played(engine, atC.state, moveTo("next", 40));
    expect(described(ended.events)).toEqual([
      "attempt-ended c submit@40",
      "response-processed c@40",
      "outcome-processed T@40",
      "part-ended P@40",
      "test-ended T@40",
    ]);
    expect([ended.state.status, ended.state.current]).toEqual(["ended", undefined]);
    expect(refusalOf(engine, ended.state, moveTo("next", 50))).toEqual({
      code: "ended",
      message: "The test has ended.",
    });
  });

  it("moves freely in a nonlinear part, suspending the item it leaves with its attempt open", () => {
    const engine = engineOf(nonlinearAb);
    const away = played(engine, begun(engine).state, answer("a", "B", 10), moveTo(key("b"), 20));
    expect(described(away.events)).toEqual(["responses-set a@10", "moved b@20", "presented b@20"]);
    const suspended = sessionOf(away.state, "a");
    expect([suspended.status, suspended.attempting, suspended.drafts.get("RESPONSE")]).toEqual([
      "suspended",
      true,
      identifier("B"),
    ]);
    const back = played(engine, away.state, moveTo("previous", 30), on("submit", "a", 40));
    expect(described(back.events).slice(0, 2)).toEqual(["moved a@30", "presented a@30"]);
    expect(testOutcome(back.state, "TOTAL")).toEqual(float(1));
    expect(played(engine, back.state, moveTo(key("a"), 50)).events).toEqual([]);
    expect(refusalOf(engine, back.state, moveTo("previous", 50)).code).toBe("unknown-item");
    expect(refusalOf(engine, back.state, moveTo(key("x"), 50)).code).toBe("unknown-item");
    expect(refusalOf(engine, back.state, answer("b", "A", 50)).code).toBe("not-current");
  });

  it("applies pre-conditions and branch rules as the candidate moves, after outcome processing", () => {
    const content = `${OUTCOMES}${testPart(
      "P",
      section("S", itemRef("a", branch("c", answered("B"))) + refs("b") + itemRef("c", pre(GO)) + refs("d")),
      "linear",
    )}${outcomeProcessing(setOutcome("ANSWER", variable("a.RESPONSE")))}`;
    const engine = engineOf(content);
    const right = played(engine, begun(engine).state, answer("a", "B", 1), moveTo("next", 2));
    // The branch rule reads ANSWER as outcome processing set it after a was submitted, and c's pre-condition is NULL.
    expect(right.state.current).toEqual(key("d"));
    const wrong = played(engine, begun(engine).state, answer("a", "A", 1), moveTo("next", 2));
    expect(wrong.state.current).toEqual(key("b"));
  });

  it("submits the items of a simultaneous part together at its end, then runs outcome processing once", () => {
    const engine = engineOf(
      `${TOTAL}${testPart("P", section("S", refs("a", "b")), "nonlinear", "simultaneous")}${outcomeProcessing(SUM_SCORES)}`,
    );
    const { state } = begun(engine);
    for (const action of [
      on("submit", "a", 1),
      on("skip", "a", 1),
      { type: "end-attempt", item: key("a"), interaction: "HINT", at: 1 } as const,
    ]) {
      expect(refusalOf(engine, state, action)).toEqual({
        code: "wrong-submission-mode",
        message: "The test part submits its items together at its end, so an item is not submitted alone.",
      });
    }
    const ended = played(engine, state, answer("a", "B", 10), moveTo(key("b"), 20), answer("b", "A", 30), {
      type: "end-part",
      at: 40,
    });
    expect(described(ended.events).slice(-7)).toEqual([
      "attempt-ended a close@40",
      "response-processed a@40",
      "attempt-ended b close@40",
      "response-processed b@40",
      "outcome-processed T@40",
      "part-ended P@40",
      "test-ended T@40",
    ]);
    expect(testOutcome(ended.state, "TOTAL")).toEqual(float(1));
  });

  it("submits the items of an adaptive section one by one in a part that submits simultaneously", () => {
    const adaptive =
      '<qti-adaptive-selection><qti-adaptive-engine-ref identifier="e" href="http://example.org/engine"/></qti-adaptive-selection>';
    const engine = engineOf(
      `${TOTAL}${testPart("P", section("A", adaptive + refs("c")) + section("S", refs("b")), "nonlinear", "simultaneous")}${outcomeProcessing(SUM_SCORES)}`,
      {},
      {},
      new Map([["A", { prefix: "http://example.org/engine", sectionIdentifier: "cat-1" }]]),
    );
    // The section A has no items until a stage of its CAT engine is appended to the plan, so the candidate waits for it.
    const { state } = begun(engine);
    expect(state.current).toBeUndefined();
    const request = engine.pending(state).cat[0];
    const staged = played(engine, state, {
      type: "cat-response",
      request: request?.id ?? "",
      response: { sessionIdentifier: "s1", nextItems: { itemIdentifiers: ["c"], stageLength: 1 } },
      at: 0,
    });
    expect(staged.state.current).toEqual(key("c"));
    const atC = played(engine, staged.state, answer("c", "B", 2));
    expect(described(played(engine, atC.state, on("submit", "c", 3)).events)).toEqual([
      "attempt-ended c submit@3",
      "response-processed c@3",
      "outcome-processed T@3",
      "cat-requested A submit-results cat:A:1:2@3",
    ]);
    const atB = played(engine, staged.state, moveTo(key("b"), 1));
    expect(refusalOf(engine, atB.state, on("submit", "b", 2)).code).toBe("wrong-submission-mode");
  });

  it("runs outcome processing after each submission in an individual part, from the outcomes' defaults", () => {
    const count = setOutcome(
      "COUNT",
      `<qti-sum>${variable("COUNT")}<qti-base-value base-type="integer">1</qti-base-value></qti-sum>`,
    );
    const engine = engineOf(
      `${outcomeDeclaration("COUNT", "integer", "10")}${testPart("P", section("S", refs("a", "b")), "nonlinear")}${outcomeProcessing(count)}`,
    );
    const first = played(engine, begun(engine).state, on("submit", "a", 1));
    expect(testOutcome(first.state, "COUNT")).toEqual(integer(11));
    // The outcomes are reset to their defaults before each run, so COUNT does not reach 12.
    const second = played(engine, first.state, moveTo(key("b"), 2), on("submit", "b", 3));
    expect(testOutcome(second.state, "COUNT")).toEqual(integer(11));
    expect(described(second.events).filter((event) => event.startsWith("outcome"))).toEqual(["outcome-processed T@3"]);
  });

  it("reads ITEM.VAR from the instance submitted last, ITEM.n.VAR from the instance n, and never a draft", () => {
    const read = outcomeProcessing(
      setOutcome("ANSWER", variable("q.RESPONSE")),
      setOutcome("FIRST", variable("q.1.RESPONSE")),
      setOutcome("SECOND", variable("q.2.RESPONSE")),
    );
    const engine = engineOf(
      `${OUTCOMES}${outcomeDeclaration("FIRST", "identifier")}${outcomeDeclaration("SECOND", "identifier")}${testPart(
        "P",
        section("S", `<qti-selection select="2" with-replacement="true"/>${refs("q")}`) + section("R", refs("r")),
        "nonlinear",
      )}${read}`,
    );
    const values = (state: DeliveryState): (Value | null)[] =>
      ["ANSWER", "FIRST", "SECOND"].map((name) => testOutcome(state, name));
    const drafted = played(engine, begun(engine).state, answer("q", "A", 1), moveTo(key("r"), 2), on("submit", "r", 3));
    expect(values(drafted.state)).toEqual([null, null, null]);
    const second = played(
      engine,
      drafted.state,
      moveTo(key("q", 2), 4),
      answer("q", "C", 5, 2),
      on("submit", "q", 6, 2),
    );
    expect(values(second.state)).toEqual([identifier("C"), null, identifier("C")]);
    const first = played(engine, second.state, moveTo(key("q", 1), 7), on("submit", "q", 8));
    expect(values(first.state)).toEqual([identifier("A"), identifier("A"), identifier("C")]);
  });

  it("weighs and renames the item variables through the item reference", () => {
    const ref = itemRef(
      "a",
      '<qti-variable-mapping source-identifier="SCORE" target-identifier="POINTS"/><qti-weight identifier="W" value="2"/>',
    );
    const engine = engineOf(
      `${outcomeDeclaration("WEIGHED", "float")}${outcomeDeclaration("MAPPED", "float")}${outcomeDeclaration("SUMMED", "float")}${testPart(
        "P",
        section("S", ref + refs("b")),
        "nonlinear",
      )}${outcomeProcessing(
        setOutcome("WEIGHED", variable("a.POINTS", ' weight-identifier="W"')),
        setOutcome("MAPPED", variable("a.POINTS")),
        setOutcome(
          "SUMMED",
          '<qti-sum><qti-test-variables variable-identifier="POINTS" weight-identifier="W"/></qti-sum>',
        ),
      )}`,
    );
    const { state } = played(engine, begun(engine).state, answer("a", "B", 1), on("submit", "a", 2));
    // SCORE of a is 1 and of b 0; b has no weight W, which is 1, and no mapping, so its POINTS is not read.
    expect(["WEIGHED", "MAPPED", "SUMMED"].map((name) => testOutcome(state, name))).toEqual([
      float(2),
      float(1),
      float(2),
    ]);
  });

  it("evaluates the template defaults of an item reference when the item is first presented", () => {
    const ref = itemRef(
      "b",
      `<qti-template-default template-identifier="T">${variable("LEVEL")}</qti-template-default>`,
    );
    const engine = engineOf(
      `${outcomeDeclaration("LEVEL", "integer")}${testPart("P", section("S", refs("a") + ref + refs("c")), "linear")}${outcomeProcessing(
        setOutcome("LEVEL", `<qti-round>${variable("a.SCORE")}</qti-round>`),
      )}`,
      { "b.xml": templated(), "c.xml": templated() },
    );
    const templates = (state: DeliveryState, ref: string): (Value | null)[] =>
      ["T", "U"].map((name) => sessionOf(state, ref).variables.templates.get(name) ?? null);
    const right = played(engine, begun(engine).state, answer("a", "B", 1), moveTo("next", 2));
    expect(templates(right.state, "b")).toEqual([integer(1), integer(2)]);
    const wrong = played(engine, begun(engine).state, answer("a", "A", 1), moveTo("next", 2));
    expect(templates(wrong.state, "b")).toEqual([integer(0), integer(1)]);
    // c has no template default, so T keeps the default of its declaration.
    expect(templates(played(engine, wrong.state, moveTo("next", 3)).state, "c")).toEqual([integer(7), integer(8)]);
  });

  it("keeps the durations of the test, its parts and sections, without suspended time", () => {
    const durations = ["TD", "PD", "S1D", "S2D"];
    const engine = engineOf(
      `${durations.map((name) => outcomeDeclaration(name, "duration")).join("")}${testPart(
        "P",
        section("S1", refs("a")) + section("S2", refs("b")),
        "linear",
      )}${outcomeProcessing(
        setOutcome("TD", variable("duration")),
        setOutcome("PD", variable("P.duration")),
        setOutcome("S1D", variable("S1.duration")),
        setOutcome("S2D", variable("S2.duration")),
      )}`,
    );
    const seconds = (state: DeliveryState): (Value | null)[] => durations.map((name) => testOutcome(state, name));
    const left = played(engine, begun(engine).state, answer("a", "B", 1_000), moveTo("next", 3_000));
    expect(seconds(left.state)).toEqual([3, 3, 3, 0].map((value) => single("duration", value)));
    const paused = played(engine, left.state, { type: "suspend", at: 4_000 }, { type: "resume", at: 10_000 });
    const ended = played(engine, paused.state, moveTo("next", 12_000));
    // The test ran from 0 to 4 s and from 10 to 12 s; S2 from 3 to 4 s and from 10 to 12 s.
    expect(seconds(ended.state)).toEqual([6, 6, 3, 3].map((value) => single("duration", value)));
    expect(response(sessionOf(ended.state, "b"), "duration")).toEqual(single("duration", 3));
  });

  it("ends an attempt only on an action of the candidate or the end of the test part", () => {
    const engine = engineOf(nonlinearAb);
    const away = played(engine, begun(engine).state, answer("a", "B", 10), moveTo(key("b"), 20));
    expect(away.events.some((event) => event.type === "attempt-ended")).toBe(false);
    const ended = played(engine, away.state, { type: "end-test", at: 30 });
    expect(described(ended.events)).toEqual([
      "attempt-ended a close@30",
      "response-processed a@30",
      "attempt-ended b close@30",
      "response-processed b@30",
      "outcome-processed T@30",
      "part-ended P@30",
      "test-ended T@30",
    ]);
    expect(testOutcome(ended.state, "TOTAL")).toEqual(float(1));
  });

  it("refuses with a code, a message and a source, and returns no state", () => {
    const engine = engineOf(nonlinearAb);
    const { state } = begun(engine);
    const before = serializeState(state);
    const step = engine.apply(state, answer("b", "A", 1));
    expect(step).toEqual({
      ok: false,
      refusal: {
        code: "not-current",
        message: "The action names an item that is not the one presented.",
      },
    });
    expect(refusalOf(engine, state, answer("x", "A", 1))).toEqual({
      code: "unknown-item",
      message: 'The test has no item instance "x" 1.',
    });
    expect(refusalOf(engine, state, { type: "comment", item: key("a"), text: "Hm.", at: 1 }).code).toBe(
      "comment-not-allowed",
    );
    expect(serializeState(state)).toBe(before);
  });

  it("refuses an action stamped before the latest step, and accepts one at the same time", () => {
    const engine = engineOf(nonlinearAb);
    const { state } = played(engine, begun(engine).state, answer("a", "B", 5));
    expect(refusalOf(engine, state, answer("a", "C", 4))).toEqual({
      code: "clock-regression",
      message: "The action at 4 is earlier than the latest step of the session at 5.",
    });
    expect(played(engine, state, answer("a", "C", 5)).state.at).toBe(5);
  });

  /** An engine of a test with `TOTAL`, its own time limits, and the parts given. */
  const timedEngine = (parts: string, testLimits = ""): Engine =>
    engineOf(`${TOTAL}${testLimits}${parts}${outcomeProcessing(SUM_SCORES)}`);

  it("closes an item at its maximum time with the drafts received before it, and moves on", () => {
    const engine = timedEngine(
      testPart("P", section("S", itemRef("a", limits('max-time="10"')) + refs("b")), "linear"),
    );
    const { state } = played(engine, begun(engine).state, answer("a", "B", 5_000));
    // Any action at or after the deadline applies it first, so the answer at 12 s finds a closed.
    expect(refusalOf(engine, state, answer("a", "C", 12_000))).toEqual({
      code: "time-over",
      message: 'The item instance "a" 1 was closed when a maximum time passed.',
    });
    const out = played(engine, state, { type: "time", at: 12_000 });
    expect(described(out.events)).toEqual([
      "time-out a@10000",
      "attempt-ended a close@10000",
      "response-processed a@10000",
      "outcome-processed T@10000",
      "moved b@10000",
      "presented b@10000",
    ]);
    expect([testOutcome(out.state, "TOTAL"), out.state.at, out.state.current]).toEqual([float(1), 12_000, key("b")]);
    expect(refusalOf(engine, out.state, answer("a", "C", 13_000)).code).toBe("time-over");
    // The deadline applies at its time exactly.
    expect(described(played(engine, state, { type: "time", at: 10_000 }).events)[0]).toBe("time-out a@10000");
    expect(played(engine, state, { type: "time", at: 9_999 }).events).toEqual([]);
  });

  it("closes a section, a test part and the test at their maximum times, and goes on after them", () => {
    const sectionOut = timedEngine(
      testPart("P", section("S1", limits('max-time="10"') + refs("a", "b")) + section("S2", refs("c")), "linear"),
    );
    const section1 = played(sectionOut, begun(sectionOut).state, answer("a", "B", 1_000), { type: "time", at: 10_000 });
    expect(described(section1.events)).toEqual([
      "responses-set a@1000",
      "time-out S1@10000",
      "attempt-ended a close@10000",
      "response-processed a@10000",
      "outcome-processed T@10000",
      "section-entered S2@10000",
      "moved c@10000",
      "presented c@10000",
    ]);
    expect(refusalOf(sectionOut, section1.state, answer("b", "B", 11_000)).code).toBe("time-over");
    const partOut = timedEngine(
      testPart("P", section("S", refs("a", "b")), "linear", "individual", limits('max-time="10"')),
    );
    expect(described(played(partOut, begun(partOut).state, { type: "time", at: 10_000 }).events)).toEqual([
      "time-out P@10000",
      "attempt-ended a close@10000",
      "response-processed a@10000",
      "outcome-processed T@10000",
      "part-ended P@10000",
      "test-ended T@10000",
    ]);
    const testOut = timedEngine(testPart("P", section("S", refs("a", "b")), "linear"), limits('max-time="10"'));
    const late = refusalOf(testOut, begun(testOut).state, answer("a", "B", 11_000));
    expect(late).toEqual({
      code: "time-over",
      message: "The test ended when a maximum time passed.",
    });
    const ended = played(testOut, begun(testOut).state, { type: "time", at: 11_000 });
    expect(described(ended.events)[0]).toBe("time-out T@10000");
    expect(refusalOf(testOut, ended.state, answer("a", "B", 12_000)).code).toBe("ended");
  });

  it("leaves a scope open after a maximum time that allows late submission, and marks later submissions", () => {
    const engine = timedEngine(
      testPart(
        "P",
        section("S", itemRef("a", limits('max-time="10" allow-late-submission="true"')) + refs("b")),
        "linear",
      ),
    );
    const passed = played(engine, begun(engine).state, { type: "time", at: 10_000 });
    expect(described(passed.events)).toEqual(["time-limit-passed a@10000"]);
    expect(engine.deadlines(passed.state)).toEqual([]);
    const late = played(engine, passed.state, answer("a", "B", 15_000), moveTo("next", 16_000));
    expect(described(late.events).slice(1, 4)).toEqual([
      "attempt-ended a submit@16000",
      "response-processed a@16000",
      "late-submission a@16000",
    ]);
    expect(testOutcome(late.state, "TOTAL")).toEqual(float(1));
  });

  it("refuses to leave an item, a section, a part or the test before its minimum time", () => {
    const engine = timedEngine(
      testPart(
        "P",
        section("S1", limits('min-time="10"') + itemRef("a", limits('min-time="5"')) + refs("b")) +
          section("S2", refs("c")),
        "linear",
      ),
      limits('min-time="20"'),
    );
    const { state } = begun(engine);
    expect(refusalOf(engine, state, moveTo("next", 3_000))).toEqual({
      code: "min-time-not-reached",
      message: 'The item "a" has a minimum time of 5 s, of which 3 s are spent.',
    });
    const atB = played(engine, state, moveTo("next", 5_000));
    expect(refusalOf(engine, atB.state, moveTo("next", 8_000)).message).toBe(
      'The section "S1" has a minimum time of 10 s, of which 8 s are spent.',
    );
    const atC = played(engine, atB.state, moveTo("next", 10_000));
    expect(refusalOf(engine, atC.state, { type: "end-test", at: 15_000 }).message).toBe(
      'The test "T" has a minimum time of 20 s, of which 15 s are spent.',
    );
    expect(played(engine, atC.state, { type: "end-test", at: 20_000 }).state.status).toBe("ended");
    // In a nonlinear part, items and sections have no minimum time.
    const free = timedEngine(
      testPart("P", section("S", itemRef("a", limits('min-time="5"')) + refs("b")), "nonlinear"),
    );
    expect(played(free, begun(free).state, moveTo("next", 1_000)).state.current).toEqual(key("b"));
  });

  it("suspends the whole session: its item, its time and every action but resume", () => {
    const engine = engineOf(nonlinearAb);
    const paused = played(engine, begun(engine).state, answer("a", "B", 1_000), { type: "suspend", at: 2_000 });
    expect(described(paused.events)).toEqual(["responses-set a@1000", "suspended@2000"]);
    expect([paused.state.status, sessionOf(paused.state, "a").status]).toEqual(["suspended", "suspended"]);
    for (const action of [
      answer("a", "C", 3_000),
      { type: "time", at: 3_000 } as const,
      { type: "suspend", at: 3_000 } as const,
    ]) {
      expect(refusalOf(engine, paused.state, action)).toEqual({
        code: "suspended",
        message: "The candidate session is suspended; it goes on when it is resumed.",
      });
    }
    const resumed = played(engine, paused.state, { type: "resume", at: 9_000 });
    expect(described(resumed.events)).toEqual(["resumed@9000", "presented a@9000"]);
    expect(played(engine, resumed.state, { type: "resume", at: 9_500 }).events).toEqual([]);
    const submitted = played(engine, resumed.state, on("submit", "a", 10_000));
    expect(response(sessionOf(submitted.state, "a"), "duration")).toEqual(single("duration", 3));
  });

  it("turns a support that is an option on and off, and records the supports on while an item is presented", () => {
    const engine = engineOf(nonlinearAb);
    const pnp = pnpOf(
      "<line-reader/><activate-as-option-set><dictionary-on-screen/></activate-as-option-set><activate-at-initialization-set><line-reader/></activate-at-initialization-set><prohibit-set><spell-checker-on-screen/></prohibit-set>",
    );
    const { state } = begun(engine, { pnp, universalSupports: ["calculator-on-screen"] });
    const toggle = (name: SupportName, active: boolean, at: number): Action => ({ type: "support", name, active, at });
    const used = played(
      engine,
      state,
      toggle("dictionary-on-screen", true, 1),
      toggle("dictionary-on-screen", true, 2),
    );
    expect(described(used.events)).toEqual(["support-changed dictionary-on-screen on@1"]);
    expect(used.state.items[0]?.supports).toEqual(["line-reader", "dictionary-on-screen"]);
    const moved = played(
      engine,
      used.state,
      toggle("dictionary-on-screen", false, 3),
      toggle("calculator-on-screen", true, 4),
      moveTo(key("b"), 5),
    );
    expect(described(moved.events).slice(0, 2)).toEqual([
      "support-changed dictionary-on-screen off@3",
      "support-changed calculator-on-screen on@4",
    ]);
    expect(moved.state.items[1]?.supports).toEqual(["line-reader", "calculator-on-screen"]);
    expect(refusalOf(engine, state, toggle("spell-checker-on-screen", true, 1))).toEqual({
      code: "support-not-available",
      message: "The support spell-checker-on-screen is prohibited, so the candidate cannot turn it on or off.",
    });
    expect(refusalOf(engine, state, toggle("line-reader", false, 1)).message).toBe(
      "The support line-reader is active, so the candidate cannot turn it on or off.",
    );
    expect(refusalOf(engine, state, toggle("glossary-on-screen", true, 1)).message).toBe(
      "The support glossary-on-screen is not offered, so the candidate cannot turn it on or off.",
    );
  });

  it("presents the variant that avoids the candidate's hazards and is in the candidate's language", () => {
    const variants = withVariants(
      ["flashing"],
      [
        { resource: "v-id-ID", drd: drd([], ["id-ID"]) },
        { resource: "v-id", drd: drd([], ["id"]) },
        { resource: "v-sound", drd: drd(["sound"], ["en"]) },
      ],
    );
    const engine = engineOf(nonlinearAb, { "a.xml": variants });
    const chosen = (pnp?: PersonalNeedsProfile): (string | undefined)[] => {
      const { state, events } = begun(engine, pnp === undefined ? {} : { pnp });
      return [state.items[0]?.variant, events.find((event) => event.type === "variant-selected")?.detail];
    };
    expect(chosen()).toEqual([undefined, "core"]);
    // The item itself flashes, so the first variant without the hazard is presented.
    expect(chosen(pnpOf("<hazard-avoidance>flashing</hazard-avoidance>"))).toEqual(["v-id-ID", "v-id-ID"]);
    expect(chosen(pnpOf('<item-translation xml:lang="id"/>'))).toEqual(["v-id", "v-id"]);
    expect(chosen(pnpOf('<item-translation xml:lang="ID-id"/>'))).toEqual(["v-id-ID", "v-id-ID"]);
    expect(chosen(pnpOf('<item-translation xml:lang="id-BN"/>'))).toEqual(["v-id-ID", "v-id-ID"]);
    expect(chosen(pnpOf('<item-translation xml:lang="en"/><prohibit-set><item-translation/></prohibit-set>'))).toEqual([
      undefined,
      "core",
    ]);
    const unavoidable = withVariants(["flashing"], [{ resource: "v-flash", drd: drd(["flashing"]) }]);
    const flashing = engineOf(nonlinearAb, { "a.xml": unavoidable });
    const { state, events } = begun(flashing, { pnp: pnpOf("<hazard-avoidance>flashing</hazard-avoidance>") });
    expect(state.items[0]?.variant).toBeUndefined();
    expect(described(events)).toEqual([
      "section-entered S@0",
      "variant-selected a core@0",
      "hazard-unavoidable a flashing@0",
      "presented a@0",
    ]);
  });

  it("turns a failure of outcome processing, of a rule or of a template default into data", () => {
    const small = { limits: { maxContainerSize: 1 } };
    const summed = engineOf(nonlinearAb, {}, small);
    const failed = played(summed, begun(summed).state, answer("a", "B", 1), on("submit", "a", 2));
    expect(described(failed.events).slice(-1)).toEqual([
      "processing-failed T The operator qti-test-variables builds a container of 2 values, more than the limit maxContainerSize of 1.@2",
    ]);
    expect(testOutcome(failed.state, "TOTAL")).toEqual(float(0));
    const blowUp = `<qti-gt><qti-container-size><qti-repeat number-repeats="2"><qti-base-value base-type="integer">1</qti-base-value></qti-repeat></qti-container-size><qti-base-value base-type="integer">0</qti-base-value></qti-gt>`;
    const ruled = engineOf(
      testPart("P", section("S", itemRef("a", branch("EXIT_TEST", blowUp)) + refs("b")), "linear"),
      {},
      small,
    );
    const ended = played(ruled, begun(ruled).state, moveTo("next", 1));
    expect(described(ended.events).slice(-3)).toEqual([
      "processing-failed T The operator qti-repeat builds a container of 2 values, more than the limit maxContainerSize of 1.@1",
      "part-ended P@1",
      "test-ended T@1",
    ]);
    const defaulted = engineOf(
      testPart(
        "P",
        section(
          "S",
          itemRef(
            "a",
            `<qti-template-default template-identifier="T"><qti-container-size><qti-repeat number-repeats="2"><qti-base-value base-type="integer">1</qti-base-value></qti-repeat></qti-container-size></qti-template-default>`,
          ),
        ),
        "linear",
      ),
      { "a.xml": templated() },
      small,
    );
    const { state, events } = begun(defaulted);
    expect(described(events)[1]).toBe(
      "processing-failed a The operator qti-repeat builds a container of 2 values, more than the limit maxContainerSize of 1.@0",
    );
    expect(sessionOf(state, "a").variables.templates.get("T")).toEqual(integer(7));
  });

  it("reports every type of event of a test session, with its time and its item or scope", () => {
    const seen = new Set<string>();
    const note = (events: readonly DeliveryEvent[]): void => {
      for (const event of events) {
        seen.add(event.type);
        expect(
          event.item !== undefined ||
            event.scope !== undefined ||
            ["suspended", "resumed", "support-changed"].includes(event.type),
        ).toBe(true);
      }
    };
    const engine = timedEngine(
      testPart(
        "P",
        section("S", refs("a") + itemRef("b", limits('max-time="10" allow-late-submission="true"')) + refs("c")),
        "linear",
      ),
    );
    const flashing = withVariants(["flashing"], [{ resource: "v", drd: drd(["flashing"]) }]);
    const rich = engineOf(linearAbc, { "a.xml": flashing, "c.xml": templated() }, { limits: { maxContainerSize: 1 } });
    const pnp = pnpOf(
      "<hazard-avoidance>flashing</hazard-avoidance><activate-as-option-set><line-reader/></activate-as-option-set>",
    );
    const start = begun(rich, { pnp });
    note(start.events);
    note(
      played(
        rich,
        start.state,
        { type: "support", name: "line-reader", active: true, at: 1 },
        answer("a", "B", 2),
        { type: "suspend", at: 3 },
        { type: "resume", at: 4 },
        moveTo("next", 5),
      ).events,
    );
    const timedStart = begun(engine);
    note(
      played(
        engine,
        timedStart.state,
        moveTo("next", 1),
        { type: "time", at: 20_000 },
        moveTo("next", 21_000),
        moveTo("next", 22_000),
      ).events,
    );
    const out = timedEngine(testPart("P", section("S", itemRef("a", limits('max-time="1"')) + refs("b")), "linear"));
    note(played(out, begun(out).state, { type: "time", at: 1_000 }).events);
    const all: DeliveryEventType[] = [
      "presented",
      "responses-set",
      "attempt-ended",
      "response-processed",
      "processing-failed",
      "outcome-processed",
      "moved",
      "section-entered",
      "part-ended",
      "test-ended",
      "time-limit-passed",
      "time-out",
      "late-submission",
      "suspended",
      "resumed",
      "support-changed",
      "variant-selected",
      "hazard-unavoidable",
    ];
    expect([...seen].sort()).toEqual([...all].sort());
  });

  it("refuses states and actions of other types", () => {
    const engine = engineOf(nonlinearAb);
    const { state } = begun(engine);
    expect(() => engine.apply(json("null"), moveTo("next", 1))).toThrow(
      "The state must be an object from Engine.start or deserializeState, found null.",
    );
    expect(() => engine.apply(json('{"version":2}'), moveTo("next", 1))).toThrow(
      "The state must have the version 1, found 2.",
    );
    expect(() => engine.apply(state, json("null"))).toThrow(
      "The action must be an object with a type and a time, found null.",
    );
    expect(() => engine.apply(state, json('{"type":"time","at":"1"}'))).toThrow(
      'The time of the action must be a finite number, found "1".',
    );
    expect(() => engine.apply(state, json('{"type":"move","to":"up","at":1}'))).toThrow(
      'The place of move must be "next", "previous" or an item instance, found "up".',
    );
    expect(() => engine.apply(state, json('{"type":"move","to":{"ref":"a"},"at":1}'))).toThrow(
      'The item instance is invalid: missing the property "instance".',
    );
    expect(() => engine.apply(state, json('{"type":"support","name":"chocolate","active":true,"at":1}'))).toThrow(
      'The name of support must be the name of a support of a PNP, found "chocolate".',
    );
    expect(() => engine.apply(state, json('{"type":"support","name":"spoken","active":"yes","at":1}'))).toThrow(
      'The active of support must be a boolean, found "yes".',
    );
    expect(() =>
      engine.apply(state, json('{"type":"set-responses","item":{"ref":"a","instance":1},"responses":{},"at":1}')),
    ).toThrow("The responses of set-responses must be a Map from response identifier to value, found an object.");
    expect(() => engine.apply(state, json('{"type":"jump","at":1}'))).toThrow(
      /^The type of the action must be "set-responses", /,
    );
  });
});

describe("the events of an attempt", () => {
  const threeAttempts = itemRef("a", '<qti-item-session-control max-attempts="3"/>');
  const content = `${TOTAL}${testPart("P", section("S", threeAttempts), "nonlinear")}${outcomeProcessing(SUM_SCORES)}`;
  const nextAttempt = (at: number): Action => ({ type: "next-attempt", item: key("a"), at });

  /** Three attempts, the second after a day that the candidate was away; the times are in milliseconds. */
  function threeTimes(engine: Engine): Played {
    const started = begun(engine);
    return played(
      engine,
      started.state,
      answer("a", "A", 1_000),
      on("submit", "a", 4_000),
      nextAttempt(5_000),
      answer("a", "A", 6_000),
      on("submit", "a", 9_000),
      { type: "suspend", at: 10_000 },
      { type: "resume", at: 86_410_000 },
      nextAttempt(86_411_000),
      answer("a", "B", 86_412_000),
      on("submit", "a", 86_413_000),
    );
  }

  const processed = (events: readonly DeliveryEvent[]): DeliveryEvent[] =>
    events.filter(({ type }) => type === "response-processed");

  it("numbers each attempt from 1 and gives the time of the item so far, leaving out the time it was suspended", () => {
    const { events } = threeTimes(engineOf(content));
    expect(processed(events).map(({ attempt, duration }) => [attempt, duration])).toEqual([
      [1, 4_000],
      [2, 9_000],
      [3, 13_000],
    ]);
  });

  it("holds the time of results, in seconds, after every step that processed responses", () => {
    const engine = engineOf(content);
    let state = begun(engine).state;
    const actions: Action[] = [
      answer("a", "A", 1_500),
      on("submit", "a", 4_250),
      nextAttempt(5_000),
      { type: "suspend", at: 6_000 },
      { type: "resume", at: 70_000 },
      on("skip", "a", 70_999),
    ];
    for (const action of actions) {
      const step = engine.apply(state, action);
      if (!step.ok) return fail(`The action ${action.type} was refused: ${step.refusal.code}.`);
      state = step.state;
      for (const event of processed(step.events)) {
        const result = engine.results(state).itemResults.find(({ identifier }) => identifier === "a");
        const shown = result?.variables.find(({ identifier }) => identifier === "duration");
        const seconds = shown?.kind === "response" ? shown.candidateResponse : null;
        expect(seconds).toEqual(single("duration", (event.duration ?? Number.NaN) / 1_000));
      }
    }
    expect(state.items[0]?.session.countedAttempts).toBe(2);
  });

  it("leaves the outcomes out unless the engine is asked for them, and then gives every outcome of the item as JSON", () => {
    const plain = processed(threeTimes(engineOf(content)).events);
    expect(plain.every((event) => !("outcomes" in event))).toBe(true);
    const engine = engineOf(content, {}, { eventOutcomes: true });
    const events = processed(threeTimes(engine).events);
    expect(events.map((event) => Object.keys(event.outcomes ?? {}).sort())).toEqual(
      [0, 1, 2].map(() => ["FEEDBACK", "RUNS", "SCORE", "completionStatus"]),
    );
    const scores = events.map((event) => event.outcomes?.SCORE);
    const wire = (value: number) => ({ cardinality: "single", baseType: "float", value: { base: { float: value } } });
    expect(scores).toEqual([wire(0), wire(0), wire(1)]);
    expect(events[2]?.outcomes?.RUNS).toEqual({
      cardinality: "single",
      baseType: "integer",
      value: { base: { integer: 1 } },
    });
    // Events are data: they survive JSON as they are, and hold nothing of the session's own objects.
    expect(JSON.parse(JSON.stringify(events))).toEqual(events);
  });

  it("keeps an outcome named __proto__ as data", () => {
    const named = itemOf(
      'time-dependent="false"',
      `<qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier"/>
      <qti-outcome-declaration identifier="__proto__" cardinality="single" base-type="integer">
        <qti-default-value><qti-value>7</qti-value></qti-default-value>
      </qti-outcome-declaration>
      <qti-item-body><qti-choice-interaction response-identifier="RESPONSE" max-choices="1">${CHOICES}</qti-choice-interaction></qti-item-body>`,
    );
    const engine = engineOf(
      testPart("P", section("S", refs("a")), "nonlinear"),
      { "a.xml": named },
      { eventOutcomes: true },
    );
    const { events } = played(engine, begun(engine).state, answer("a", "A", 1), on("submit", "a", 2));
    const outcomes = processed(events)[0]?.outcomes;
    expect(Object.hasOwn(outcomes ?? {}, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(outcomes)).toBe(Object.prototype);
    expect(JSON.parse(JSON.stringify(outcomes))).toEqual(outcomes);
  });

  it("adds attempt and duration to the events of an item session delivered without an engine", () => {
    const context = contextOf(counterItem(), { allowSkipping: true });
    const session = presented(context);
    const events = accepted(
      act(accepted(act(session, context, respond("RESPONSE", identifier("A")), 1_000)).session, context, SUBMIT, 3_500),
    ).events;
    expect(processed(events).map(({ attempt, duration, outcomes }) => [attempt, duration, outcomes])).toEqual([
      [1, 3_500, undefined],
    ]);
    const asked = { ...context, eventOutcomes: true };
    const withOutcomes = accepted(
      act(accepted(act(presented(asked), asked, respond("RESPONSE", identifier("B")), 1)).session, asked, SUBMIT, 2),
    );
    expect(Object.keys(processed(withOutcomes.events)[0]?.outcomes ?? {}).sort()).toEqual([
      "FEEDBACK",
      "RUNS",
      "SCORE",
      "completionStatus",
    ]);
  });

  it("refuses an eventOutcomes option or context field that is not a boolean", () => {
    expect(() => engineOf(content, {}, { eventOutcomes: json("1") })).toThrow(
      "The option eventOutcomes must be a boolean, found 1.",
    );
    expect(() => engineOf(content, {}, { eventOutcomes: json("null") })).toThrow(
      "The option eventOutcomes must be a boolean, found null.",
    );
    const context = contextOf(counterItem());
    expect(() => startItemSession(KEY, 0, { ...context, eventOutcomes: json('"yes"') })).toThrow(
      'The eventOutcomes of the context must be a boolean, found "yes".',
    );
  });
});

describe("a ladder of hints", () => {
  const unlimited = '<qti-item-session-control max-attempts="0" show-solution="true"/>';
  const engineWith = (item: AssessmentItem, control: string): Engine =>
    engineOf(
      `${TOTAL}${testPart("P", section("S", itemRef("a", control)), "nonlinear")}${outcomeProcessing(SUM_SCORES)}`,
      {
        "a.xml": item,
      },
    );
  const hint = (at: number): Action => ({ type: "end-attempt", item: key("a"), interaction: "HINT", at });
  const tryAgain = (at: number): Action => ({ type: "next-attempt", item: key("a"), at });
  const solution = (at: number): Action => ({ type: "solution", item: key("a"), at });
  const runs = (state: DeliveryState): Value | null => sessionOf(state, "a").variables.outcomes.get("RUNS") ?? null;

  it("keeps the outcomes of an adaptive item from one attempt to the next, and resets those of another item", () => {
    for (const [adaptive, expected] of [
      [true, [1, 2, 3]],
      [false, [1, 1, 1]],
    ] as const) {
      const engine = engineWith(counterItem({ adaptive }), unlimited);
      let state = begun(engine).state;
      const seen: (Value | null)[] = [];
      for (const [index, at] of [1_000, 3_000, 5_000].entries()) {
        state = played(engine, state, hint(at), tryAgain(at + 500)).state;
        seen.push(runs(state));
        expect(sessionOf(state, "a").countedAttempts).toBe(index + 1);
      }
      expect(seen).toEqual(expected.map(integer));
    }
  });

  it("closes an adaptive item when response processing completes it, and then allows the solution", () => {
    const engine = engineWith(counterItem({ adaptive: true }), unlimited);
    const asking = played(engine, begun(engine).state, hint(1_000), tryAgain(1_500), hint(2_000), tryAgain(2_500));
    expect(refusalOf(engine, asking.state, solution(3_000)).code).toBe("solution-not-allowed");
    const done = played(engine, asking.state, answer("a", "B", 3_000), on("submit", "a", 4_000));
    expect(sessionOf(done.state, "a").status).toBe("closed");
    expect(outcome(sessionOf(done.state, "a"), "completionStatus")).toEqual(identifier("completed"));
    expect(sessionOf(played(engine, done.state, solution(5_000)).state, "a").status).toBe("solution");
  });

  it("never closes a non-adaptive item with unlimited attempts, so that its solution stays out of reach", () => {
    const engine = engineWith(counterItem(), unlimited);
    let state = begun(engine).state;
    for (let round = 0; round < 5; round += 1) {
      const at = 1_000 * (round + 1);
      state = played(engine, state, answer("a", "B", at), on("submit", "a", at + 100), tryAgain(at + 200)).state;
    }
    expect(sessionOf(state, "a").status).toBe("interacting");
    expect(sessionOf(state, "a").countedAttempts).toBe(5);
    expect(refusalOf(engine, state, solution(9_000))).toEqual({
      code: "solution-not-allowed",
      message: "The item shows its solution only after its session closed.",
    });
  });
});

describe("deadlines", () => {
  it("gives the maximum and minimum times that run as absolute times, with extra time and without suspended time", () => {
    const content = `<qti-time-limits max-time="60"/>${testPart(
      "P",
      section("S", itemRef("a", '<qti-time-limits max-time="20"/>') + refs("b")),
      "linear",
      "individual",
      '<qti-time-limits min-time="10"/>',
    )}`;
    const engine = engineOf(content);
    const { state } = begun(engine, { at: 1_000 });
    expect(engine.deadlines(state)).toEqual([
      { scope: "test", identifier: "T", kind: "max-time", at: 61_000, lateSubmission: false },
      { scope: "part", identifier: "P", kind: "min-time", at: 11_000, lateSubmission: false },
      { scope: "item", identifier: "a", kind: "max-time", at: 21_000, lateSubmission: false },
    ]);
    const extended = begun(engine, {
      at: 1_000,
      pnp: pnpOf("<additional-testing-time><time-multiplier>1.5</time-multiplier></additional-testing-time>"),
    });
    expect(engine.deadlines(extended.state).map((deadline) => deadline.at)).toEqual([91_000, 11_000, 31_000]);
    const paused = played(engine, state, { type: "suspend", at: 5_000 });
    expect(engine.deadlines(paused.state)).toEqual([]);
    const resumed = played(engine, paused.state, { type: "resume", at: 9_000 });
    expect(engine.deadlines(resumed.state).map((deadline) => deadline.at)).toEqual([65_000, 15_000, 25_000]);
    expect(() => engine.deadlines(json("null"))).toThrow(
      "The state must be an object from Engine.start or deserializeState, found null.",
    );
  });
});

/** What a view must not hold: each string stands for a key, a processing step or a content that is hidden. */
const LEAK = /LEAK-[A-Z-]+/g;

/** The strings of a view, as JSON text, that mark a leak. */
const leaksIn = (view: CandidateView): string[] => [...new Set(JSON.stringify(viewToJson(view)).match(LEAK) ?? [])];

/**
 * An item with everything that a view settles or leaves out: a correct response and a mapping of a text, outcomes and
 * template values that nothing prints, feedback, modal feedback, template content and a choice that the variables hide,
 * and rubric for the candidate and for the scorer. A string with `LEAK-` marks what the candidate must never see.
 */
function leakyItem(): AssessmentItem {
  const content = (text: string): string => `<qti-content-body><p>${text}</p></qti-content-body>`;
  return itemOf(
    'adaptive="false" time-dependent="true" xml:lang="id" label="Question"',
    `<qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier">
      <qti-correct-response><qti-value>B</qti-value></qti-correct-response>
    </qti-response-declaration>
    <qti-response-declaration identifier="TEXT" cardinality="single" base-type="string">
      <qti-correct-response><qti-value>LEAK-CORRECT-TEXT</qti-value></qti-correct-response>
      <qti-mapping default-value="0"><qti-map-entry map-key="LEAK-MAP-KEY" mapped-value="2"/></qti-mapping>
    </qti-response-declaration>
    <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"/>
    <qti-outcome-declaration identifier="FB" cardinality="single" base-type="identifier"><qti-default-value><qti-value>none</qti-value></qti-default-value></qti-outcome-declaration>
    <qti-outcome-declaration identifier="NOTE" cardinality="single" base-type="string"><qti-default-value><qti-value>LEAK-OUTCOME-DEFAULT</qti-value></qti-default-value></qti-outcome-declaration>
    <qti-outcome-declaration identifier="TRIES" cardinality="single" base-type="integer"><qti-default-value><qti-value>3</qti-value></qti-default-value></qti-outcome-declaration>
    <qti-template-declaration identifier="TV" cardinality="single" base-type="identifier"><qti-default-value><qti-value>A</qti-value></qti-default-value></qti-template-declaration>
    <qti-template-declaration identifier="KEPT" cardinality="single" base-type="string"><qti-default-value><qti-value>LEAK-TEMPLATE-DEFAULT</qti-value></qti-default-value></qti-template-declaration>
    <qti-template-processing><qti-set-template-value identifier="KEPT"><qti-base-value base-type="string">LEAK-TEMPLATE-PROCESSING</qti-base-value></qti-set-template-value></qti-template-processing>
    <qti-item-body>
      <p>Count <qti-printed-variable identifier="TRIES"/> times.</p>
      <qti-choice-interaction response-identifier="RESPONSE" max-choices="1" shuffle="true">
        <qti-simple-choice identifier="A">A</qti-simple-choice>
        <qti-simple-choice identifier="B">B</qti-simple-choice>
        <qti-simple-choice identifier="C" template-identifier="TV" show-hide="show">LEAK-HIDDEN-CHOICE</qti-simple-choice>
        <qti-simple-choice identifier="D">D</qti-simple-choice>
      </qti-choice-interaction>
      <p><qti-text-entry-interaction response-identifier="TEXT"/></p>
      <qti-template-block template-identifier="TV" identifier="Z" show-hide="show">${content("LEAK-HIDDEN-TEMPLATE")}</qti-template-block>
      <qti-feedback-block outcome-identifier="FB" identifier="right" show-hide="show">${content("FEEDBACK-OK")}</qti-feedback-block>
      <qti-feedback-block outcome-identifier="FB" identifier="never" show-hide="show">${content("LEAK-HIDDEN-FEEDBACK")}</qti-feedback-block>
      <qti-rubric-block view="candidate" use="instructions">${content("ITEM-RUBRIC-OK")}</qti-rubric-block>
      <qti-rubric-block view="scorer" use="scoring">${content("LEAK-ITEM-RUBRIC-SCORER")}</qti-rubric-block>
    </qti-item-body>
    <qti-response-processing>
      <qti-response-condition>
        <qti-response-if><qti-match><qti-variable identifier="RESPONSE"/><qti-correct identifier="RESPONSE"/></qti-match>
          <qti-set-outcome-value identifier="FB"><qti-base-value base-type="identifier">right</qti-base-value></qti-set-outcome-value>
          <qti-set-outcome-value identifier="SCORE"><qti-base-value base-type="float">1</qti-base-value></qti-set-outcome-value>
        </qti-response-if>
      </qti-response-condition>
      <qti-set-outcome-value identifier="NOTE"><qti-base-value base-type="string">LEAK-OUTCOME-SET</qti-base-value></qti-set-outcome-value>
    </qti-response-processing>
    <qti-modal-feedback outcome-identifier="FB" identifier="right" show-hide="show">${content("MODAL-OK")}</qti-modal-feedback>
    <qti-modal-feedback outcome-identifier="FB" identifier="never" show-hide="show">${content("LEAK-HIDDEN-MODAL")}</qti-modal-feedback>`,
  );
}

/** The text of the nodes of some content, as one string. */
const textOf = (nodes: unknown): string => JSON.stringify(nodes);

const rubricBlock = (view: string, text: string): string =>
  `<qti-rubric-block view="${view}" use="instructions"><qti-content-body><p>${text}</p></qti-content-body></qti-rubric-block>`;
const feedback = (access: "during" | "atEnd", identifier: string, text: string): string =>
  `<qti-test-feedback access="${access}" outcome-identifier="SHOW" show-hide="show" identifier="${identifier}"><qti-content-body><p>${text}</p></qti-content-body></qti-test-feedback>`;
const SHOW = outcomeDeclaration("SHOW", "identifier");
const SET_SHOW = outcomeProcessing(setOutcome("SHOW", '<qti-base-value base-type="identifier">go</qti-base-value>'));
const CONTROL = '<qti-item-session-control show-feedback="true" show-solution="true" allow-comment="true"/>';

/** A test of the leaky item `a` and a plain item `b`, whose solution its own item session control keeps from the candidate. */
function leakyEngine(head = CONTROL): Engine {
  const noSolution =
    '<qti-assessment-item-ref identifier="b" href="b.xml"><qti-item-session-control show-solution="false"/></qti-assessment-item-ref>';
  return engineOf(
    `${SHOW}${rubricBlock("candidate", "TEST-RUBRIC-OK")}${rubricBlock("scorer", "LEAK-TEST-RUBRIC-SCORER")}${testPart(
      "P",
      `${rubricBlock("candidate", "PART-RUBRIC-OK")}${section("S", rubricBlock("candidate", "SECTION-RUBRIC-OK") + rubricBlock("author", "LEAK-SECTION-RUBRIC-AUTHOR") + refs("a") + noSolution)}`,
      "nonlinear",
      "individual",
      head,
    )}${SET_SHOW}${feedback("during", "go", "DURING-OK")}${feedback("atEnd", "go", "AT-END-OK")}${feedback("atEnd", "never", "LEAK-TEST-FEEDBACK")}`,
    { "a.xml": leakyItem() },
  );
}

describe("the view of a state", () => {
  it("names the test and the test part, and maps a nonlinear part with every item and the reach of a move", () => {
    const engine = engineOf(
      testPart(
        "P",
        section("S", refs("a")) + section("U", refs("b"), 'visible="false"') + section("V", refs("c")),
        "nonlinear",
      ),
    );
    const { state } = begun(engine);
    const first = engine.view(state, 0);
    expect([first.status, first.test, first.part]).toEqual([
      "in-progress",
      { identifier: "T", title: "T" },
      { identifier: "P", navigationMode: "nonlinear", submissionMode: "individual" },
    ]);
    // The invisible section U has no entry of its own; its item stands at the depth of the section above.
    expect(first.navigation).toEqual([
      { kind: "section", identifier: "S", title: "S", depth: 0 },
      { kind: "item", key: key("a"), title: "Item", depth: 1, status: "interacting", current: true, reachable: false },
      { kind: "item", key: key("b"), title: "Item", depth: 0, status: "initial", current: false, reachable: true },
      { kind: "section", identifier: "V", title: "V", depth: 0 },
      { kind: "item", key: key("c"), title: "Item", depth: 1, status: "initial", current: false, reachable: true },
    ]);
    const moved = played(engine, state, moveTo(key("c"), 1));
    expect(
      engine
        .view(moved.state, 1)
        .navigation.flatMap((entry) => (entry.kind === "item" ? [[entry.key.ref, entry.status, entry.reachable]] : [])),
    ).toEqual([
      ["a", "suspended", true],
      ["b", "initial", true],
      ["c", "interacting", false],
    ]);
  });

  it("maps a linear part with the items presented so far, none of them reachable", () => {
    const engine = engineOf(testPart("P", section("S", refs("a", "b", "c")), "linear"));
    const { state } = begun(engine);
    const entries = (view: CandidateView): string[] =>
      view.navigation.flatMap((entry) =>
        entry.kind === "item" ? [`${entry.key.ref} ${entry.status} ${entry.current} ${entry.reachable}`] : [],
      );
    expect(entries(engine.view(state, 0))).toEqual(["a interacting true false"]);
    const next = played(engine, state, on("submit", "a", 1), moveTo("next", 2));
    expect(entries(engine.view(next.state, 2))).toEqual(["a closed false false", "b interacting true false"]);
  });

  it("shows the item after resolution: printed variables, feedback, template content, hidden choices and the order of the choices", () => {
    const engine = leakyEngine();
    const { state } = begun(engine, { seed: 3 });
    const item = engine.view(state, 0).current;
    if (item === undefined) return fail("No item.");
    expect([item.key, item.title, item.label, item.language, item.timeDependent]).toEqual([
      key("a"),
      "Item",
      "Question",
      "id",
      true,
    ]);
    const body = textOf(item.body);
    expect(body).toContain("ITEM-RUBRIC-OK");
    expect(body).toContain('"value":"3"');
    for (const hidden of [
      "FEEDBACK-OK",
      "LEAK-HIDDEN-FEEDBACK",
      "LEAK-HIDDEN-TEMPLATE",
      "LEAK-HIDDEN-CHOICE",
      "SCORER",
    ]) {
      expect(body).not.toContain(hidden);
    }
    // The choices stand in the body in the order of the descriptor, which is the order the session drew.
    const [choices] = item.interactions;
    const order = choices?.choices.map(({ identifier }) => identifier) ?? [];
    expect([...order].sort()).toEqual(["A", "B", "D"]);
    expect(order).not.toEqual(["A", "B", "D"]);
    const inBody = [...body.matchAll(/"identifier":"([A-D])","extensions"/g)].map((match) => match[1]);
    expect(inBody).toEqual(order);
    expect(order).toEqual(
      sessionOf(state, "a")
        .choiceOrders.get("RESPONSE")?.[0]
        ?.filter((each) => each !== "C"),
    );
    expect(item.responses).toEqual(
      new Map([
        ["RESPONSE", null],
        ["TEXT", null],
      ]),
    );
    expect([item.numAttempts, item.attemptsLeft, item.modalFeedback, item.status]).toEqual([1, 1, [], "interacting"]);
  });

  it("shows the feedback and the modal feedback only once the outcomes select them, and the submitted responses", () => {
    const engine = leakyEngine();
    const { state } = begun(engine);
    const wrong = played(engine, state, answer("a", "A", 1), on("submit", "a", 2));
    const afterWrong = engine.view(wrong.state, 2).current;
    expect(textOf(afterWrong?.body)).not.toContain("FEEDBACK-OK");
    expect([afterWrong?.status, afterWrong?.modalFeedback, afterWrong?.attemptsLeft]).toEqual(["closed", [], 0]);
    const right = played(engine, state, answer("a", "B", 1), on("submit", "a", 2));
    const afterRight = engine.view(right.state, 2).current;
    expect(textOf(afterRight?.body)).toContain("FEEDBACK-OK");
    expect(textOf(afterRight?.modalFeedback)).toContain("MODAL-OK");
    expect(afterRight?.responses.get("RESPONSE")).toEqual(identifier("B"));
    expect(leaksIn(engine.view(right.state, 2))).toEqual([]);
  });

  it("shows the drafts while the attempt is open, and the stored states of portable custom interactions", () => {
    const item = itemOf(
      'time-dependent="false"',
      `<qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="string"/>
      <qti-context-declaration identifier="LANG" cardinality="single" base-type="string"><qti-default-value><qti-value>id</qti-value></qti-default-value></qti-context-declaration>
      <qti-template-declaration identifier="TV" cardinality="single" base-type="integer"><qti-default-value><qti-value>7</qti-value></qti-default-value></qti-template-declaration>
      <qti-item-body><qti-portable-custom-interaction response-identifier="RESPONSE" custom-interaction-type-identifier="urn:fdc:example.com:pci:any" module="any"><qti-interaction-markup><p>Any</p></qti-interaction-markup><qti-template-variable template-identifier="TV"/><qti-context-variable identifier="LANG"/></qti-portable-custom-interaction></qti-item-body>`,
    );
    const engine = engineOf(testPart("P", section("S", refs("a")), "nonlinear"), { "a.xml": item });
    const { state } = begun(engine);
    const before = engine.view(state, 0).current?.pci;
    expect(before).toEqual(
      new Map([
        ["RESPONSE", { templateValues: new Map([["TV", integer(7)]]), contextValues: new Map([["LANG", text("id")]]) }],
      ]),
    );
    const set = played(engine, state, {
      type: "set-responses",
      item: key("a"),
      responses: new Map([["RESPONSE", text("draft")]]),
      pciStates: new Map([["RESPONSE", '{"strokes":[1,2]}']]),
      at: 1,
    });
    const after = engine.view(set.state, 1).current;
    expect(after?.responses).toEqual(new Map([["RESPONSE", text("draft")]]));
    expect(after?.pci.get("RESPONSE")?.state).toBe('{"strokes":[1,2]}');
  });

  it("gives the rubric of the test, the test part and the sections top down for the candidate, and the test feedback", () => {
    const engine = leakyEngine();
    const { state } = begun(engine);
    const view = engine.view(state, 0);
    const rubric = textOf(view.rubric);
    const order = ["TEST-RUBRIC-OK", "PART-RUBRIC-OK", "SECTION-RUBRIC-OK"].map((each) => rubric.indexOf(each));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((first, second) => first - second));
    expect(rubric).not.toContain("LEAK");
    // The feedback `during` waits for the outcome that outcome processing sets after the first submission.
    expect(view.testFeedback).toEqual([]);
    const submitted = played(engine, state, on("submit", "a", 1));
    expect(textOf(engine.view(submitted.state, 1).testFeedback)).toContain("DURING-OK");
    const ended = played(engine, submitted.state, { type: "end-test", at: 2 });
    const last = engine.view(ended.state, 2);
    expect([last.status, last.part, last.current, last.navigation, last.timers, last.actions]).toEqual([
      "ended",
      undefined,
      undefined,
      [],
      [],
      [],
    ]);
    expect(textOf(last.testFeedback)).toContain("AT-END-OK");
    expect(textOf(last.testFeedback)).not.toContain("DURING-OK");
    expect(leaksIn(last)).toEqual([]);
  });

  it("shows the correct responses in the solution state and nowhere else, and only when the control shows the solution", () => {
    const engine = leakyEngine();
    const { state } = begun(engine);
    const closed = played(engine, state, answer("a", "A", 1), on("submit", "a", 2));
    expect(leaksIn(engine.view(closed.state, 2))).toEqual([]);
    const solved = played(engine, closed.state, { type: "solution", item: key("a"), at: 3 });
    const view = engine.view(solved.state, 3);
    expect(view.current?.status).toBe("solution");
    expect(view.current?.responses).toEqual(
      new Map([
        ["RESPONSE", identifier("B")],
        ["TEXT", text("LEAK-CORRECT-TEXT")],
      ]),
    );
    // Only the correct response of the text appears; the mapping, the outcomes and the template values never do.
    expect(leaksIn(view)).toEqual(["LEAK-CORRECT-TEXT"]);
    const reviewed = played(engine, solved.state, { type: "review", item: key("a"), at: 4 });
    expect(leaksIn(engine.view(reviewed.state, 4))).toEqual([]);
    // Item b keeps its solution from the candidate.
    const other = played(engine, reviewed.state, moveTo(key("b"), 5), on("submit", "b", 6));
    expect(engine.view(other.state, 6).actions).not.toContain("solution");
    expect(refusalOf(engine, other.state, { type: "solution", item: key("b"), at: 7 }).code).toBe(
      "solution-not-allowed",
    );
  });

  it("shows the timers, and a maximum time that passed as applied, as a time action would apply it", () => {
    const content = `<qti-time-limits max-time="60"/>${testPart(
      "P",
      section("S", itemRef("a", '<qti-time-limits max-time="20"/>') + refs("b")),
      "linear",
      "individual",
      '<qti-time-limits min-time="10"/>',
    )}`;
    const engine = engineOf(content);
    const { state } = begun(engine, { at: 1_000 });
    expect(engine.view(state, 4_000).timers).toEqual([
      { scope: "test", identifier: "T", remaining: 57_000, late: false },
      { scope: "part", identifier: "P", minimumRemaining: 7_000, late: false },
      { scope: "item", identifier: "a", remaining: 17_000, late: false },
    ]);
    // The view at 25 s: the item a timed out at 21 s, so the candidate is in b, as after a time action.
    const view = engine.view(state, 25_000);
    const timed = played(engine, state, { type: "time", at: 25_000 });
    expect(view).toEqual(engine.view(timed.state, 25_000));
    expect(view.current?.key).toEqual(key("b"));
    expect(view.navigation.flatMap((entry) => (entry.kind === "item" ? [[entry.key.ref, entry.status]] : []))).toEqual([
      ["a", "closed"],
      ["b", "interacting"],
    ]);
    // A time before the latest step counts as that step, and the state stays as it was.
    const written = serializeState(state);
    expect(engine.view(state, -5)).toEqual(engine.view(state, state.at));
    expect(serializeState(state)).toBe(written);
    const ended = engine.view(state, 70_000);
    expect([ended.status, ended.current, ended.actions]).toEqual(["ended", undefined, []]);
  });

  it("marks a scope late when its maximum time passed and late submission is allowed", () => {
    const engine = engineOf(
      testPart(
        "P",
        section("S", itemRef("a", '<qti-time-limits max-time="10" allow-late-submission="true"/>')),
        "nonlinear",
      ),
    );
    const { state } = begun(engine);
    expect(engine.view(state, 4_000).timers).toEqual([
      { scope: "item", identifier: "a", remaining: 6_000, late: false },
    ]);
    const late = engine.view(state, 15_000);
    expect(late.timers).toEqual([{ scope: "item", identifier: "a", remaining: 0, late: true }]);
    expect(late.status).toBe("in-progress");
    expect(late.actions).toContain("submit");
  });

  it("shows a suspended session with no content and the action resume only", () => {
    const engine = leakyEngine();
    const { state } = begun(engine);
    const paused = played(engine, state, { type: "suspend", at: 5 });
    const view = engine.view(paused.state, 50);
    expect([
      view.status,
      view.current,
      view.navigation,
      view.rubric,
      view.testFeedback,
      view.timers,
      view.actions,
    ]).toEqual(["suspended", undefined, [], [], [], [], ["resume"]]);
    expect(view.part).toEqual({ identifier: "P", navigationMode: "nonlinear", submissionMode: "individual" });
    expect(engine.view(played(engine, paused.state, { type: "resume", at: 60 }).state, 60).current?.status).toBe(
      "interacting",
    );
  });

  it("lists the actions the state allows, which Engine.apply refuses when they are left out", () => {
    const engine = leakyEngine();
    const { state } = begun(engine);
    expect(engine.view(state, 0).actions).toEqual([
      "set-responses",
      "submit",
      "skip",
      "comment",
      "move",
      "end-part",
      "end-test",
      "suspend",
    ]);
    const closed = played(engine, state, answer("a", "A", 1), on("submit", "a", 2));
    expect(engine.view(closed.state, 2).actions).toEqual([
      "review",
      "solution",
      "comment",
      "move",
      "end-part",
      "end-test",
      "suspend",
    ]);
    const together = engineOf(testPart("P", section("S", refs("a")), "nonlinear", "simultaneous"));
    expect(together.view(begun(together).state, 0).actions).toEqual([
      "set-responses",
      "move",
      "end-part",
      "end-test",
      "suspend",
    ]);
  });

  it("lists the supports with their state and settings, and the settings of a prohibited one stay out", () => {
    const engine = leakyEngine();
    const pnp = pnpOf(
      '<line-reader/><magnification><all-content zoom-amount="2"/></magnification><braille/><activate-as-option-set><dictionary-on-screen/></activate-as-option-set><activate-at-initialization-set><line-reader/></activate-at-initialization-set><prohibit-set><braille/></prohibit-set>',
    );
    const { state } = begun(engine, { pnp, universalSupports: ["calculator-on-screen"] });
    const { supports } = engine.view(state, 0);
    expect(supports.map(({ name, state: supportState, active }) => [name, supportState, active])).toEqual([
      ["line-reader", "active", true],
      ["magnification", "assigned", true],
      ["braille", "prohibited", false],
      ["dictionary-on-screen", "option", false],
      ["calculator-on-screen", "option", false],
    ]);
    expect(supports[0]?.settings).toEqual({ name: "line-reader", replaceAccessModes: [] });
    expect(supports[1]?.settings).toMatchObject({ name: "magnification", allContent: { zoomAmount: 2 } });
    expect(supports[2]).not.toHaveProperty("settings");
    expect(supports[3]).not.toHaveProperty("settings");
    const toggled = played(engine, state, { type: "support", name: "dictionary-on-screen", active: true, at: 1 });
    expect(engine.view(toggled.state, 1).supports[3]).toEqual({
      name: "dictionary-on-screen",
      state: "option",
      active: true,
    });
    expect(engine.view(state, 0).actions).toContain("support");
  });

  it("shows the variant presented, the hazards with the flag of those avoided, and the link to a tool", () => {
    const resolved = withVariants(["flashing", "sound"], [{ resource: "v", drd: drd([], ["en"]) }]);
    const link: LtiLink = {
      title: "Lab",
      description: "A simulator",
      launchUrl: "http://tool.example/launch",
      custom: new Map([["mode", "exam"]]),
      extensions: [],
    };
    const lti: ResolvedItem = {
      resource: "lab",
      deliverable: { kind: "lti", identifier: "lab", link },
      hazards: [],
      variants: [],
    };
    const engine = engineOf(testPart("P", section("S", refs("a", "b", "c")), "nonlinear"), {
      "a.xml": resolved,
      "b.xml": lti,
      "c.xml": withVariants(["flashing"], []),
    });
    // The variant has no hazard and the language asked for, so it is presented in place of the item.
    const avoids = begun(engine, {
      pnp: pnpOf('<hazard-avoidance>sound</hazard-avoidance><item-translation xml:lang="en"/>'),
    });
    const variant = engine.view(avoids.state, 0).current;
    expect([variant?.variant, variant?.hazards]).toEqual([{ resource: "v", language: "en" }, []]);
    const plain = engine.view(begun(engine).state, 0).current;
    expect([plain?.variant, plain?.hazards]).toEqual([
      undefined,
      [
        { hazard: "flashing", avoided: false },
        { hazard: "sound", avoided: false },
      ],
    ]);
    // No variant of c is free of the hazard, so it is presented with the hazard flagged as avoided.
    const flagged = played(
      engine,
      begun(engine, { pnp: pnpOf("<hazard-avoidance>flashing</hazard-avoidance>") }).state,
      moveTo(key("c"), 1),
    );
    expect(engine.view(flagged.state, 1).current?.hazards).toEqual([{ hazard: "flashing", avoided: true }]);
    const tool = engine.view(played(engine, avoids.state, moveTo(key("b"), 1)).state, 1).current;
    expect(tool?.lti).toEqual({
      title: "Lab",
      description: "A simulator",
      launchUrl: "http://tool.example/launch",
      custom: new Map([["mode", "exam"]]),
    });
    expect([tool?.title, tool?.body, tool?.interactions, tool?.responses]).toEqual(["Lab", [], [], new Map()]);
  });

  it("shows the stimuli of the item, and the stylesheets of both as package paths", () => {
    const stimulus = readAsi(
      `<qti-assessment-stimulus xmlns="${ASI_NAMESPACE}" identifier="passage" title="Passage"><qti-stylesheet href="s.css" type="text/css"/><qti-stimulus-body><p>Read <img src="pic.png" alt="a picture"/></p></qti-stimulus-body></qti-assessment-stimulus>`,
    );
    if (stimulus.kind !== "stimulus") return fail(`Expected a stimulus, found ${stimulus.kind}.`);
    const item = itemOf(
      'time-dependent="false"',
      `<qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier"/>
      <qti-assessment-stimulus-ref identifier="passage" href="../stimuli/passage.xml"/>
      <qti-stylesheet href="../css/item.css" type="text/css"/>
      <qti-item-body><qti-choice-interaction response-identifier="RESPONSE" max-choices="1">${CHOICES}</qti-choice-interaction></qti-item-body>`,
    );
    const calls: [string, string][] = [];
    const engine = createEngine({
      kind: "test",
      test: testDocument(
        testPart("P", section("S", '<qti-assessment-item-ref identifier="a" href="items/a.xml"/>'), "nonlinear"),
      ),
      base: "test.xml",
      resolvers: {
        items: () => resolution(item),
        sections: NO_SECTIONS.sections,
        stimuli: (href, base) => {
          calls.push([href, base]);
          return stimulus.stimulus;
        },
      },
    });
    expect(calls).toContainEqual(["../stimuli/passage.xml", "items/a.xml"]);
    const view = engine.view(begun(engine).state, 0).current;
    expect(view?.stylesheets).toEqual(["css/item.css", "stimuli/s.css"]);
    expect(view?.stimuli.map(({ identifier: id }) => id)).toEqual(["passage"]);
    expect(textOf(view?.stimuli[0]?.body)).toContain("pic.png");
  });

  it("delivers a standalone item, with the resolver of its stimuli when the host gives one", () => {
    const engine = createEngine({ kind: "item", item: leakyItem(), base: "item.xml" });
    const { state } = begun(engine);
    const view = engine.view(state, 0);
    expect([view.test, view.part?.identifier, view.current?.key]).toEqual([
      { identifier: "item", title: "item" },
      "item-part",
      key("item"),
    ]);
    expect(leaksIn(view)).toEqual([]);
  });

  it("holds the view to the properties of its form: nothing of the item model but what the view names", () => {
    const engine = leakyEngine();
    const { state } = begun(engine);
    const view = engine.view(state, 0);
    const names = new Set<string>();
    const collect = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(collect);
      else if (typeof value === "object" && value !== null) {
        for (const [name, member] of Object.entries(value)) {
          names.add(name);
          collect(member);
        }
      }
    };
    collect(viewToJson(view));
    for (const forbidden of [
      "correctResponse",
      "mapping",
      "areaMapping",
      "lookupTable",
      "responseProcessing",
      "templateProcessing",
      "outcomeDeclarations",
      "responseDeclarations",
      "templateDeclarations",
      "contextDeclarations",
      "defaultValue",
      "outcomes",
      "templates",
      "correctResponses",
    ]) {
      expect(names.has(forbidden), forbidden).toBe(false);
    }
  });

  it("gives the same view from a state read back from its JSON form, also on another device", () => {
    const engine = leakyEngine();
    const { state } = begun(engine, { seed: 9 });
    const set = played(engine, state, {
      type: "set-responses",
      item: key("a"),
      responses: new Map([["TEXT", text("x")]]),
      at: 1,
    });
    expect(engine.view(deserializeState(serializeState(set.state)), 5)).toEqual(engine.view(set.state, 5));
  });

  it("refuses arguments of other types", () => {
    const engine = leakyEngine();
    const { state } = begun(engine);
    expect(() => engine.view(json("null"), 0)).toThrow(
      "The state must be an object from Engine.start or deserializeState, found null.",
    );
    expect(() => engine.view(state, json('"0"'))).toThrow('The time now must be a finite number, found "0".');
  });
});

describe("item actions", () => {
  const DefaultA = "<qti-default-value><qti-value>A</qti-value></qti-default-value>";

  it("keeps the drafts apart from the submitted responses until the attempt ends", () => {
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

  it("closes a non-adaptive item after one attempt when no control sets max-attempts", () => {
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
    });
    expect(refused(act(step.session, context, SUBMIT)).code).toBe("item-closed");
    expect(refused(act(step.session, context, HINT)).code).toBe("item-closed");
    expect(refused(act(step.session, context, NEXT)).code).toBe("attempts-exhausted");
  });

  it("resets the outcomes of a non-adaptive item before each response processing and keeps the last", () => {
    const context = contextOf(counterItem(), { maxAttempts: 2 });
    const first = acts(presented(context), context, respond("RESPONSE", identifier("B")), SUBMIT);
    expect([first.status, first.attempting]).toEqual(["interacting", false]);
    expect([outcome(first, "RUNS"), outcome(first, "SCORE")]).toEqual([integer(1), float(1)]);
    const second = acts(first, context, respond("RESPONSE", identifier("A")), SUBMIT);
    expect(attempts(second)).toEqual(integer(2));
    expect([outcome(second, "RUNS"), outcome(second, "SCORE")]).toEqual([integer(1), float(0)]);
    expect(second.status).toBe("closed");
  });

  it("allows any number of attempts when max-attempts is 0", () => {
    const context = contextOf(counterItem(), { maxAttempts: 0 });
    const session = acts(presented(context), context, SUBMIT, SUBMIT, SUBMIT, SUBMIT, SUBMIT);
    expect([session.status, session.countedAttempts]).toEqual(["interacting", 5]);
    expect(attempts(session)).toEqual(integer(5));
  });

  it("keeps the outcomes of an adaptive item between attempts, ignores max-attempts and closes it at completion", () => {
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

  it("starts the next attempt with next-attempt, or with the next action on the item, and once only", () => {
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

  it("sets the variable of an end attempt interaction to true when it ends the attempt and false otherwise, ignoring its default", () => {
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

  it("leaves an attempt that an end attempt interaction with count-attempt false ends out of max-attempts, while numAttempts counts it", () => {
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

  it("refuses an end attempt that names no end attempt interaction", () => {
    const context = contextOf(counterItem());
    expect(
      refused(act(presented(context), context, { type: "end-attempt", item: KEY, interaction: "RESPONSE" })),
    ).toMatchObject({ code: "invalid-response" });
  });

  it("refuses a submission of only NULL or default responses, and a skip, when skipping is not allowed", () => {
    const context = contextOf(counterItem({ defaults: DefaultA }), { allowSkipping: false });
    const session = presented(context);
    expect(refused(act(session, context, SUBMIT))).toMatchObject({
      code: "skipping-not-allowed",
    });
    const defaulted = acts(session, context, respond("RESPONSE", identifier("A")));
    expect(refused(act(defaulted, context, SUBMIT)).code).toBe("skipping-not-allowed");
    expect(refused(act(defaulted, context, SKIP)).code).toBe("skipping-not-allowed");
    expect(acts(defaulted, context, respond("RESPONSE", identifier("C")), SUBMIT).status).toBe("closed");
    expect(acts(session, context, HINT).status).toBe("closed");
  });

  it("never blocks an item without response variables, and submits NULL responses for a skip", () => {
    const reading = itemOf('time-dependent="false"', "<qti-item-body><p>Read this.</p></qti-item-body>");
    const strict = contextOf(reading, { allowSkipping: false });
    expect(acts(presented(strict), strict, SUBMIT).status).toBe("closed");
    expect(acts(presented(strict), strict, SKIP).status).toBe("closed");
    const context = contextOf(counterItem());
    const step = accepted(act(acts(presented(context), context, respond("RESPONSE", identifier("B"))), context, SKIP));
    expect(step.events[0]?.detail).toBe("skip");
    expect([response(step.session, "RESPONSE"), outcome(step.session, "SCORE")]).toEqual([null, float(0)]);
  });

  it("refuses a submission with an invalid response of a visible interaction under validate-responses, but not a skip", () => {
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
    });
    expect(acts(session, context, respond("RESPONSE", identifier("A")), SUBMIT).status).toBe("closed");
    expect(acts(session, context, SKIP).status).toBe("closed");
    expect(acts(session, contextOf(item), SUBMIT).status).toBe("closed");
  });

  it("lets review, the solution and comments follow the item session control", () => {
    const item = counterItem();
    const review: ItemAction = { type: "review", item: KEY };
    const solution: ItemAction = { type: "solution", item: KEY };
    const comment = (text: string): ItemAction => ({ type: "comment", item: KEY, text });
    const open = contextOf(item, { maxAttempts: 0 });
    expect(refused(act(presented(open), open, review))).toMatchObject({
      code: "review-not-allowed",
    });
    expect(refused(act(presented(open), open, solution))).toMatchObject({
      code: "solution-not-allowed",
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

  it("refuses actions on an item not presented or suspended, of another instance, or earlier than the latest change", () => {
    const context = contextOf(counterItem());
    const started = accepted(startItemSession(KEY, 0, context)).session;
    expect(refused(act(started, context, SUBMIT))).toMatchObject({ code: "not-current" });
    const session = presented(context, 10);
    const suspended = accepted(suspendItem(session, 20)).session;
    expect(refused(act(suspended, context, SUBMIT)).code).toBe("suspended");
    expect(refused(applyItemAction(session, { ...SUBMIT, item: { ref: "q", instance: 2 }, at: 30 }, context))).toEqual({
      code: "unknown-item",
      message: 'The action names the item instance "q" 2, not the instance "q" 1 of the session.',
    });
    expect(refused(act(session, context, SUBMIT, 9))).toEqual({
      code: "clock-regression",
      message: "The step at 9 is earlier than the latest change of the item session at 10.",
    });
  });

  it("refuses a variable the candidate does not set, a value of another type, and an integer beyond the safe integers", () => {
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
    });
    const huge = json<Value>('{"cardinality": "single", "baseType": "integer", "value": 9007199254740993}');
    expect(refused(act(session, context, respond("N", huge)))).toMatchObject({
      code: "value-out-of-range",
    });
    expect(acts(session, context, respond("X", integer(2))).drafts.get("X")).toEqual(float(2));
  });

  it("stores the latest state of each portable custom interaction, and refuses a state for another interaction", () => {
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

describe("item feedback", () => {
  it("shows the feedback between attempts, and the body as at the start of the attempt while a non-adaptive attempt is open", () => {
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

  it("keeps the feedback of earlier attempts while an attempt of an adaptive item is open", () => {
    const item = counterItem({ adaptive: true });
    const context = contextOf(item);
    const next = acts(presented(context), context, HINT, NEXT);
    const during = itemFeedback(next, item, context.control);
    expect([during.outcomes.get("FEEDBACK"), during.modal]).toEqual([identifier("hint"), false]);
  });

  it("shows the final outcomes of an adaptive item in review without show-feedback, which decides once it closed", () => {
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

  it("reviews a non-adaptive item with its feedback only when show-feedback is true", () => {
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

describe("item responses", () => {
  it("shows the correct responses in the solution state, NULL where none is declared, and keeps the candidate's", () => {
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

describe("starting an item session", () => {
  it("starts with NULL responses, no attempt, no time, completionStatus not_attempted and the initial outcomes", () => {
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

  it("runs template processing once at the start, so that each instance records the values of its own clone", () => {
    const oracle = createRandom(5);
    // qti-random-integer draws an index over the admissible values: 1 + floor(uniform × 1000000).
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

  it("sets the context values before template processing, so that template and response processing read QTI_CONTEXT", () => {
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

  it("keeps the template defaults and reports processing-failed when template processing fails", () => {
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
      "The item instance is invalid: expected an object, found null.",
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

describe("presenting an item", () => {
  it("starts the first attempt at the first presentation, with the defaults and completionStatus unknown", () => {
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

  it("draws the order of the choices at the first presentation; an order interaction with a default keeps its order", () => {
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

  it("resumes a suspended session without a new attempt, and leaves a presented or closed session as it is", () => {
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

describe("suspending an item", () => {
  it("counts the time of the candidate sessions only, truncated to the millisecond", () => {
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

  it("leaves a session that is not interacting as it is, and refuses a time earlier than its latest change", () => {
    const context = contextOf(counterItem());
    const started = accepted(startItemSession(KEY, 0, context)).session;
    expect(accepted(suspendItem(started, 1)).session).toBe(started);
    expect(refused(suspendItem(presented(context, 5), 4)).code).toBe("clock-regression");
    expect(() => suspendItem(started, json("null"))).toThrow(DataError);
    expect(() => suspendItem(json("1"), 0)).toThrow(DataError);
  });
});

describe("closing an item", () => {
  it("closes a session that was never presented without an attempt, so its responses stay NULL", () => {
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

  it("ends an open attempt with the drafts when it closes, whatever attempts are left", () => {
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

  it("closes a session between attempts without processing again", () => {
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

describe("the JSON of an item session", () => {
  it("writes a session as JSON that reads back equal", () => {
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
    expect(() => itemSessionFromJson(null)).toThrow("The item session is invalid: expected an object, found null.");
    expect(() => itemSessionFromJson({ ...written, status: "paused" })).toThrow(DataError);
    expect(() =>
      itemSessionFromJson({
        ...written,
        drafts: [
          ["RESPONSE", null],
          ["RESPONSE", null],
        ],
      }),
    ).toThrow('The item session is invalid at drafts: the identifier "RESPONSE" occurs twice.');
    expect(() => itemSessionFromJson({ ...written, drafts: [["RESPONSE", { value: 1 }]] })).toThrow(DataError);
    expect(() => itemSessionFromJson({ ...written, pciStates: [["R", 1]] })).toThrow(DataError);
    expect(() => itemSessionFromJson({ ...written, choiceOrders: [["R", "A"]] })).toThrow(DataError);
    expect(() => itemSessionFromJson({ ...written, variables: { ...written.variables, outcomes: {} } })).toThrow(
      DataError,
    );
  });

  it("reads or refuses arbitrary JSON with a DataError, and nothing else", () => {
    const written: unknown = JSON.parse(JSON.stringify(itemSessionToJson(presented(contextOf(counterItem())))));
    fuzzJson(itemSessionFromJson, [written]);
  });
});

describe("navigation", () => {
  it("gives the next item of the plan in a nonlinear part, ignoring pre-conditions and branch rules", () => {
    const structure = nonlinear(section("S", itemRef("a", branch("c", GO)) + itemRef("b", pre(NOT_GO)) + itemRef("c")));
    expect(walk(structure, plan(structure), GO_TRUE)).toEqual(["a", "b", "c"]);
  });

  it("goes on in the next part after the last item of a part, and ends after the last part", () => {
    const structure = structureOf(
      part("P1", section("S1", refs("a", "b"))) + part("P2", section("S2", refs("c")), "linear"),
    );
    expect(walk(structure, plan(structure))).toEqual(["a", "b", "c"]);
  });

  it("ends the test when the plan has no item", () => {
    const structure = nonlinear(section("S", ""));
    expect(nextItem(structure, plan(structure), undefined, rules())).toBeUndefined();
  });

  it("skips an item whose pre-condition is false, and presents one whose is true", () => {
    // The branch rules of the example: item160 follows a response Y to item034 and item063 a response N.
    const structure = linear(
      section(
        "A",
        itemRef("item034") + itemRef("item160", pre(answered("Y"))) + itemRef("item063", pre(answered("N"))),
      ),
    );
    expect(walk(structure, plan(structure), rules({ ANSWER: identifier("Y") }))).toEqual(["item034", "item160"]);
    expect(walk(structure, plan(structure), rules({ ANSWER: identifier("N") }))).toEqual(["item034", "item063"]);
  });

  it("skips an item whose pre-condition is NULL, as it is when no response was given", () => {
    const structure = linear(section("A", itemRef("first") + itemRef("second", pre(answered("Y")))));
    expect(walk(structure, plan(structure))).toEqual(["first"]);
  });

  it("evaluates the pre-conditions of a node in order and stops at the first that is false", () => {
    const undeclared = '<qti-variable identifier="NOT_DECLARED"/>';
    const structure = linear(section("A", itemRef("first") + itemRef("second", pre(NOT_GO) + pre(undeclared))));
    expect(walk(structure, plan(structure), GO_TRUE)).toEqual(["first"]);
    expect(() => walk(structure, plan(structure), GO_FALSE)).toThrow(ProcessingError);
  });

  it("skips a section and a test part with everything in them when their pre-condition is false", () => {
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

  it("passes over a node that has no item to present, also at the start of the test", () => {
    const structure = structureOf(
      part("P1", section("A", itemRef("a", pre(NOT_GO))), "linear") + part("P2", section("B", itemRef("b")), "linear"),
    );
    const testPlan = plan(structure);
    expect(nextItem(structure, testPlan, undefined, GO_TRUE)).toEqual({ ref: "b", instance: 1 });
  });

  it("ignores the pre-conditions of a nonlinear part and of what it holds", () => {
    const structure = structureOf(part("P", section("S", itemRef("a", pre(NOT_GO))), "nonlinear", pre(NOT_GO)));
    expect(walk(structure, plan(structure), GO_TRUE)).toEqual(["a"]);
  });

  it("jumps over items to the target of the first branch rule that is true", () => {
    // The branch rules of the example: item347 skips item653 for the response N, and exits the section unless the response is Y.
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

  it("lets the first true branch rule decide, and treats a NULL one as false", () => {
    const structure = linear(
      section("S", itemRef("a", branch("c", answered("Y")) + branch("d", answered("Y"))) + refs("b", "c", "d")),
    );
    expect(walk(structure, plan(structure), rules({ ANSWER: identifier("Y") }))).toEqual(["a", "c", "d"]);
    expect(walk(structure, plan(structure))).toEqual(["a", "b", "c", "d"]);
  });

  it("evaluates the branch rules of a section and of a test part when they are completed", () => {
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

  it("completes a section that was entered but has nothing to present, so that its branch rules follow", () => {
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

  it("does not evaluate the branch rules of a node that was skipped", () => {
    const structure = linear(
      section("A", itemRef("a")),
      section("B", pre(NOT_GO) + branch("EXIT_TEST", GO) + itemRef("b")),
      section("C", itemRef("c")),
    );
    expect(walk(structure, plan(structure), GO_TRUE)).toEqual(["a", "c"]);
  });

  it("ends the test at EXIT_TEST, and completes the test part at EXIT_TESTPART", () => {
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

  it("lets EXIT_SECTION complete the section, so that the branch rules of the section follow", () => {
    const structure = linear(
      section("S1", branch("S3", GO) + itemRef("a", branch("EXIT_SECTION", GO)) + itemRef("b")),
      section("S2", itemRef("c")),
      section("S3", itemRef("d")),
    );
    expect(walk(structure, plan(structure), GO_TRUE)).toEqual(["a", "d"]);
  });

  it("goes on after a section or part that has EXIT_SECTION or EXIT_TESTPART, which have nothing to leave", () => {
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

  it("enters a target section or item with the pre-conditions of what it enters", () => {
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

  it("does not evaluate a rule whose target is behind, inside the node, in another part, or not in the plan", () => {
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

  it("enters the sections of a target that the walk is not in, and none that it is in", () => {
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

  it("leads a rule to the first occurrence ahead of a target that selection repeated", () => {
    const structure = linear(
      section("S1", itemRef("a", branch("t", GO)) + itemRef("m")),
      section("S2", `<qti-selection select="2" with-replacement="true"/>${refs("t")}`),
    );
    expect(walk(structure, planWith(structure, scripted(0, 0)), GO_TRUE)).toEqual(["a", "t", "t#2"]);
  });

  it("raises a ProcessingError for an expression that is not a single boolean", () => {
    const integer = '<qti-base-value base-type="integer">1</qti-base-value>';
    const structure = linear(section("S", itemRef("a", pre(integer))));
    expect(() => walk(structure, plan(structure))).toThrow("must give a single boolean, found single integer");
  });

  it("follows the instances of an item reference that selection with replacement repeated", () => {
    const structure = nonlinear(section("S", `<qti-selection select="3" with-replacement="true"/>${refs("a")}`));
    const testPlan = planWith(structure, scripted(0, 0, 0));
    expect(walk(structure, testPlan)).toEqual(["a", "a#2", "a#3"]);
  });

  it("gives an item before another only in a nonlinear part (previousItem)", () => {
    const structure = structureOf(
      part("P1", section("S1", refs("a", "b"))) + part("P2", section("S2", refs("c", "d")), "linear"),
    );
    const testPlan = plan(structure);
    const key = (ref: string): ItemKey => ({ ref, instance: 1 });
    expect(previousItem(structure, testPlan, key("b"))).toEqual(key("a"));
    expect(previousItem(structure, testPlan, key("a"))).toBeUndefined();
    expect(previousItem(structure, testPlan, key("d"))).toBeUndefined();
  });

  it("refuses an item instance that is not in the plan, and arguments of other types", () => {
    const structure = nonlinear(section("S", refs("a")));
    const testPlan = plan(structure);
    expect(() => nextItem(structure, testPlan, { ref: "b", instance: 1 }, rules())).toThrow(
      'The plan has no item instance "b" 1.',
    );
    expect(() => previousItem(structure, testPlan, { ref: "a", instance: 2 })).toThrow(
      'The plan has no item instance "a" 2.',
    );
    expect(() => nextItem(structure, testPlan, json('{"ref":"a","instance":0}'), rules())).toThrow(
      "The item instance is invalid at instance: expected a value of at least 1, found 0.",
    );
    expect(() => nextItem(structure, testPlan, json('{"ref":1,"instance":1}'), rules())).toThrow(
      "The item instance is invalid at ref: expected a string, found 1.",
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

  it("refuses a plan that names what the structure does not have", () => {
    const structure = linear(section("S", refs("a")));
    const other = linear(section("T", refs("b")));
    expect(() => nextItem(structure, plan(other), undefined, rules())).toThrow(
      'The plan names "T", which the structure does not have.',
    );
  });
});

describe("planning a test", () => {
  it("keeps the test parts and the sections of a part in document order, with their items", () => {
    const structure = structureOf(
      part("P1", section("S", refs("a", "b")) + section("T", refs("c"))) +
        part("P2", section("U", refs("d")), "linear"),
    );
    expect(outlineOf(plan(structure, 7))).toBe("P1{S[a b] T[c]} P2{U[d]}");
  });

  it("keeps the order of the children without ordering and with shuffle false, and draws nothing", () => {
    const withoutOrdering = nonlinear(section("S", refs("a", "b", "c")));
    const withoutShuffle = nonlinear(section("S", `<qti-ordering shuffle="false"/>${refs("a", "b", "c")}`));
    for (const structure of [withoutOrdering, withoutShuffle]) {
      const random = scripted();
      expect(outlineOf(planWith(structure, random))).toBe("P{S[a b c]}");
    }
  });

  it("shuffles by Fisher–Yates from the last index, with floor(uniform × n) as the draw", () => {
    // [x, y, z]: i = 2 draws floor(0.5 × 3) = 1 and swaps the places 2 and 1, giving [x, z, y];
    // i = 1 draws floor(0.5 × 2) = 1 and swaps the place 1 with itself.
    const structure = nonlinear(section("S", `<qti-ordering shuffle="true"/>${refs("x", "y", "z")}`));
    const random = scripted(0.5, 0.5);
    expect(outlineOf(planWith(structure, random))).toBe("P{S[x z y]}");
    expect(random.left()).toBe(0);
  });

  it("keeps fixed children in their places and shuffles the others among theirs", () => {
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

  it("orders after selection, so that fixed places are those of the selected children", () => {
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

  it("keeps an invisible section together in a shuffled parent when it is kept together", () => {
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

  it("mixes the children of an invisible section that is not kept together into its shuffled parent", () => {
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

  it("keeps a visible section, and a fixed section, together whatever keep-together says", () => {
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

  it("does not mix when the parent does not shuffle", () => {
    const structure = nonlinear(
      section("W", refs("x") + section("S", refs("m", "n"), 'visible="false" keep-together="false"') + refs("y")),
    );
    expect(structure.section("S")?.dissolved).toBe(false);
    expect(outlineOf(plan(structure))).toBe("P{W[x S[m n] y]}");
  });

  it("mixes sections that lie in sections that are mixed in, at any depth", () => {
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

  it("lets a section that is mixed in select and order its own children first", () => {
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

  it("numbers the instances of a reference in the order of presentation, after ordering", () => {
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

  it("plans a section once for each selection, each with its own draws", () => {
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

  it("gives an adaptive section no items and takes no draw, though its pool is in the structure", () => {
    const adaptive =
      '<qti-adaptive-selection><qti-adaptive-engine-ref identifier="e" href="http://example.org/engine"/></qti-adaptive-selection>';
    const structure = nonlinear(section("A", adaptive + refs("a", "b")), section("B", refs("c")));
    const random = scripted();
    expect(outlineOf(planWith(structure, random))).toBe("P{A[] B[c]}");
    expect(structure.itemRef("a")?.model.href).toBe("a.xml");
  });

  it("refuses a plan beyond maxPlanNodes before drawing, so that a selection cannot exhaust memory", () => {
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

  it("lists the items of a test part together, as a part with simultaneous submission submits them", () => {
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

  it("refuses options and arguments of other types", () => {
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

  it("refuses a random source that returns anything but a number in [0, 1)", () => {
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

describe("the result status of an item", () => {
  it("reports initial before the first attempt, pendingSubmission during one, and final after response processing", () => {
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

  it("reports pendingExternalScoring after response processing of an item with an externally scored outcome", () => {
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

  it("reports pendingResponseProcessing when response processing fails, with the outcomes it started from", () => {
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

  it("keeps the outcomes of the earlier attempt of an adaptive item when its response processing fails", () => {
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

describe("selection and ordering", () => {
  const abcd = (selection: string, ordering = ""): TestStructure =>
    nonlinear(section("S", selection + ordering + refs("a", "b", "c", "d")));

  it("selects every child in document order when the section has no selection, and draws nothing", () => {
    const random = scripted();
    expect(outlineOf(planWith(abcd(""), random))).toBe("P{S[a b c d]}");
  });

  it("draws nothing when the selection takes every child", () => {
    const random = scripted();
    expect(outlineOf(planWith(abcd('<qti-selection select="4"/>'), random))).toBe("P{S[a b c d]}");
  });

  it("takes the first places of a shuffle of the children that are not required, in document order", () => {
    // Fisher–Yates over the places [0, 1, 2, 3] with the draws 0, 0, 0: i = 3 swaps 3 and 0, i = 2 swaps 2 and 0,
    // i = 1 swaps 1 and 0, giving [1, 2, 3, 0]; the first two places are b and c. With 0.99 each swap is with itself:
    // [0, 1, 2, 3], so a and b.
    const select = abcd('<qti-selection select="2"/>');
    expect(outlineOf(planWith(select, scripted(0, 0, 0)))).toBe("P{S[b c]}");
    expect(outlineOf(planWith(select, scripted(0.99, 0.99, 0.99)))).toBe("P{S[a b]}");
  });

  it("includes every required child, and counts a section as one child", () => {
    // The selection of the example: section B selects 2 children, the section B1 is required, so B1 and one of the other three items.
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

  it("selects a required item reference always, and keeps document order", () => {
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

  it("draws the subset uniformly among the children that are not required", () => {
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

  it("refuses a selection of fewer children than are required, or more than exist, or less than 0", () => {
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

  it("selects every required child once, then draws the others over all children, with replacement", () => {
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

  it("lets select exceed the number of children when the selection is with replacement", () => {
    const structure = nonlinear(section("S", `<qti-selection select="5" with-replacement="true"/>${refs("a", "b")}`));
    expect(outlineOf(planWith(structure, scripted(0, 0, 0, 0, 0)))).toBe("P{S[a a#2 a#3 a#4 a#5]}");
  });

  it("draws the remaining selections uniformly over all children, the required ones included", () => {
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

  it("plans identically for equal seeds, and from a restored generator state", () => {
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

describe("item session control", () => {
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

  it("lets the test part, then each section from the outermost, then the item reference override attribute by attribute", () => {
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

  it("follows the item session control of the part, the sections and the item references", () => {
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

  it("gives the defaults when no level sets an attribute, and no maximum number of attempts", () => {
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

  it("passes on the control of a section that ordering mixes into its parent", () => {
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

  it("refuses what is not an item reference of a structure", () => {
    expect(() => sessionControl(json("null"))).toThrow("The item reference must be an object from resolveStructure");
    expect(() => sessionControl(json(JSON.stringify({ kind: "section" })))).toThrow(
      'The item reference must be a node of kind "item-ref", found the kind "section".',
    );
  });
  it("gives an item delivered alone its feedback and review, and applies the control given to it", () => {
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

  it("refuses a control that is not an item session control", () => {
    expect(() => standaloneSessionControl(json("null"))).toThrow(DataError);
    expect(() => standaloneSessionControl(json('{"kind": "assessment-item"}'))).toThrow(
      'The item session control must be the model of a qti-item-session-control, found the kind "assessment-item".',
    );
  });
});

/** A value or NULL of any cardinality and base type. */
const anyValue = fc.oneof(
  ...(["single", "multiple", "ordered"] as const).flatMap((cardinality) =>
    BASE_TYPES.map((type) => valueArbitrary(cardinality, type)),
  ),
  recordValue,
);

/** Writes a view or an action as JSON text and reads the text back, as a server and its client do. */
const throughText = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe("the JSON of a view", () => {
  const engine = leakyEngine();
  const { state } = begun(engine, { seed: 3 });
  const closed = played(engine, state, answer("a", "B", 1), on("submit", "a", 2));
  const solved = played(engine, closed.state, { type: "solution", item: key("a"), at: 3 });
  const views = (): CandidateView[] => [
    engine.view(state, 0),
    engine.view(closed.state, 2),
    engine.view(solved.state, 3),
    engine.view(played(engine, state, { type: "suspend", at: 1 }).state, 1),
    engine.view(played(engine, closed.state, { type: "end-test", at: 3 }).state, 3),
  ];

  it("reads back, from the JSON text, the view in every state of a session", () => {
    for (const view of views()) expect(viewFromJson(throughText(viewToJson(view)))).toEqual(view);
  });

  it("writes values as wire values and maps as arrays of entries, NULL as null", () => {
    const current = engine.view(closed.state, 2).current;
    const written = JSON.parse(JSON.stringify(viewToJson(engine.view(closed.state, 2)))).current;
    expect(written.responses).toEqual([
      ["RESPONSE", { cardinality: "single", baseType: "identifier", value: { base: { identifier: "B" } } }],
      ["TEXT", null],
    ]);
    expect(written.pci).toEqual([]);
    expect(current?.responses.get("TEXT")).toBeNull();
  });

  it("keeps an ordered container apart from a multiple one, and the identifier __proto__ as data", () => {
    const item = itemOf(
      'time-dependent="false"',
      `<qti-response-declaration identifier="__proto__" cardinality="ordered" base-type="identifier"/>
      <qti-response-declaration identifier="MANY" cardinality="multiple" base-type="identifier"/>
      <qti-item-body>
        <qti-order-interaction response-identifier="__proto__">${CHOICES}</qti-order-interaction>
        <qti-choice-interaction response-identifier="MANY" max-choices="0">${CHOICES}</qti-choice-interaction>
      </qti-item-body>`,
    );
    const one = engineOf(testPart("P", section("S", refs("a")), "nonlinear"), { "a.xml": item });
    const set = played(one, begun(one).state, {
      type: "set-responses",
      item: key("a"),
      responses: new Map<string, Value | null>([
        ["__proto__", container("ordered", "identifier", ["B", "A"])],
        ["MANY", container("multiple", "identifier", ["B", "A"])],
      ]),
      at: 1,
    });
    const view = one.view(set.state, 1);
    const read = viewFromJson(throughText(viewToJson(view)));
    expect(read).toEqual(view);
    expect(read.current?.responses.get("__proto__")).toEqual(container("ordered", "identifier", ["B", "A"]));
    expect(read.current?.responses.get("MANY")).toEqual(container("multiple", "identifier", ["B", "A"]));
  });

  it("reads back any value of a response, of any cardinality and base type", () => {
    const view = engine.view(state, 0);
    const current = view.current ?? fail("No item.");
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.tuple(identifierArbitrary, anyValue), { selector: ([name]) => name }),
        (entries) => {
          const given: CandidateView = { ...view, current: { ...current, responses: new Map(entries) } };
          expect(viewFromJson(throughText(viewToJson(given)))).toEqual(given);
        },
      ),
    );
  });

  it("writes the properties of a view and no other, and refuses a view that has another", () => {
    const view = engine.view(state, 0);
    expect(() => viewToJson(Object.assign({}, view, { correct: "LEAK-X" }))).toThrow(
      /^The view is invalid: unexpected property "correct"\.$/,
    );
    const item = view.current ?? fail("No item.");
    expect(() => viewToJson({ ...view, current: Object.assign({}, item, { correctResponses: [] }) })).toThrow(
      /^The view is invalid at current: unexpected property "correctResponses"\.$/,
    );
    expect(() =>
      viewToJson({
        ...view,
        timers: [Object.assign({}, { scope: "test", identifier: "T", late: false } as const, { key: 1 })],
      }),
    ).toThrow(/^The view is invalid at timers\[0\]: unexpected property "key"\.$/);
  });

  it("refuses JSON that is not the form of a view", () => {
    const good = JSON.parse(JSON.stringify(viewToJson(engine.view(state, 0))));
    const change = (edit: (view: Record<string, unknown>) => void): unknown => {
      const copy = JSON.parse(JSON.stringify(good));
      edit(copy);
      return copy;
    };
    expect(() => viewFromJson(json("null"))).toThrow("The view is invalid: expected an object, found null.");
    expect(() => viewFromJson(change((view) => delete view.timers))).toThrow(
      'The view is invalid: missing the property "timers".',
    );
    expect(() => viewFromJson(change((view) => (view.status = "paused")))).toThrow(
      'The view is invalid at status: expected "in-progress", "suspended" or "ended", found "paused".',
    );
    expect(() => viewFromJson(change((view) => (view.answer = 1)))).toThrow(/unexpected property "answer"\.$/);
    expect(() => viewFromJson(change((view) => (view.actions = ["time"])))).toThrow(
      /^The view is invalid at actions\[0\]: expected "set-responses", .*, found "time"\.$/,
    );
    expect(() => viewFromJson(change((view) => (view.rubric = [{ text: "no kind" }])))).toThrow(
      'The view is invalid at rubric[0]: missing the property "kind".',
    );
    expect(() => viewFromJson(change((view) => (view.rubric = [{ kind: "p", children: [null] }])))).toThrow(
      /^The view is invalid at rubric: must hold only strings, finite numbers, booleans, arrays and objects, found null\.$/,
    );
    expect(() =>
      viewFromJson(change((view) => (view.supports = [{ name: "chocolate", state: "option", active: false }]))),
    ).toThrow("The view is invalid at supports[0].name: The name of a support must be the name of a support of a PNP.");
    expect(() =>
      viewFromJson(
        change((view) => {
          const item = view.current as { responses: unknown[] };
          item.responses = [item.responses[0], item.responses[0]];
        }),
      ),
    ).toThrow('The view is invalid at current.responses: the identifier "RESPONSE" occurs twice.');
    expect(() =>
      viewFromJson(change((view) => ((view.current as { interactions: unknown[] }).interactions = [{ kind: "x" }]))),
    ).toThrow(
      /^The view is invalid at current\.interactions\[0\]: The response identifier of an interaction descriptor must be a string/,
    );
  });

  it("refuses content that JSON cannot carry or that nests too deep", () => {
    const view = engine.view(state, 0);
    const node = (value: unknown): CandidateView => ({ ...view, rubric: json(JSON.stringify([{ kind: "p", value }])) });
    expect(() => viewToJson({ ...view, rubric: [{ kind: "p", value: Number.NaN } as never] })).toThrow(
      "The view is invalid at rubric: holds NaN, which JSON cannot carry.",
    );
    expect(() => viewToJson({ ...view, rubric: [{ kind: "p", value: new Map() } as never] })).toThrow(
      /^The view is invalid at rubric: must hold only strings, finite numbers, booleans, arrays and objects, found an object\.$/,
    );
    let deep: unknown = "x";
    for (let level = 0; level < 300; level++) deep = [deep];
    expect(() => viewToJson({ ...view, rubric: [{ kind: "p", deep } as never] })).toThrow(
      "The view is invalid at rubric: nests deeper than 256 levels.",
    );
    expect(() => viewFromJson(json('{"__proto__":1}'))).toThrow(/^The view is invalid: /);
    expect(node("fine").rubric).toHaveLength(1);
  });

  it("refuses a view of other types", () => {
    expect(() => viewToJson(json("null"))).toThrow("The view must be an object, found null.");
    expect(() => viewToJson(json('{"status":"in-progress"}'))).toThrow(/^The navigation of the view must be an array/);
  });

  it("reads or refuses arbitrary JSON with a DataError, and nothing else", () => {
    fuzzJson(viewFromJson, views().map(viewToJson));
  });
});

describe("candidate actions", () => {
  const item = key("a");
  const actions: CandidateAction[] = [
    {
      type: "set-responses",
      item,
      responses: new Map<string, Value | null>([
        ["RESPONSE", identifier("B")],
        ["TEXT", null],
      ]),
    },
    {
      type: "set-responses",
      item: key("a", 2),
      responses: new Map(),
      pciStates: new Map([["__proto__", '{"state":"é"}']]),
    },
    { type: "submit", item },
    { type: "skip", item },
    { type: "next-attempt", item },
    { type: "review", item },
    { type: "solution", item },
    { type: "end-attempt", item, interaction: "HINT" },
    { type: "comment", item, text: "The question is ambiguous" },
    { type: "move", to: "next" },
    { type: "move", to: "previous" },
    { type: "move", to: key("b", 3) },
    { type: "support", name: "line-reader", active: true },
    { type: "support", name: "ext:highlighter", active: false },
    { type: "end-part" },
    { type: "end-test" },
    { type: "suspend" },
    { type: "resume" },
  ];

  it("reads back, from the JSON text, each action of the candidate that actionToJson wrote", () => {
    for (const action of actions) expect(parseCandidateAction(throughText(actionToJson(action)))).toEqual(action);
  });

  it("writes an action as plain data: values as wire values, maps as entries, and no time", () => {
    const [set] = actions;
    if (set === undefined) return fail("No action.");
    expect(actionToJson(set)).toEqual({
      type: "set-responses",
      item: { ref: "a", instance: 1 },
      responses: [
        ["RESPONSE", { cardinality: "single", baseType: "identifier", value: { base: { identifier: "B" } } }],
        ["TEXT", null],
      ],
    });
    expect(actionToJson({ type: "move", to: key("b", 3) })).toEqual({ type: "move", to: { ref: "b", instance: 3 } });
    expect(actionToJson(Object.assign({}, { type: "submit", item } as const, { at: 12 }))).toEqual({
      type: "submit",
      item: { ref: "a", instance: 1 },
    });
  });

  it("refuses the actions of the host, and any action with a time", () => {
    for (const type of ["time", "supply-scores", "cat-response"]) {
      expect(() => parseCandidateAction({ type, at: 1 })).toThrow(
        `The type "${type}" is an action of the host, and a candidate does not send it; the type of an action of a candidate is "set-responses",`,
      );
    }
    expect(() => parseCandidateAction({ type: "submit", item: { ref: "a", instance: 1 }, at: 1 })).toThrow(
      'The action is invalid: unexpected property "at".',
    );
    expect(() => parseCandidateAction({ type: "suspend", at: 1 })).toThrow(
      'The action is invalid: unexpected property "at".',
    );
  });

  it("refuses input that is not an action, naming what is wrong", () => {
    const refuses = (input: string, message: string | RegExp): void => {
      expect(() => parseCandidateAction(json(input))).toThrow(message);
    };
    refuses("null", "The action is invalid: expected an object, found null.");
    refuses("[]", /^The action is invalid at type: expected "set-responses", .* or "resume", found undefined\.$/);
    refuses(
      '{"type":"dance"}',
      /^The action is invalid at type: expected "set-responses", .* or "resume", found "dance"\.$/,
    );
    refuses('{"type":"submit"}', 'The action is invalid: missing the property "item".');
    refuses(
      '{"type":"submit","item":{"ref":"a","instance":0}}',
      "The action is invalid at item.instance: expected a value of at least 1, found 0.",
    );
    refuses('{"type":"submit","item":{"ref":"a","instance":1},"answer":"B"}', /unexpected property "answer"\.$/);
    refuses(
      '{"type":"comment","item":{"ref":"a","instance":1},"text":5}',
      "The action is invalid at text: expected a string, found 5.",
    );
    refuses(
      '{"type":"end-attempt","item":{"ref":"a","instance":1}}',
      'The action is invalid: missing the property "interaction".',
    );
    refuses(
      '{"type":"move","to":"left"}',
      'The action is invalid at to: The place of move must be "next", "previous" or an item instance.',
    );
    refuses(
      '{"type":"move","to":5}',
      'The action is invalid at to: The place of move must be "next", "previous" or an item instance.',
    );
    refuses(
      '{"type":"support","name":"chocolate","active":true}',
      "The action is invalid at name: The name of a support must be the name of a support of a PNP.",
    );
    refuses(
      '{"type":"support","name":"line-reader","active":"yes"}',
      'The action is invalid at active: expected true or false, found "yes".',
    );
    refuses(
      '{"type":"set-responses","item":{"ref":"a","instance":1},"responses":{}}',
      "The action is invalid at responses: expected an array, found an object.",
    );
    refuses(
      '{"type":"set-responses","item":{"ref":"a","instance":1},"responses":[["R",null],["R",null]]}',
      'The action is invalid at responses: the identifier "R" occurs twice.',
    );
    refuses(
      '{"type":"set-responses","item":{"ref":"a","instance":1},"responses":[["R",{"cardinality":"single","baseType":"integer","value":{"base":{"integer":"x"}}}]]}',
      /integer/,
    );
    refuses(
      '{"type":"set-responses","item":{"ref":"a","instance":1},"responses":[],"pciStates":[["R",5]]}',
      "The action is invalid at pciStates[0][1]: expected a string, found 5.",
    );
  });

  it("refuses an action larger than the limit maxActionSize, and a PCI state longer than maxPciStateLength", () => {
    const comment = (text: string): unknown => actionToJson({ type: "comment", item, text });
    expect(DEFAULT_ACTION_LIMITS).toEqual({ maxActionSize: 4_194_304, maxPciStateLength: 1_048_576 });
    expect(parseCandidateAction(comment("x".repeat(100)), { maxActionSize: 200 })).toMatchObject({ type: "comment" });
    expect(() => parseCandidateAction(comment("x".repeat(300)), { maxActionSize: 200 })).toThrow(
      "The action is larger than the limit maxActionSize of 200.",
    );
    expect(() => parseCandidateAction(comment("x".repeat(DEFAULT_ACTION_LIMITS.maxActionSize)))).toThrow(
      "The action is larger than the limit maxActionSize of 4194304.",
    );
    const pci = (state: string): unknown =>
      actionToJson({ type: "set-responses", item, responses: new Map(), pciStates: new Map([["P", state]]) });
    expect(parseCandidateAction(pci("x".repeat(10)), { maxPciStateLength: 10 })).toMatchObject({
      type: "set-responses",
    });
    expect(() => parseCandidateAction(pci("x".repeat(11)), { maxPciStateLength: 10 })).toThrow(
      'The PCI state of "P" has 11 code units, more than the limit maxPciStateLength of 10.',
    );
    expect(() => parseCandidateAction(pci("x".repeat(DEFAULT_ACTION_LIMITS.maxPciStateLength + 1)))).toThrow(
      /more than the limit maxPciStateLength of 1048576\.$/,
    );
    const many = json<unknown>(
      JSON.stringify({
        type: "set-responses",
        item: { ref: "a", instance: 1 },
        responses: Array.from({ length: 300 }, (_, at) => [`R${at}`, null]),
      }),
    );
    expect(() => parseCandidateAction(many, { maxActionSize: 1_000 })).toThrow(
      "The action is larger than the limit maxActionSize of 1000.",
    );
    expect(parseCandidateAction(many)).toMatchObject({ type: "set-responses" });
  });

  it("counts the size of nested input without recursion, so deep input is refused and never overflows the stack", () => {
    let deep: unknown = [];
    for (let level = 0; level < 200_000; level++) deep = [deep];
    expect(() => parseCandidateAction(deep)).toThrow(/^The action is invalid at type: /);
    const cycle: unknown[] = [];
    cycle.push(cycle);
    expect(() => parseCandidateAction(cycle, { maxActionSize: 10_000 })).toThrow(
      "The action is larger than the limit maxActionSize of 10000.",
    );
  });

  it("refuses limits of other types", () => {
    const input = actionToJson({ type: "end-test" });
    expect(() => parseCandidateAction(input, json("null"))).toThrow("The options must be an object, found null.");
    expect(() => parseCandidateAction(input, json('{"maxActionSize":"1"}'))).toThrow(
      'The limit maxActionSize must be a positive integer, found "1".',
    );
    expect(() => parseCandidateAction(input, { maxPciStateLength: 0 })).toThrow(
      "The limit maxPciStateLength must be a positive integer, found 0.",
    );
  });

  it("stamps an action of a client on the server: the time is the server's, never earlier than the session's", () => {
    const engine = engineOf(testPart("P", section("S", refs("a", "b")), "nonlinear"));
    const { state } = played(engine, begun(engine).state, answer("a", "B", 5_000));
    const received = parseCandidateAction(throughText(actionToJson({ type: "submit", item: key("a") })));
    const stamped = stamp(state, received, 3_000);
    expect(stamped).toEqual({ type: "submit", item: key("a"), at: 5_000 });
    const step = engine.apply(state, stamped);
    expect(step.ok && step.state.items[0]?.session.status).toBe("closed");
  });

  it("reads or refuses arbitrary JSON with a DataError, and nothing else", () => {
    fuzzJson(parseCandidateAction, actions.map(actionToJson));
  });
});

describe("the JSON of an action", () => {
  it("refuses an action of other types", () => {
    expect(() => actionToJson(json("null"))).toThrow("The action must be an object with a type, found null.");
    expect(() => actionToJson(json('{"type":"time"}'))).toThrow(
      /^The type of the action must be "set-responses", .* or "resume", found "time"\.$/,
    );
    expect(() => actionToJson(json('{"type":"submit","item":{"ref":"a"}}'))).toThrow(
      'The item instance is invalid: missing the property "instance".',
    );
    expect(() => actionToJson(json('{"type":"set-responses","item":{"ref":"a","instance":1},"responses":{}}'))).toThrow(
      "The responses of set-responses must be a Map from response identifier to value, found an object.",
    );
    expect(() =>
      actionToJson({ type: "set-responses", item: key("a"), responses: new Map(), pciStates: json('{"R":"s"}') }),
    ).toThrow("The pciStates of set-responses must be a Map from response identifier to state, found an object.");
    expect(() => actionToJson(json('{"type":"comment","item":{"ref":"a","instance":1},"text":5}'))).toThrow(
      "The action is invalid at text: expected a string, found 5.",
    );
  });
});

describe("time stamps", () => {
  const engine = engineOf(testPart("P", section("S", refs("a", "b")), "nonlinear"));

  it("stamps an action with the time now, never before the latest step, so the engine never refuses its time", () => {
    const { state } = played(engine, begun(engine).state, answer("a", "B", 5_000));
    const submit = { type: "submit", item: key("a") } as const;
    expect(stamp(state, submit, 3_000)).toEqual({ ...submit, at: 5_000 });
    expect(stamp(state, submit, 7_000)).toEqual({ ...submit, at: 7_000 });
    expect(engine.apply(state, stamp(state, submit, 3_000)).ok).toBe(true);
    expect(refusalOf(engine, state, { ...submit, at: 3_000 }).code).toBe("clock-regression");
  });

  it("replaces a time the action carries, and refuses what is not an action of the engine", () => {
    const { state } = begun(engine);
    const submit = Object.assign({ type: "submit", item: key("a") } as const, { at: 1 });
    expect(stamp(state, submit, 9)).toEqual({ type: "submit", item: key("a"), at: 9 });
    expect(() => stamp(state, json('{"type":"fly"}'), 1)).toThrow(/^The type of the action must be /);
    expect(() => stamp(state, json('{"type":"submit"}'), 1)).toThrow(
      "The item instance is invalid: expected an object, found undefined.",
    );
  });

  it("refuses arguments of other types", () => {
    const { state } = begun(engine);
    expect(() => stamp(json("null"), { type: "time" }, 1)).toThrow(
      "The state must be an object from Engine.start or deserializeState, found null.",
    );
    expect(() => stamp(state, json("null"), 1)).toThrow("The action must be an object with a type, found null.");
    expect(() => stamp(state, { type: "time" }, json('"1"'))).toThrow(
      'The time now must be a finite number, found "1".',
    );
  });
});

describe("the content version of a state", () => {
  const content = testPart("P", section("S", refs("a", "b")), "nonlinear");
  const named = engineOf(content, {}, { contentVersion: "form-2025-03" });
  const unnamed = engineOf(content);
  const mismatch =
    'The state started on the content version "form-2025-03", and this engine delivers the content version "form-2025-04". Apply the state on the engine of its version.';

  it("is kept by the state from the start, and written and read as JSON", () => {
    const { state } = begun(named);
    expect(state.contentVersion).toBe("form-2025-03");
    const later = played(named, state, answer("a", "A", 1), on("submit", "a", 2)).state;
    expect(later.contentVersion).toBe("form-2025-03");
    const text = serializeState(later);
    expect(JSON.parse(text).contentVersion).toBe("form-2025-03");
    expect(deserializeState(text)).toEqual(later);
  });

  it("leaves no trace in a state of an engine that names none", () => {
    const { state } = begun(unnamed);
    expect("contentVersion" in state).toBe(false);
    expect("contentVersion" in JSON.parse(serializeState(state))).toBe(false);
  });

  it("refuses a state of another content version in every call that reads the state, and leaves it as it was", () => {
    const other = engineOf(content, {}, { contentVersion: "form-2025-04" });
    const { state } = begun(named);
    const before = serializeState(state);
    for (const call of [
      () => other.apply(state, { type: "time", at: 1 }),
      () => other.view(state, 1),
      () => other.deadlines(state),
      () => other.pending(state),
      () => other.scorerView(state, "request"),
      () => other.results(state),
    ]) {
      expect(call).toThrow(mismatch);
      expect(call).toThrow(DataError);
    }
    expect(serializeState(state)).toBe(before);
  });

  it("passes a state that names no version, and a state on an engine that names none", () => {
    const early = begun(unnamed).state;
    expect(named.apply(early, { type: "time", at: 1 }).ok).toBe(true);
    expect(named.view(early, 1)).toEqual(unnamed.view(early, 1));
    const tagged = begun(named).state;
    expect(unnamed.apply(tagged, { type: "time", at: 1 }).ok).toBe(true);
    expect(unnamed.results(tagged)).toEqual(named.results(tagged));
  });

  it("scores a state on what it captured under edited content when no version is named, and refuses it when one is", () => {
    // The edit gives another correct response and a score of 5 for it. A state keeps the correct response, the defaults
    // and the template values that its session started with, and reads the rules of response processing from the item.
    const choice = (correct: string, processing: string): AssessmentItem =>
      itemOf(
        'time-dependent="false"',
        `<qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier">
          <qti-correct-response><qti-value>${correct}</qti-value></qti-correct-response>
        </qti-response-declaration>
        <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"/>
        <qti-item-body><qti-choice-interaction response-identifier="RESPONSE" max-choices="1">${CHOICES}</qti-choice-interaction></qti-item-body>
        ${processing}`,
      );
    const matchCorrect =
      '<qti-response-processing template="https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/match_correct"/>';
    const fiveForCorrect = `<qti-response-processing><qti-response-condition><qti-response-if>
      <qti-match><qti-variable identifier="RESPONSE"/><qti-correct identifier="RESPONSE"/></qti-match>
      <qti-set-outcome-value identifier="SCORE"><qti-base-value base-type="float">5</qti-base-value></qti-set-outcome-value>
    </qti-response-if></qti-response-condition></qti-response-processing>`;
    const part = testPart("P", section("S", refs("a")), "nonlinear");
    const original = engineOf(part, { "a.xml": choice("A", matchCorrect) }, { contentVersion: "form-1" });
    const stored = serializeState(played(original, begun(original).state, answer("a", "A", 1_000)).state);
    const submit = on("submit", "a", 2_000);
    const scoreOf = (state: DeliveryState): Value | null =>
      sessionOf(state, "a").variables.outcomes.get("SCORE") ?? null;
    expect(scoreOf(played(original, deserializeState(stored), submit).state)).toEqual(float(1));
    // Without a version the edit applies silently: A is correct as captured, and the edited rule gives it 5.
    const edited = engineOf(part, { "a.xml": choice("B", fiveForCorrect) });
    expect(scoreOf(played(edited, deserializeState(stored), submit).state)).toEqual(float(5));
    const named = engineOf(part, { "a.xml": choice("B", fiveForCorrect) }, { contentVersion: "form-2" });
    expect(() => named.apply(deserializeState(stored), submit)).toThrow(
      'The state started on the content version "form-1", and this engine delivers the content version "form-2".',
    );
  });

  it("refuses a content version that is not a string in a state", () => {
    const written = JSON.parse(serializeState(begun(named).state));
    expect(() => deserializeState(JSON.stringify({ ...written, contentVersion: 5 }))).toThrow(
      "The state is invalid at contentVersion: expected a string, found 5.",
    );
    expect(() => serializeState({ ...begun(named).state, contentVersion: json("5") })).toThrow(
      "The contentVersion of the state must be a string, found 5.",
    );
    expect(() => named.view({ ...begun(named).state, contentVersion: json("null") }, 1)).toThrow(
      "The contentVersion of the state must be a string, found null.",
    );
  });
});

describe("the JSON of a state", () => {
  const variants = withVariants(["flashing"], [{ resource: "v", drd: drd([]) }]);
  const pci = itemOf(
    'time-dependent="false"',
    `<qti-response-declaration identifier="__proto__" cardinality="single" base-type="string"/>
    <qti-item-body><qti-portable-custom-interaction response-identifier="__proto__" custom-interaction-type-identifier="urn:fdc:example.com:pci:any" module="any"><qti-interaction-markup><p>Any</p></qti-interaction-markup></qti-portable-custom-interaction></qti-item-body>`,
  );
  const city = '<qti-context-declaration identifier="CITY" cardinality="single" base-type="string"/>';
  const engine = engineOf(
    `${city}${TOTAL}<qti-time-limits max-time="10" allow-late-submission="true"/>${testPart(
      "P",
      section("S", refs("a", "b", "c")),
      "nonlinear",
    )}${outcomeProcessing(SUM_SCORES)}`,
    { "a.xml": variants, "b.xml": pci },
  );

  /** A state with a variant, a PCI state, supports, a context value, an expired clock and a suspended session. */
  function rich(): DeliveryState {
    const pnp = pnpOf(
      '<hazard-avoidance>flashing</hazard-avoidance><additional-testing-time><time-multiplier>2</time-multiplier></additional-testing-time><item-translation xml:lang="id"/><activate-as-option-set><line-reader/></activate-as-option-set>',
    );
    const { state } = begun(engine, { pnp, context: new Map([["CITY", text("Jakarta")]]) });
    return played(
      engine,
      state,
      { type: "support", name: "line-reader", active: true, at: 1 },
      answer("a", "B", 2),
      on("submit", "a", 3),
      moveTo(key("b"), 4),
      {
        type: "set-responses",
        item: key("b"),
        responses: new Map([["__proto__", text("x")]]),
        pciStates: new Map([["__proto__", '{"step":2}']]),
        at: 5,
      },
      { type: "time", at: 25_000 },
      { type: "suspend", at: 26_000 },
    ).state;
  }

  it("keeps the settings of the supports, and refuses settings that do not fit their support", () => {
    const engine = engineOf(testPart("P", section("S", refs("a")), "nonlinear"));
    const pnp = pnpOf(
      '<magnification><all-content zoom-amount="2"/></magnification><spoken><reading-type>computer-read-aloud</reading-type><speech-rate>150</speech-rate></spoken><activate-as-option-set><spoken/></activate-as-option-set>',
    );
    const { state } = begun(engine, { pnp });
    const text = serializeState(state);
    expect(deserializeState(text)).toEqual(state);
    expect(state.supports.get("magnification")?.settings).toMatchObject({ allContent: { zoomAmount: 2 } });
    const edited = (from: string, to: string): string => {
      expect(text).toContain(from);
      return text.replace(from, to);
    };
    expect(() => deserializeState(edited('"zoomAmount":2', '"zoomAmount":"two"'))).toThrow(DataError);
    expect(() => deserializeState(edited('"name":"magnification"', '"name":"spoken"'))).toThrow(
      'The state is invalid at supports: The settings of the support "magnification" must name a predefined support and have the name "magnification", found "spoken".',
    );
    expect(() => deserializeState(edited('"settings":{"name":"spoken"', '"settings":{"name":"ext:x"'))).toThrow(
      DataError,
    );
  });

  it("writes a state as JSON that reads back equal, with its variants, PCI states, supports and clocks", () => {
    const state = rich();
    const text = serializeState(state);
    const read = deserializeState(text);
    expect(read).toEqual(state);
    expect(JSON.parse(text).version).toBe(1);
    expect(read.items[0]?.variant).toBe("v");
    expect(read.clocks[0]).toEqual({ scope: "test", identifier: "T", spent: 26_000, expired: "late" });
    // The engine goes on from the state read back as from the state itself.
    const resume = { type: "resume", at: 30_000 } as const;
    expect(engine.apply(read, resume)).toEqual(engine.apply(state, resume));
  });

  it("refuses text that is not a state, or a state of another version of the format", () => {
    const written = JSON.parse(serializeState(rich()));
    const text = (changes: Record<string, unknown>): string => JSON.stringify({ ...written, ...changes });
    expect(() => deserializeState("{")).toThrow(
      "The state must be the JSON text that serializeState writes, found text that is not JSON.",
    );
    expect(() => deserializeState("null")).toThrow("The state is invalid: expected an object, found null.");
    expect(() => deserializeState(text({ version: 2 }))).toThrow(
      "The state is invalid at version: expected 1, found 2.",
    );
    expect(() => deserializeState(text({ status: "paused" }))).toThrow(
      'The state is invalid at status: expected "in-progress", "suspended" or "ended", found "paused".',
    );
    expect(() => deserializeState(text({ random: [0, 0, 0, 0] }))).toThrow(
      "A random state must be four integers from 0 to 4294967295, not all 0, found an array.",
    );
    expect(() => deserializeState(text({ plan: { parts: [{ kind: "section" }] } }))).toThrow(
      'The state is invalid at plan.parts[0].kind: expected "part", found "section".',
    );
    expect(() => deserializeState(text({ supports: [["chocolate", { state: "option", active: true }]] }))).toThrow(
      'A support of the state must have a support name, found "chocolate".',
    );
    expect(() => deserializeState(text({ clocks: [{ scope: "test", identifier: "T", spent: -1 }] }))).toThrow(
      "The state is invalid at clocks[0].spent: expected a value of at least 0, found -1.",
    );
    expect(() => deserializeState(text({ needs: { avoidedHazards: ["glare"] } }))).toThrow(
      'The state is invalid at needs.avoidedHazards[0]: expected "flashing", "sound", "olfactory-hazard" or "motion-simulation", found "glare".',
    );
    expect(() => deserializeState(json("1"))).toThrow("The state must be a string, found 1.");
    expect(() => serializeState(json("null"))).toThrow(
      "The state must be an object from Engine.start or deserializeState, found null.",
    );
  });

  it("reads or refuses arbitrary JSON text with a DataError, and nothing else", () => {
    const written: unknown = JSON.parse(serializeState(rich()));
    fuzzJson((json) => deserializeState(JSON.stringify(json)), [written]);
  });
});

describe("the structure of a test", () => {
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

  it("replaces a section reference by the section it names, and resolves what it holds against its document", () => {
    const calls: [string, string][] = [];
    const structure = structureOf(Referencing, Documents, "tests/t.xml", calls);
    // The href is relative to the document that holds the reference.
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

  it("takes the required mark and the selection from the section that the reference names", () => {
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

  it("refuses a section resolver that returns a promise", () => {
    const sections = new Map([["s1.xml", sectionOf(section("S1", refs("a")))]]);
    const resolvers = {
      sections: awaiting((href: string) => sections.get(href) ?? fail(`The test has no document ${href}.`)),
    };
    const referencing = testOf(part("P", '<qti-assessment-section-ref identifier="S1" href="s1.xml"/>'));
    expect(() => resolveStructure(referencing, "test.xml", resolvers)).toThrow(
      "The resolver sections must return its value synchronously, found a promise.",
    );
  });

  it("refuses a reference whose identifier is not that of the section it names", () => {
    const wrong = structureOf.bind(null, part("P", '<qti-assessment-section-ref identifier="X" href="s1.xml"/>'));
    expect(() => wrong({ "s1.xml": section("S1", refs("a")) })).toThrow(
      'The section reference "X" names "s1.xml", whose section has the identifier "S1"; the two must be equal.',
    );
  });

  it("refuses identifiers that two test parts, sections or item references share", () => {
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

  it("refuses an xi:include that is left in a section", () => {
    const include = '<xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="more.xml"/>';
    expect(() => nonlinear(section("S", include))).toThrow(
      'The section "S" holds an xi:include, which must be resolved before the test is planned.',
    );
  });

  it("refuses a reference outside the package, and a resolver that returns no section", () => {
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

  it("finds a part, a section and an item reference by identifier, and nothing for an identifier it does not have", () => {
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

  it("lists the nodes that enclose a node from the outermost, and finds its test part", () => {
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

  it("refuses arguments of other types", () => {
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

describe("time limits", () => {
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

  it("gives the limits that each scope declares, in seconds, without inheriting them", () => {
    expect(everywhere(timed("linear"))).toEqual({
      test: { minTime: 600, maxTime: 3600, allowLateSubmission: false },
      part: { maxTime: 3600, allowLateSubmission: false },
      section: { minTime: 60, maxTime: 1800, allowLateSubmission: true },
      a: { minTime: 30, maxTime: 300, allowLateSubmission: false },
      b: { allowLateSubmission: false },
    });
  });

  it("applies the minimum time of an item and a section only in a linear part, and that of a part and the test always", () => {
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

  it("multiplies every maximum time by the multiplier and leaves the minimum times", () => {
    const extra: TestingTime = { kind: "time-multiplier", multiplier: 1.5 };
    expect(everywhere(timed("linear"), extra)).toEqual({
      test: { minTime: 600, maxTime: 5400, allowLateSubmission: false },
      part: { maxTime: 5400, allowLateSubmission: false },
      section: { minTime: 60, maxTime: 2700, allowLateSubmission: true },
      a: { minTime: 30, maxTime: 450, allowLateSubmission: false },
      b: { allowLateSubmission: false },
    });
  });

  it("adds the fixed minutes to the outermost maximum time only", () => {
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

  it("adds the fixed minutes to each outermost maximum when the paths differ", () => {
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

  it("removes every maximum time when the time is unlimited, and nothing else", () => {
    expect(everywhere(timed("linear"), { kind: "unlimited" })).toEqual({
      test: { minTime: 600, allowLateSubmission: false },
      part: { allowLateSubmission: false },
      section: { minTime: 60, allowLateSubmission: true },
      a: { minTime: 30, allowLateSubmission: false },
      b: { allowLateSubmission: false },
    });
  });

  it("leaves a scope without a maximum time without one, whatever the extra time", () => {
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

  it("gives a section that ordering mixes into its parent no limits and counts it no enclosing scope", () => {
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

  it("reads the extra time of a profile: a multiplier, fixed minutes or unlimited time", () => {
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
    // The sets of the profile decide only whether the support is prohibited.
    const option =
      "<additional-testing-time><unlimited/></additional-testing-time><activate-as-option-set><additional-testing-time/></activate-as-option-set>";
    expect(additionalTestingTime(profile(option))).toEqual({ kind: "unlimited" });
    const prohibited =
      "<additional-testing-time><unlimited/></additional-testing-time><prohibit-set><additional-testing-time/></prohibit-set>";
    expect(additionalTestingTime(profile(prohibited))).toBeUndefined();
    expect(additionalTestingTime(profile("<spoken/>"))).toBeUndefined();
    expect(additionalTestingTime(profile(""))).toBeUndefined();
  });

  it("refuses a node and extra time of other types, and a multiplier that is not positive", () => {
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

describe("the guide", () => {
  it("shows the results that its samples give", async () => {
    const guide = new URL("../../../docs/runtime/delivery.md", import.meta.url);
    const modules = {
      "@assesskit/runtime": await import("../src/index.js"),
      "@assesskit/runtime/asi": await import("../src/asi/index.js"),
      "@assesskit/runtime/delivery": await import("../src/delivery/index.js"),
      "@assesskit/runtime/values": await import("../src/values/index.js"),
    };
    expect(await runGuideSamples(guide, modules)).toBeGreaterThan(0);
  });
});

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

  it("selects the number asked for, every required child, and repeats a child only with replacement", () => {
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

  it("permutes the selected children and keeps the fixed ones in their places", () => {
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

  it("shuffles every permutation of three children with equal probability", () => {
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

  it("numbers the instances in order of presentation, and plans no section that is mixed in", () => {
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

  it("keeps the required items of the section among its children, shuffled or not", () => {
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

  it("plans the same for the same seed, and replays exactly from a restored generator state", () => {
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

  /** The structure of generated sections, and what a candidate meets by the rules of the information model when GO is true. */
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

  it("follows pre-conditions and branch rules exactly as the rules of a linear part say", () => {
    fc.assert(
      fc.property(navigation, (shape) => {
        const { structure, expected } = navigate(shape);
        expect(walk(structure, plan(structure), GO_TRUE)).toEqual(expected);
      }),
      { numRuns: 300 },
    );
  });

  it("never moves backward in a linear part, and always ends", () => {
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

  it("applies extra time to the maximum times only, by the arithmetic of the specification", () => {
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

  it("lets the nearest level that sets an attribute decide, and the default when none does", () => {
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

  it("keeps the rules of attempts, outcomes, time and drafts over any sequence of actions", () => {
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
              const event = next.events.find(({ type }) => type === "response-processed");
              expect([event?.attempt, event?.duration]).toEqual([count(after), Math.floor(after.spent)]);
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

  it("replays a session exactly from the same seed and actions", () => {
    fc.assert(
      fc.property(fc.boolean(), sessionControls, sessionMoves, seeds, (adaptive, attributes, moves, seed) => {
        const item = counterItem({ adaptive });
        const run = (): ReturnType<typeof play> => play(contextOf(item, attributes, createRandom(seed)), moves);
        expect(run()).toEqual(run());
      }),
    );
  });

  it("keeps any PCI state through the JSON form of the session", () => {
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

  /** A generated test: parts with their modes and maximum times, sections with their limits, items. */
  const flows = fc.record({
    parts: fc.array(
      fc.record({
        navigation: fc.constantFrom("linear" as const, "nonlinear" as const),
        submission: fc.constantFrom("individual" as const, "simultaneous" as const),
        maxTime: fc.option(fc.integer({ min: 1, max: 30 }), { nil: undefined }),
        late: fc.boolean(),
        sections: fc.array(
          fc.record({
            items: fc.integer({ min: 1, max: 3 }),
            maxTime: fc.option(fc.integer({ min: 1, max: 20 }), { nil: undefined }),
            minTime: fc.option(fc.integer({ min: 1, max: 5 }), { nil: undefined }),
            itemTime: fc.option(fc.integer({ min: 1, max: 10 }), { nil: undefined }),
            late: fc.boolean(),
          }),
          { minLength: 1, maxLength: 2 },
        ),
      }),
      { minLength: 1, maxLength: 2 },
    ),
    testTime: fc.option(fc.integer({ min: 5, max: 60 }), { nil: undefined }),
  });

  type Flow = typeof flows extends fc.Arbitrary<infer T> ? T : never;

  const lateIf = (allowed: boolean): string => (allowed ? ' allow-late-submission="true"' : "");

  function flowEngine(flow: Flow): Engine {
    const parts = flow.parts.map((entry, p) => {
      const sections = entry.sections.map((shape, s) => {
        const id = `p${p}s${s}`;
        const bounds = [
          shape.maxTime === undefined ? "" : `max-time="${shape.maxTime}"`,
          shape.minTime === undefined ? "" : `min-time="${shape.minTime}"`,
        ].join(" ");
        const own =
          shape.maxTime === undefined && shape.minTime === undefined ? "" : limits(`${bounds}${lateIf(shape.late)}`);
        const items = Array.from({ length: shape.items }, (_, i) =>
          i === 0 && shape.itemTime !== undefined
            ? itemRef(`${id}i${i}`, limits(`max-time="${shape.itemTime}"${lateIf(shape.late)}`))
            : itemRef(`${id}i${i}`),
        );
        return section(id, own + items.join(""));
      });
      const head = entry.maxTime === undefined ? "" : limits(`max-time="${entry.maxTime}"${lateIf(entry.late)}`);
      return testPart(`p${p}`, sections.join(""), entry.navigation, entry.submission, head);
    });
    const own = flow.testTime === undefined ? "" : limits(`max-time="${flow.testTime}"`);
    return engineOf(`${TOTAL}${own}${parts.join("")}${outcomeProcessing(SUM_SCORES)}`);
  }

  /** A move of the candidate or the host, with a target among the instances and the milliseconds since the move before. */
  const engineMoves = fc.array(
    fc.record({
      move: fc.constantFrom(
        "answer",
        "submit",
        "skip",
        "hint",
        "review",
        "next",
        "previous",
        "goto",
        "end-part",
        "end-test",
        "suspend",
        "resume",
        "time",
        "support",
      ),
      choice: fc.constantFrom("A", "B", "C"),
      target: fc.nat(),
      gap: fc.integer({ min: 0, max: 4_000 }),
    }),
    { maxLength: 30 },
  );

  type EngineMove = typeof engineMoves extends fc.Arbitrary<(infer T)[]> ? T : never;

  /** The action of a move in a state: an action on an item names the current item, or now and then another. */
  function actionOf(state: DeliveryState, { move, choice, target }: EngineMove): CandidateAction | HostAction {
    const planned = planItems(state.plan);
    const other = planned[target % planned.length] ?? key("none");
    const item = state.current === undefined || target % 3 === 0 ? other : state.current;
    switch (move) {
      case "answer":
        return { type: "set-responses", item, responses: new Map([["RESPONSE", identifier(choice)]]) };
      case "submit":
      case "skip":
      case "review":
        return { type: move, item };
      case "hint":
        return { type: "end-attempt", item, interaction: "HINT" };
      case "next":
      case "previous":
        return { type: "move", to: move };
      case "goto":
        return { type: "move", to: other };
      case "support":
        return { type: "support", name: "line-reader", active: target % 2 === 0 };
      default:
        return { type: move };
    }
  }

  const Profile = "<line-reader/><activate-as-option-set><line-reader/></activate-as-option-set>";

  /** Runs moves from a start at 0, each stamped at the time of the moves before it; returns the accepted actions. */
  function session(
    engine: Engine,
    seed: number,
    moves: readonly EngineMove[],
    check: (before: DeliveryState, action: Action, step: Step) => void = () => undefined,
  ): { state: DeliveryState; events: DeliveryEvent[]; actions: Action[] } {
    const start = begun(engine, { seed, pnp: pnpOf(Profile) });
    let { state } = start;
    const events = [...start.events];
    const actions: Action[] = [];
    let now = 0;
    for (const move of moves) {
      now += move.gap;
      const action = stamp(state, actionOf(state, move), now);
      const step = engine.apply(state, action);
      check(state, action, step);
      if (!step.ok) continue;
      actions.push(action);
      events.push(...step.events);
      state = step.state;
    }
    return { state, events, actions };
  }

  const attemptsOf = (state: DeliveryState, ref: ItemKey): number => {
    const value = state.items
      .find((item) => item.session.key.ref === ref.ref && item.session.key.instance === ref.instance)
      ?.session.variables.responses.get("numAttempts");
    return value?.cardinality === "single" ? Number(value.value) : 0;
  };

  const partOf = (state: DeliveryState, at: ItemKey): string | undefined =>
    state.plan.parts.find((entry) => planItems(state.plan, entry.identifier).some((each) => shown(each) === shown(at)))
      ?.identifier;

  it("keeps the rules of a test session over any actions and time, and never throws", () => {
    fc.assert(
      fc.property(flows, engineMoves, seeds, (flow, moves, seed) => {
        const engine = flowEngine(flow);
        const linear = new Set(flow.parts.flatMap((entry, p) => (entry.navigation === "linear" ? [`p${p}`] : [])));
        session(engine, seed, moves, (before, action, step) => {
          const written = serializeState(before);
          // The reducer never changes the state it is given, and a refusal gives no state.
          expect(serializeState(before)).toBe(written);
          if (!step.ok) {
            expect(step.refusal.code).not.toBe("clock-regression");
            return;
          }
          const after = step.state;
          for (const item of before.items) {
            expect(attemptsOf(after, item.session.key)).toBeGreaterThanOrEqual(attemptsOf(before, item.session.key));
          }
          if (action.type === "set-responses") {
            const target = before.items.find((item) => shown(item.session.key) === shown(action.item));
            expect(["closed", "review", "solution"]).not.toContain(target?.session.status);
            const touched = after.items.find((item) => shown(item.session.key) === shown(action.item));
            expect(touched?.expired).not.toBe("closed");
          }
          const { current } = after;
          if (before.current !== undefined && current !== undefined) {
            const part = partOf(before, before.current);
            if (part !== undefined && part === partOf(after, current) && linear.has(part)) {
              const order = planItems(after.plan).map(shown);
              expect(order.indexOf(shown(current))).toBeGreaterThanOrEqual(order.indexOf(shown(before.current)));
            }
          }
          const spent = (state: DeliveryState): number => state.clocks[0]?.spent ?? 0;
          if (before.status === "in-progress" && after.status === "in-progress") {
            expect(spent(after) - spent(before)).toBe(after.at - before.at);
          }
          if (before.status === "suspended") expect(spent(after)).toBe(spent(before));
          for (const deadline of engine.deadlines(after)) {
            if (deadline.kind === "max-time") expect(deadline.at).toBeGreaterThan(after.at);
          }
          if (after.status === "ended") expect(after.current).toBeUndefined();
          expect(deserializeState(serializeState(after))).toEqual(after);
        });
      }),
    );
  });

  it("replays a session exactly from the seed and the accepted actions, also through its JSON form", () => {
    fc.assert(
      fc.property(flows, engineMoves, seeds, (flow, moves, seed) => {
        const engine = flowEngine(flow);
        const played = session(engine, seed, moves);
        const start = begun(engine, { seed, pnp: pnpOf(Profile) });
        let state = start.state;
        let written = start.state;
        const events = [...start.events];
        for (const action of played.actions) {
          const step = engine.apply(state, action);
          const through = engine.apply(deserializeState(serializeState(written)), action);
          if (!step.ok || !through.ok) return fail("A replayed action was refused.");
          expect(through.events).toEqual(step.events);
          events.push(...step.events);
          state = step.state;
          written = through.state;
        }
        expect(state).toEqual(played.state);
        expect(written).toEqual(played.state);
        expect(events).toEqual(played.events);
      }),
    );
  });

  it("presents a variant free of the avoided hazards when there is one, in the language asked for, for the whole session", () => {
    const hazardSets = fc.subarray(["flashing", "sound"] as const);
    fc.assert(
      fc.property(
        hazardSets,
        fc.array(fc.record({ hazards: hazardSets, language: fc.constantFrom("id", "id-ID", "en", "ko") }), {
          maxLength: 3,
        }),
        hazardSets,
        fc.option(fc.constantFrom("id", "ID-id", "en"), { nil: undefined }),
        (core, variants, avoided, language) => {
          const resolved = withVariants(
            core,
            variants.map((variant, at) => ({ resource: `v${at}`, drd: drd(variant.hazards, [variant.language]) })),
          );
          const engine = engineOf(testPart("P", section("S", refs("a", "b")), "nonlinear"), { "a.xml": resolved });
          const avoids = avoided.map((hazard) => `<hazard-avoidance>${hazard}</hazard-avoidance>`).join("");
          const asks = language === undefined ? "" : `<item-translation xml:lang="${language}"/>`;
          const { state } = begun(engine, { pnp: pnpOf(avoids + asks) });
          const candidates = [
            { resource: undefined, hazards: core, languages: [] as string[] },
            ...variants.map((variant, at) => ({
              resource: `v${at}`,
              hazards: variant.hazards,
              languages: [variant.language],
            })),
          ];
          const chosen = state.items[0]?.variant;
          const presented = candidates.find((candidate) => candidate.resource === chosen);
          const free = candidates.filter((candidate) => !candidate.hazards.some((hazard) => avoided.includes(hazard)));
          if (free.length === 0) expect(chosen).toBeUndefined();
          else expect(free).toContain(presented);
          const exact = free.filter(
            (candidate) =>
              candidate.resource !== undefined &&
              candidate.languages.some((tag) => tag.toLowerCase() === language?.toLowerCase()),
          );
          if (exact.length > 0) expect(exact).toContain(presented);
          const later = played(
            engine,
            state,
            moveTo(key("b"), 1),
            { type: "suspend", at: 2 },
            { type: "resume", at: 3 },
            moveTo(key("a"), 4),
          );
          expect(later.state.items[0]?.variant).toBe(chosen);
        },
      ),
    );
  });
  /** The types of the refusals that the state decides, which an action the view lists never meets. */
  const Structural: readonly RefusalCode[] = [
    "ended",
    "suspended",
    "item-closed",
    "attempts-exhausted",
    "review-not-allowed",
    "solution-not-allowed",
    "comment-not-allowed",
    "wrong-submission-mode",
    "time-over",
    "support-not-available",
    "unknown-item",
    "linear-backward",
  ];

  /** Where an action that the state does not allow changes nothing and is accepted: `next-attempt` during an attempt, `resume` of a session that runs. */
  const NoChange: Partial<Record<CandidateAction["type"], (view: CandidateView) => boolean>> = {
    "next-attempt": (view) => view.current?.status === "interacting",
    resume: (view) => view.status !== "suspended",
  };

  /** An action of each type on an item instance, with whatever data it needs. */
  function sampleOf(type: CandidateAction["type"], item: ItemKey): CandidateAction {
    switch (type) {
      case "set-responses":
        return { type, item, responses: new Map() };
      case "end-attempt":
        return { type, item, interaction: "HINT" };
      case "comment":
        return { type, item, text: "A note" };
      case "move":
        return { type, to: "next" };
      case "support":
        return { type, name: "line-reader", active: true };
      case "submit":
      case "skip":
      case "next-attempt":
      case "review":
      case "solution":
        return { type, item };
      case "end-part":
      case "end-test":
      case "suspend":
      case "resume":
        return { type };
    }
  }

  // The 100 runs of this property take half a second, and five times that on a busy host. Four tests of 25 runs each,
  // with a seed of their own, check as many flows and keep each test far from the limit of a test.
  it.for([1, 2, 3, 4])(
    "shows at every step a view that reads back equal from its JSON text and from a state read back (runs %i of 4)",
    () => {
      fc.assert(
        fc.property(flows, engineMoves, seeds, (flow, moves, seed) => {
          const engine = flowEngine(flow);
          session(engine, seed, moves, (before, action, step) => {
            const written = serializeState(before);
            const states = step.ok ? [before, step.state] : [before];
            for (const state of states) {
              const view = engine.view(state, action.at);
              expect(viewFromJson(throughText(viewToJson(view)))).toEqual(view);
              expect(engine.view(deserializeState(serializeState(state)), action.at)).toEqual(view);
              expect(view.status).toBe(engine.view(state, state.at).status === "ended" ? "ended" : view.status);
            }
            expect(serializeState(before)).toBe(written);
          });
        }),
        { numRuns: 25 },
      );
    },
  );

  it("gives the same step to an action that reaches the engine through the JSON text of a server as to one applied on the device", () => {
    fc.assert(
      fc.property(flows, engineMoves, seeds, (flow, moves, seed) => {
        const engine = flowEngine(flow);
        session(engine, seed, moves, (before, action, step) => {
          if (action.type === "time" || action.type === "supply-scores" || action.type === "cat-response") return;
          const received = parseCandidateAction(throughText(actionToJson(action)));
          const stamped = stamp(before, received, action.at);
          expect(stamped).toEqual(action);
          expect(engine.apply(before, stamped)).toEqual(step);
        });
      }),
    );
  });

  it("lists the actions the state allows: the engine refuses each type left out, and meets no refusal of the state in a type listed", () => {
    fc.assert(
      fc.property(flows, engineMoves, seeds, (flow, moves, seed) => {
        const engine = flowEngine(flow);
        session(engine, seed, moves, (before, action) => {
          const view = engine.view(before, action.at);
          const item = view.current?.key ?? before.current ?? key("none");
          for (const type of CANDIDATE_ACTION_TYPES) {
            const step = engine.apply(before, stamp(before, sampleOf(type, item), action.at));
            if (view.actions.includes(type)) {
              if (!step.ok) expect(Structural, `${type} is listed`).not.toContain(step.refusal.code);
            } else if (!(NoChange[type]?.(view) ?? false)) {
              expect(step.ok, `${type} is accepted though the view leaves it out`).toBe(false);
            }
          }
          expect(view.actions.includes("resume")).toBe(view.status === "suspended");
        });
      }),
    );
  });

  /** A move of the candidate in the leaky test, with the text it types and the milliseconds since the move before. */
  const leakyMoves = fc.array(
    fc.record({
      move: fc.constantFrom(
        "answer",
        "text",
        "submit",
        "skip",
        "review",
        "solution",
        "comment",
        "next-attempt",
        "goto-a",
        "goto-b",
        "next",
        "previous",
        "suspend",
        "resume",
        "time",
        "end-part",
        "end-test",
      ),
      choice: fc.constantFrom("A", "B", "D"),
      typed: fc.string({ maxLength: 12 }).map((typed) => `t${typed}`),
      gap: fc.integer({ min: 0, max: 2_000 }),
    }),
    { maxLength: 25 },
  );

  function leakyAction(
    state: DeliveryState,
    { move, choice, typed }: typeof leakyMoves extends fc.Arbitrary<(infer T)[]> ? T : never,
  ): CandidateAction | HostAction {
    const item = state.current ?? key("a");
    switch (move) {
      case "answer":
        return { type: "set-responses", item, responses: new Map([["RESPONSE", identifier(choice)]]) };
      case "text":
        return { type: "set-responses", item, responses: new Map([["TEXT", text(typed)]]) };
      case "comment":
        return { type: "comment", item, text: typed };
      case "goto-a":
      case "goto-b":
        return { type: "move", to: key(move.slice(-1)) };
      case "next":
      case "previous":
        return { type: "move", to: move };
      case "submit":
      case "skip":
      case "review":
      case "solution":
      case "next-attempt":
        return { type: move, item };
      case "suspend":
      case "resume":
      case "end-part":
      case "end-test":
      case "time":
        return { type: move };
    }
  }

  it("never lets a correct response, mapping, processing, outcome, template value or hidden content into the view", () => {
    const engine = leakyEngine();
    fc.assert(
      fc.property(leakyMoves, seeds, (moves, seed) => {
        let { state } = begun(engine, { seed });
        let now = 0;
        const check = (shown: DeliveryState): void => {
          const view = engine.view(shown, now);
          // The correct response of the text is shown in the solution state of item a, which the control allows, and nowhere else.
          const solution = view.current?.key.ref === "a" && view.current.status === "solution";
          expect(leaksIn(view)).toEqual(solution ? ["LEAK-CORRECT-TEXT"] : []);
        };
        check(state);
        for (const move of moves) {
          now += move.gap;
          const step = engine.apply(state, stamp(state, leakyAction(state, move), now));
          if (step.ok) state = step.state;
          check(state);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("reads back the responses of any action, of any cardinality and base type, from the JSON text", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.tuple(identifierArbitrary, anyValue), { selector: ([name]) => name }),
        (entries) => {
          const action: CandidateAction = { type: "set-responses", item: key("a", 2), responses: new Map(entries) };
          expect(parseCandidateAction(throughText(actionToJson(action)))).toEqual(action);
        },
      ),
    );
  });
});
