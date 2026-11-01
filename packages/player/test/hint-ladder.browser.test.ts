import { ASI_NAMESPACE, type ItemSessionControl, readAsi } from "@assesskit/runtime/asi";
import { afterEach, describe, expect, it } from "vitest";
import {
  choose,
  hintsShown,
  press,
  processed,
  removeHintPages,
  SECOND,
  shown,
  startHints,
  wireFloat,
  wireIdentifier,
  wireInteger,
} from "./hint-fixture.js";
import { axeViolations } from "./renderer-fixture.js";
import { waitFor } from "./wait.js";

afterEach(removeHintPages);

/**
 * An adaptive item with a ladder of three hints. Each hint request adds 1 to `HINTS`, which adaptive items keep between
 * attempts, and shows the hint of that rung. A correct answer completes the item with a score that costs a quarter for
 * each hint; a wrong answer completes it, with no score, once the ladder is used up.
 */
const LADDER = `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="${ASI_NAMESPACE}" identifier="ladder" title="Ladder" adaptive="true" time-dependent="false">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier">
    <qti-correct-response><qti-value>B</qti-value></qti-correct-response>
  </qti-response-declaration>
  <qti-response-declaration identifier="HINT" cardinality="single" base-type="boolean"/>
  <qti-outcome-declaration identifier="HINTS" cardinality="single" base-type="integer"><qti-default-value><qti-value>0</qti-value></qti-default-value></qti-outcome-declaration>
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"><qti-default-value><qti-value>0</qti-value></qti-default-value></qti-outcome-declaration>
  <qti-outcome-declaration identifier="FEEDBACK" cardinality="single" base-type="identifier"/>
  <qti-item-body>
    <qti-choice-interaction response-identifier="RESPONSE" shuffle="false" max-choices="1">
      <qti-prompt>Which is larger?</qti-prompt>
      <qti-simple-choice identifier="A">3</qti-simple-choice>
      <qti-simple-choice identifier="B">7</qti-simple-choice>
    </qti-choice-interaction>
    <p><qti-end-attempt-interaction response-identifier="HINT" title="Show a hint"/></p>
    <qti-feedback-block outcome-identifier="FEEDBACK" identifier="hint1" show-hide="show"><qti-content-body><p>Compare the digits.</p></qti-content-body></qti-feedback-block>
    <qti-feedback-block outcome-identifier="FEEDBACK" identifier="hint2" show-hide="show"><qti-content-body><p>Seven is more than five.</p></qti-content-body></qti-feedback-block>
    <qti-feedback-block outcome-identifier="FEEDBACK" identifier="hint3" show-hide="show"><qti-content-body><p>The answer is the second choice.</p></qti-content-body></qti-feedback-block>
  </qti-item-body>
  <qti-response-processing>
    <qti-set-outcome-value identifier="FEEDBACK"><qti-base-value base-type="identifier">none</qti-base-value></qti-set-outcome-value>
    <qti-response-condition>
      <qti-response-if>
        <qti-variable identifier="HINT"/>
        <qti-set-outcome-value identifier="HINTS"><qti-sum><qti-variable identifier="HINTS"/><qti-base-value base-type="integer">1</qti-base-value></qti-sum></qti-set-outcome-value>
        <qti-response-condition>
          <qti-response-if>
            <qti-equal-rounded rounding-mode="decimalPlaces" figures="0"><qti-integer-to-float><qti-variable identifier="HINTS"/></qti-integer-to-float><qti-base-value base-type="float">1</qti-base-value></qti-equal-rounded>
            <qti-set-outcome-value identifier="FEEDBACK"><qti-base-value base-type="identifier">hint1</qti-base-value></qti-set-outcome-value>
          </qti-response-if>
          <qti-response-else-if>
            <qti-equal-rounded rounding-mode="decimalPlaces" figures="0"><qti-integer-to-float><qti-variable identifier="HINTS"/></qti-integer-to-float><qti-base-value base-type="float">2</qti-base-value></qti-equal-rounded>
            <qti-set-outcome-value identifier="FEEDBACK"><qti-base-value base-type="identifier">hint2</qti-base-value></qti-set-outcome-value>
          </qti-response-else-if>
          <qti-response-else>
            <qti-set-outcome-value identifier="FEEDBACK"><qti-base-value base-type="identifier">hint3</qti-base-value></qti-set-outcome-value>
          </qti-response-else>
        </qti-response-condition>
      </qti-response-if>
      <qti-response-else>
        <qti-response-condition>
          <qti-response-if>
            <qti-match><qti-variable identifier="RESPONSE"/><qti-correct identifier="RESPONSE"/></qti-match>
            <qti-set-outcome-value identifier="SCORE">
              <qti-subtract>
                <qti-base-value base-type="float">1</qti-base-value>
                <qti-product><qti-base-value base-type="float">0.25</qti-base-value><qti-integer-to-float><qti-variable identifier="HINTS"/></qti-integer-to-float></qti-product>
              </qti-subtract>
            </qti-set-outcome-value>
            <qti-set-outcome-value identifier="completionStatus"><qti-base-value base-type="identifier">completed</qti-base-value></qti-set-outcome-value>
          </qti-response-if>
          <qti-response-else-if>
            <qti-gte><qti-variable identifier="HINTS"/><qti-base-value base-type="integer">3</qti-base-value></qti-gte>
            <qti-set-outcome-value identifier="completionStatus"><qti-base-value base-type="identifier">completed</qti-base-value></qti-set-outcome-value>
          </qti-response-else-if>
          <qti-response-else>
            <qti-set-outcome-value identifier="FEEDBACK"><qti-base-value base-type="identifier">wrong</qti-base-value></qti-set-outcome-value>
          </qti-response-else>
        </qti-response-condition>
      </qti-response-else>
    </qti-response-condition>
  </qti-response-processing>
</qti-assessment-item>`;

/** The item session control of a host that lets the candidate see the solution of a closed item. */
function solutionControl(): ItemSessionControl {
  const document = readAsi(
    `<qti-assessment-test xmlns="${ASI_NAMESPACE}" identifier="T" title="T">
       <qti-test-part identifier="P" navigation-mode="nonlinear" submission-mode="individual">
         <qti-item-session-control show-solution="true"/>
         <qti-assessment-section identifier="S" title="S" visible="true"><qti-assessment-item-ref identifier="ladder" href="ladder.xml"/></qti-assessment-section>
       </qti-test-part>
     </qti-assessment-test>`,
  );
  const control = document.kind === "test" ? document.test.testParts[0]?.itemSessionControl : undefined;
  if (control === undefined) throw new Error("The fixture test has no item session control.");
  return control;
}

describe("a hint ladder in the player", () => {
  it("shows one more hint for each request and completes with the score that the hints cost", async () => {
    const ladder = await startHints(LADDER);
    await shown(ladder);
    for (const [rung, hint] of [
      [1, "Compare the digits."],
      [2, "Seven is more than five."],
    ] as const) {
      ladder.clock.advance(2 * SECOND);
      await press(ladder, "Show a hint");
      await waitFor(() => expect(hintsShown(ladder)).toEqual([hint]));
      expect(processed(ladder)).toHaveLength(rung);
      ladder.clock.advance(1 * SECOND);
      await press(ladder, "Try again");
    }
    await choose(ladder, "7");
    ladder.clock.advance(4 * SECOND);
    await press(ladder, "Submit answer");
    await waitFor(() => expect(ladder.client.view.current?.status).toBe("closed"));
    expect(ladder.client.view.status).toBe("in-progress");
    const attempts = processed(ladder).map(({ attempt, duration, outcomes }) => ({
      attempt,
      duration,
      hints: outcomes?.HINTS,
      score: outcomes?.SCORE,
      completion: outcomes?.completionStatus,
    }));
    expect(attempts).toEqual([
      {
        attempt: 1,
        duration: 2_000,
        hints: wireInteger(1),
        score: wireFloat(0),
        completion: wireIdentifier("unknown"),
      },
      {
        attempt: 2,
        duration: 5_000,
        hints: wireInteger(2),
        score: wireFloat(0),
        completion: wireIdentifier("unknown"),
      },
      {
        attempt: 3,
        duration: 10_000,
        hints: wireInteger(2),
        score: wireFloat(0.5),
        completion: wireIdentifier("completed"),
      },
    ]);
  });

  it("completes a ladder that is used up with no score, and then shows the solution", async () => {
    const ladder = await startHints(LADDER, solutionControl());
    await shown(ladder);
    for (const hint of ["Compare the digits.", "Seven is more than five.", "The answer is the second choice."]) {
      await press(ladder, "Show a hint");
      await waitFor(() => expect(hintsShown(ladder)).toEqual([hint]));
      await press(ladder, "Try again");
    }
    await choose(ladder, "3");
    await press(ladder, "Submit answer");
    await waitFor(() => expect(ladder.client.view.current?.status).toBe("closed"));
    expect(processed(ladder).map(({ outcomes }) => outcomes?.SCORE)).toEqual([0, 0, 0, 0].map(wireFloat));
    await press(ladder, "Show solution");
    await waitFor(() => expect(ladder.client.view.current?.status).toBe("solution"));
    expect(ladder.client.view.current?.responses.get("RESPONSE")).toMatchObject({ value: "B" });
  });

  it("has no accessibility violations on a rung of the ladder", async () => {
    const ladder = await startHints(LADDER);
    await shown(ladder);
    await press(ladder, "Show a hint");
    await waitFor(() => expect(hintsShown(ladder)).toHaveLength(1));
    expect(await axeViolations(ladder.page)).toEqual([]);
  });
});
