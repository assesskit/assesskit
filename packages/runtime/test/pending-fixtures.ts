import {
  type Action,
  ASI_NAMESPACE,
  type AssessmentItem,
  type AssessmentTest,
  type CatPort,
  type CatRequest,
  type CatSectionRef,
  type CreateSessionRequest,
  createEngine,
  type DeliveryEvent,
  type DeliveryState,
  type Engine,
  type EngineOptions,
  type ItemKey,
  type PersonalNeedsProfile,
  PNP_NAMESPACE,
  type Refusal,
  type ResolvedItem,
  readAsi,
  readPnp,
  type StartOptions,
  type SubmitResultsRequest,
  single,
} from "../src/index.js";

/** Throws an error with a message; a test calls it where a result of the wrong kind would end the test. */
export function fail(message: string): never {
  throw new Error(message);
}

/** An item from its attributes and content. */
function itemOf(identifier: string, attributes: string, content: string): AssessmentItem {
  const document = readAsi(
    `<qti-assessment-item xmlns="${ASI_NAMESPACE}" identifier="${identifier}" title="Item ${identifier}" ${attributes}>${content}</qti-assessment-item>`,
  );
  return document.kind === "item" ? document.item : fail(`Expected an item, found ${document.kind}.`);
}

const CHOICES = `<qti-simple-choice identifier="A">A</qti-simple-choice><qti-simple-choice identifier="B">B</qti-simple-choice><qti-simple-choice identifier="C">C</qti-simple-choice>`;

/** The options of {@link essay}. */
export interface EssayOptions {
  /** Who scores `SCORE`, or `"none"` for an outcome that nobody scores. Default: `"human"`. */
  readonly scorer?: "human" | "externalMachine" | "none";
  /** The `variable-identifier-ref` of `SCORE`. Default: none. */
  readonly ref?: string;
  /** Extra declarations of the item. Default: none. */
  readonly declarations?: string;
  /** Response processing, after the body. Default: none. */
  readonly responseProcessing?: string;
  /** More content of the item body, after the rubric for the scorer. Default: none. */
  readonly body?: string;
  /** More attributes of the item, such as `xml:lang`. Default: none. */
  readonly attributes?: string;
}

/** An item with an essay and a `SCORE` that no response processing sets, and a rubric for the scorer. */
export function essay(identifier: string, options: EssayOptions = {}): AssessmentItem {
  const { scorer = "human", ref, declarations = "", responseProcessing = "", body = "", attributes = "" } = options;
  const external = scorer === "none" ? "" : ` external-scored="${scorer}"`;
  const reference = ref === undefined ? "" : ` variable-identifier-ref="${ref}"`;
  return itemOf(
    identifier,
    `time-dependent="false"${attributes === "" ? "" : ` ${attributes}`}`,
    `<qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="string"/>
    <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"${external}${reference} normal-minimum="0" normal-maximum="10" interpretation="Essay score"/>
    ${declarations}
    <qti-item-body>
      <qti-extended-text-interaction response-identifier="RESPONSE"/>
      <qti-rubric-block view="scorer" use="scoring"><qti-content-body><p>Give 0 to 10 points for ${identifier}.</p></qti-content-body></qti-rubric-block>${body}
    </qti-item-body>
    ${responseProcessing}`,
  );
}

/** An item with one choice, scored 1 by the standard template when the answer is `B`. */
export function choice(identifier: string, attributes = 'time-dependent="false"'): AssessmentItem {
  return itemOf(
    identifier,
    attributes,
    `<qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier">
      <qti-correct-response><qti-value>B</qti-value></qti-correct-response>
    </qti-response-declaration>
    <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"/>
    <qti-item-body>
      <qti-choice-interaction response-identifier="RESPONSE" max-choices="1" shuffle="true">${CHOICES}</qti-choice-interaction>
    </qti-item-body>
    <qti-response-processing template="https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/match_correct"/>`,
  );
}

/** The resolution of an item reference to a QTI item. */
function resolution(item: AssessmentItem): ResolvedItem {
  return { resource: item.identifier, deliverable: { kind: "qti", item }, hazards: [], variants: [] };
}

/** The resolution of an item reference to the link to a tool. */
export function linkResolution(identifier: string): ResolvedItem {
  return {
    resource: identifier,
    deliverable: {
      kind: "lti",
      identifier,
      link: { title: "Tool", launchUrl: "https://tool.example/launch", custom: new Map(), extensions: [] },
    },
    hazards: [],
    variants: [],
  };
}

/** The item references of the identifiers, `href` the identifier. */
export const refs = (...identifiers: string[]): string =>
  identifiers.map((id) => `<qti-assessment-item-ref identifier="${id}" href="${id}"/>`).join("");

/** A section; its content follows the order of the schema. */
export const section = (id: string, content: string): string =>
  `<qti-assessment-section identifier="${id}" title="${id}" visible="true">${content}</qti-assessment-section>`;

/** A test part. */
export const part = (
  id: string,
  sections: string,
  navigation: "linear" | "nonlinear" = "linear",
  submission: "individual" | "simultaneous" = "individual",
  head = "",
): string =>
  `<qti-test-part identifier="${id}" navigation-mode="${navigation}" submission-mode="${submission}">${head}${sections}</qti-test-part>`;

/** The adaptive selection of a section: the engine, with the settings file. */
export const ADAPTIVE =
  '<qti-adaptive-selection><qti-adaptive-engine-ref identifier="engine" href="https://cat.example/api"/><qti-adaptive-settings-ref identifier="settings" href="settings.json"/></qti-adaptive-selection>';

/** An outcome declaration of the test. */
export const outcome = (id: string, baseType: string, attributes = "", defaultValue?: string): string =>
  `<qti-outcome-declaration identifier="${id}" cardinality="single" base-type="${baseType}"${attributes === "" ? "" : ` ${attributes}`}>${defaultValue === undefined ? "" : `<qti-default-value><qti-value>${defaultValue}</qti-value></qti-default-value>`}</qti-outcome-declaration>`;

/** Outcome processing that sets `outcome` to the expression. */
export const setOutcome = (id: string, expression: string): string =>
  `<qti-set-outcome-value identifier="${id}">${expression}</qti-set-outcome-value>`;

/** The sum of the `SCORE`s of the items. */
export const SUM_SCORES = '<qti-sum><qti-test-variables variable-identifier="SCORE"/></qti-sum>';

/** Outcome processing from its rules. */
export const processing = (...rules: string[]): string =>
  `<qti-outcome-processing>${rules.join("")}</qti-outcome-processing>`;

/** A test from its content: declarations, rubric, parts, outcome processing, in the order of the schema. */
function testOf(content: string): AssessmentTest {
  const document = readAsi(
    `<qti-assessment-test xmlns="${ASI_NAMESPACE}" identifier="T" title="T">${content}</qti-assessment-test>`,
  );
  return document.kind === "test" ? document.test : fail(`Expected a test, found ${document.kind}.`);
}

/** What an engine of {@link engineOf} needs besides the content. */
export interface EngineSetup {
  /** The items by `href`; an item reference whose href is not here names a choice item of that identifier. */
  readonly items?: Readonly<Record<string, AssessmentItem | ResolvedItem>>;
  /** The CAT engine of each adaptive section. Default: none. */
  readonly cat?: ReadonlyMap<string, CatSectionRef>;
  /** The options of `createEngine`. Default: none. */
  readonly options?: EngineOptions;
}

/** An engine of a test whose item references name the items given by href. */
export function engineOf(content: string, setup: EngineSetup = {}): Engine {
  const { items = {}, cat = new Map(), options = {} } = setup;
  return createEngine(
    {
      kind: "test",
      test: testOf(content),
      base: "test.xml",
      catSections: cat,
      resolvers: {
        items: (href) => {
          const named = items[href] ?? choice(href);
          return "deliverable" in named ? named : resolution(named);
        },
        sections: () => fail("The test has no section reference."),
        stimuli: () => fail("The test has no stimulus."),
      },
    },
    options,
  );
}

/** The CAT engine of the section `A`. */
export const CAT_A: ReadonlyMap<string, CatSectionRef> = new Map([
  ["A", { prefix: "https://cat.example/api", sectionIdentifier: "section-1" }],
]);

/** A state and the events of the steps that led to it. */
export interface Played {
  readonly state: DeliveryState;
  readonly events: readonly DeliveryEvent[];
}

/** Starts a session with the seed 1 at the time 0, unless the options say otherwise. */
export function begun(engine: Engine, options: Partial<StartOptions> = {}): Played {
  const step = engine.start({ seed: 1, at: 0, ...options });
  return step.ok ? step : fail(`The start was refused: ${step.refusal.code}.`);
}

/** Applies actions in order, each of which must be accepted; returns the last state and the events of every step. */
export function played(engine: Engine, state: DeliveryState, ...actions: Action[]): Played {
  const events: DeliveryEvent[] = [];
  let current = state;
  for (const action of actions) {
    const step = engine.apply(current, action);
    if (!step.ok) {
      fail(`The action ${action.type} at ${action.at} was refused: ${step.refusal.code}: ${step.refusal.message}`);
    }
    current = step.state;
    events.push(...step.events);
  }
  return { state: current, events };
}

/** The refusal of an action, which must be refused. */
export function refusalOf(engine: Engine, state: DeliveryState, action: Action): Refusal {
  const step = engine.apply(state, action);
  return step.ok ? fail(`The action ${action.type} was accepted.`) : step.refusal;
}

export const key = (ref: string, instance = 1): ItemKey => ({ ref, instance });

/** An action that sets the string response of an essay, or the identifier response of a choice. */
export const write = (ref: string, text: string, at: number, instance = 1): Action => ({
  type: "set-responses",
  item: key(ref, instance),
  responses: new Map([["RESPONSE", single("string", text) ?? fail("A string value cannot be empty.")]]),
  at,
});

/** An action that sets the choice of a choice item. */
export const pick = (ref: string, selected: string, at: number, instance = 1): Action => ({
  type: "set-responses",
  item: key(ref, instance),
  responses: new Map([["RESPONSE", single("identifier", selected)]]),
  at,
});

/** An action on an item that needs no more than the item. */
export const act = (type: "submit" | "skip", ref: string, at: number, instance = 1): Action => ({
  type,
  item: key(ref, instance),
  at,
});

/** An action that moves to the next item. */
export const next = (at: number): Action => ({ type: "move", to: "next", at });

/** The events as text: the type, the item or scope, the detail and the time. */
export const described = (events: readonly DeliveryEvent[]): string[] =>
  events.map((event) => {
    const where =
      event.item === undefined
        ? event.scope
        : `${event.item.ref}${event.item.instance > 1 ? `#${event.item.instance}` : ""}`;
    return `${[event.type, where, event.detail].filter((word) => word !== undefined).join(" ")}@${event.at}`;
  });

/** The id of the first request of a kind that waits for a CAT engine. */
export function waiting(engine: Engine, state: DeliveryState): CatRequest {
  return engine.pending(state).cat[0] ?? fail("No CAT request waits.");
}

/** The action that answers the request that waits with the stage given. */
export function stage(
  engine: Engine,
  state: DeliveryState,
  at: number,
  nextItems: { itemIdentifiers: string[]; stageLength?: number } | null,
  extra: { sessionState?: string; assessmentResult?: import("../src/index.js").AssessmentResult } = {},
): Action {
  const request = waiting(engine, state);
  return {
    type: "cat-response",
    request: request.id,
    response:
      request.kind === "create-session"
        ? { sessionIdentifier: "session-1", nextItems: nextItems ?? {}, ...extra }
        : { nextItems, ...extra },
    at,
  };
}

/** A call of the engine to the port, with the arguments after the prefix. */
type PortCall =
  | { readonly method: "createSession"; readonly section: string; readonly request: CreateSessionRequest }
  | {
      readonly method: "submitResults";
      readonly section: string;
      readonly session: string;
      readonly request: SubmitResultsRequest;
    }
  | { readonly method: "endSession"; readonly section: string; readonly session: string };

/** A port that answers from scripts and records its calls. */
export interface FakePort extends CatPort {
  /** The calls in order. */
  readonly calls: PortCall[];
}

/** A port whose Create Session returns the first stage, whose Submit Results returns the stages in turn, then ends. */
export function fakePort(stages: readonly (string[] | null)[], first: string[] = ["i1", "i2"]): FakePort {
  const calls: PortCall[] = [];
  let step = 0;
  return {
    calls,
    createSection: () => fail("The delivery engine does not create sections."),
    getSection: () => fail("The delivery engine does not get sections."),
    endSection: () => fail("The delivery engine does not end sections."),
    createSession: async (_prefix, section, request) => {
      calls.push({ method: "createSession", section, request });
      return { sessionIdentifier: "session-1", nextItems: { itemIdentifiers: first, stageLength: first.length } };
    },
    submitResults: async (_prefix, section, session, request) => {
      calls.push({ method: "submitResults", section, session, request });
      const stageNow = stages[step++] ?? null;
      return stageNow === null
        ? { nextItems: null }
        : { nextItems: { itemIdentifiers: stageNow, stageLength: stageNow.length } };
    },
    endSession: async (_prefix, section, session) => {
      calls.push({ method: "endSession", section, session });
    },
  };
}

/** A profile from its supports and sets. */
export function pnpOf(children: string): PersonalNeedsProfile {
  const read = readPnp(`<access-for-all-pnp xmlns="${PNP_NAMESPACE}">${children}</access-for-all-pnp>`);
  return "supports" in read ? read : fail("The document is a bulk file.");
}

/** The test that the results tests report on: a choice with shuffled choices, an essay, comments allowed, a context variable. */
export function reportedTest(): Engine {
  const content = `<qti-context-declaration identifier="SITE" cardinality="single" base-type="string"><qti-default-value><qti-value>jkt</qti-value></qti-default-value></qti-context-declaration>${outcome("TOTAL", "float")}${part(
    "P",
    section("S", refs("q1", "w")),
    "linear",
    "individual",
    '<qti-item-session-control allow-comment="true"/>',
  )}${processing(setOutcome("TOTAL", SUM_SCORES))}`;
  return engineOf(content, { items: { w: essay("w") } });
}

/** Who took the test in the results tests. */
export const REPORT_CONTEXT = {
  sourcedId: "candidate-1",
  sessionIdentifiers: [{ sourceId: "https://lms.example/", identifier: "S-1" }],
};

/** A session of {@link reportedTest} played to its end: with a profile, a universal support turned on, and a comment. */
export function reportedSession(engine: Engine): Played {
  const start = begun(engine, {
    pnp: pnpOf("<line-reader/>"),
    universalSupports: ["calculator-on-screen"],
    resultContext: REPORT_CONTEXT,
  });
  return played(
    engine,
    start.state,
    pick("q1", "B", 1000),
    { type: "support", name: "calculator-on-screen", active: true, at: 1500 },
    { type: "comment", item: key("q1"), text: "A good question", at: 1800 },
    act("submit", "q1", 2000),
    next(3000),
    write("w", "My essay", 3500),
    act("submit", "w", 4000),
    next(5000),
  );
}
