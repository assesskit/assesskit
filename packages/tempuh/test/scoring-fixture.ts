import { ASI_NAMESPACE, type AssessmentItem, type AssessmentTest, readAsi } from "@luthfanwakan/olah/asi";
import {
  type Action,
  createEngine,
  type DeliveryState,
  type Engine,
  type ItemKey,
  type ScorerView,
  type Step,
} from "@luthfanwakan/olah/delivery";
import { single, type Value } from "@luthfanwakan/olah/values";

/** Throws, so that a fixture that is not what a test expects fails by name. */
export function fail(message: string): never {
  throw new Error(message);
}

/** An item from its identifier, attributes and content. */
function itemOf(identifier: string, content: string): AssessmentItem {
  const document = readAsi(
    `<qti-assessment-item xmlns="${ASI_NAMESPACE}" identifier="${identifier}" title="Item ${identifier}" time-dependent="false">${content}</qti-assessment-item>`,
  );
  return document.kind === "item" ? document.item : fail(`Expected an item, found ${document.kind}.`);
}

/**
 * An item with an essay and a `SCORE` that a person gives, 0 to 10. Its body has a rubric block for the candidate and one
 * for the scorer, and a text with an image, so that the display has content to draw.
 */
export function essay(identifier: string, scorer: "human" | "none" = "human"): AssessmentItem {
  const external = scorer === "none" ? "" : ' external-scored="human"';
  return itemOf(
    identifier,
    `<qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="string"/>
    <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"${external} normal-minimum="0" normal-maximum="10" interpretation="Essay score"/>
    <qti-item-body>
      <qti-rubric-block view="candidate" use="instructions"><qti-content-body><p>Write about ${identifier}.</p></qti-content-body></qti-rubric-block>
      <p>Look at <img src="images/${identifier}.png" alt="Picture of ${identifier}"/>.</p>
      <qti-extended-text-interaction response-identifier="RESPONSE"/>
      <qti-rubric-block view="scorer" use="scoring"><qti-content-body><p>Give 0 to 10 points for ${identifier}.</p></qti-content-body></qti-rubric-block>
    </qti-item-body>`,
  );
}

/**
 * An item with a choice whose key is `B`, a template variable `N` that template processing sets to 4, and a `SCORE` that a
 * person gives, so that the scorer view has a correct response and a template value.
 */
export function pick(identifier: string): AssessmentItem {
  return itemOf(
    identifier,
    `<qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier">
      <qti-correct-response><qti-value>B</qti-value></qti-correct-response>
    </qti-response-declaration>
    <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float" external-scored="human"/>
    <qti-template-declaration identifier="N" cardinality="single" base-type="integer"/>
    <qti-template-processing><qti-set-template-value identifier="N"><qti-base-value base-type="integer">4</qti-base-value></qti-set-template-value></qti-template-processing>
    <qti-item-body>
      <p>Choose the letter for <qti-printed-variable identifier="N"/>.</p>
      <qti-choice-interaction response-identifier="RESPONSE" max-choices="1">
        <qti-simple-choice identifier="A">A</qti-simple-choice><qti-simple-choice identifier="B">B</qti-simple-choice>
      </qti-choice-interaction>
    </qti-item-body>`,
  );
}

/** The rubric block that names the responses an externally scored outcome of the test covers (olah convention, §4.16). */
export const covers = (outcomeId: string, entries: readonly (readonly [string, string])[], notes = ""): string =>
  `<qti-rubric-block view="scorer" use="scoring" class="external-score-covers" data-outcome-identifier="${outcomeId}"><qti-content-body>${notes}<ul>${entries
    .map(([ref, label]) => `<li data-item-ref="${ref}" data-response-identifier="RESPONSE">${label}</li>`)
    .join("")}</ul></qti-content-body></qti-rubric-block>`;

/** The item references of the identifiers, `href` the identifier. */
const refs = (identifiers: readonly string[]): string =>
  identifiers.map((id) => `<qti-assessment-item-ref identifier="${id}" href="${id}"/>`).join("");

/** A test from its content: declarations and rubric, then the part, in the order of the schema. */
function testOf(content: string): AssessmentTest {
  const document = readAsi(
    `<qti-assessment-test xmlns="${ASI_NAMESPACE}" identifier="T" title="T">${content}</qti-assessment-test>`,
  );
  return document.kind === "test" ? document.test : fail(`Expected a test, found ${document.kind}.`);
}

/**
 * An engine of a test with one linear part and one section that refer to the items, and one externally scored outcome
 * `WRITING` of the test, 0 to 6, which the block `covers` names.
 */
export function writingEngine(items: Readonly<Record<string, AssessmentItem>>, coversBlock: string): Engine {
  const identifiers = Object.keys(items);
  return createEngine({
    kind: "test",
    test: testOf(
      `<qti-outcome-declaration identifier="WRITING" cardinality="single" base-type="float" external-scored="human" normal-maximum="6" mastery-value="4"/>
      ${coversBlock}
      <qti-test-part identifier="P" navigation-mode="linear" submission-mode="individual">
        <qti-assessment-section identifier="S" title="S" visible="true">${refs(identifiers)}</qti-assessment-section>
      </qti-test-part>`,
    ),
    base: "test.xml",
    resolvers: {
      items: (href) => {
        const item = items[href] ?? fail(`The test has no item ${href}.`);
        return { resource: href, deliverable: { kind: "qti", item }, hazards: [], variants: [] };
      },
      sections: () => fail("The test has no section reference."),
      stimuli: () => fail("The test has no stimulus."),
    },
  });
}

/** An engine that delivers one item alone. */
export function itemEngine(item: AssessmentItem): Engine {
  return createEngine({ kind: "item", item, base: "item.xml" });
}

/** Returns the step, which must have been accepted. */
export function accepted(step: Step): Extract<Step, { readonly ok: true }> {
  return step.ok ? step : fail(`The action was refused: ${step.refusal.code}: ${step.refusal.message}`);
}

/** Starts a session with the seed 1 at the time 0. */
export function begin(engine: Engine): DeliveryState {
  return accepted(engine.start({ seed: 1, at: 0 })).state;
}

/** Applies actions in order, each of which must be accepted; returns the last state. */
export function play(engine: Engine, state: DeliveryState, ...actions: readonly Action[]): DeliveryState {
  return actions.reduce((current, action) => accepted(engine.apply(current, action)).state, state);
}

const key = (ref: string, instance = 1): ItemKey => ({ ref, instance });

/** An action that sets the response of an item to a value. */
export const answer = (ref: string, value: Value | null, at: number): Action => ({
  type: "set-responses",
  item: key(ref),
  responses: new Map([["RESPONSE", value]]),
  at,
});

/** An action that sets the string response of an essay. */
export const write = (ref: string, text: string, at: number): Action =>
  answer(ref, single("string", text) ?? fail("A string value cannot be empty."), at);

/** An action on an item that needs no more than the item. */
export const act = (type: "submit" | "skip", ref: string, at: number): Action => ({ type, item: key(ref), at });

/** The scorer view of the first request that waits. */
export function firstScorerView(engine: Engine, state: DeliveryState): ScorerView {
  const [request] = engine.pending(state).scoring;
  return engine.scorerView(state, (request ?? fail("No request waits.")).id);
}
