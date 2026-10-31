/** A choice item scored by the match-correct template. */
export const CHOICE_ITEM = `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="choice" title="Choice"
    adaptive="false" time-dependent="false">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier">
    <qti-correct-response><qti-value>B</qti-value></qti-correct-response>
  </qti-response-declaration>
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float">
    <qti-default-value><qti-value>0</qti-value></qti-default-value>
  </qti-outcome-declaration>
  <qti-item-body>
    <qti-choice-interaction response-identifier="RESPONSE" max-choices="1">
      <qti-prompt>Which letter comes second?</qti-prompt>
      <qti-simple-choice identifier="A">A</qti-simple-choice>
      <qti-simple-choice identifier="B">B</qti-simple-choice>
    </qti-choice-interaction>
  </qti-item-body>
  <qti-response-processing template="https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/match_correct"/>
</qti-assessment-item>
`;

/** An item that draws a template value from a seeded generator. */
export const TEMPLATE_ITEM = `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="template" title="Template"
    adaptive="false" time-dependent="false">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="integer"/>
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float">
    <qti-default-value><qti-value>0</qti-value></qti-default-value>
  </qti-outcome-declaration>
  <qti-template-declaration identifier="N" cardinality="single" base-type="integer"/>
  <qti-template-processing>
    <qti-set-template-value identifier="N">
      <qti-random-integer min="1" max="1000"/>
    </qti-set-template-value>
  </qti-template-processing>
  <qti-item-body>
    <p>Type <qti-printed-variable identifier="N"/>: <qti-text-entry-interaction response-identifier="RESPONSE"/></p>
  </qti-item-body>
  <qti-response-processing>
    <qti-response-condition>
      <qti-response-if>
        <qti-equal><qti-variable identifier="RESPONSE"/><qti-variable identifier="N"/></qti-equal>
        <qti-set-outcome-value identifier="SCORE"><qti-base-value base-type="float">1</qti-base-value></qti-set-outcome-value>
      </qti-response-if>
    </qti-response-condition>
  </qti-response-processing>
</qti-assessment-item>
`;

/**
 * An item that counts its response processing runs in RUNS, adds 1 to SCORE for the correct response B, sets FEEDBACK
 * when the hint ends the attempt, and completes at the correct response when `completes` is true.
 */
export function sessionItem(adaptive: boolean, completes = adaptive): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="session" title="Session"
    adaptive="${adaptive}" time-dependent="false">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier">
    <qti-correct-response><qti-value>B</qti-value></qti-correct-response>
  </qti-response-declaration>
  <qti-response-declaration identifier="HINT" cardinality="single" base-type="boolean"/>
  <qti-outcome-declaration identifier="RUNS" cardinality="single" base-type="integer"/>
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"/>
  <qti-outcome-declaration identifier="FEEDBACK" cardinality="single" base-type="identifier"/>
  <qti-item-body>
    <qti-choice-interaction response-identifier="RESPONSE" max-choices="1">
      <qti-simple-choice identifier="A">A</qti-simple-choice>
      <qti-simple-choice identifier="B">B</qti-simple-choice>
      <qti-simple-choice identifier="C">C</qti-simple-choice>
    </qti-choice-interaction>
    <p><qti-end-attempt-interaction response-identifier="HINT" title="Hint"/></p>
  </qti-item-body>
  <qti-response-processing>
    <qti-set-outcome-value identifier="RUNS">
      <qti-sum><qti-variable identifier="RUNS"/><qti-base-value base-type="integer">1</qti-base-value></qti-sum>
    </qti-set-outcome-value>
    <qti-response-condition>
      <qti-response-if>
        <qti-variable identifier="HINT"/>
        <qti-set-outcome-value identifier="FEEDBACK"><qti-base-value base-type="identifier">hint</qti-base-value></qti-set-outcome-value>
      </qti-response-if>
      <qti-response-else-if>
        <qti-match><qti-variable identifier="RESPONSE"/><qti-correct identifier="RESPONSE"/></qti-match>
        <qti-set-outcome-value identifier="SCORE">
          <qti-sum><qti-variable identifier="SCORE"/><qti-base-value base-type="float">1</qti-base-value></qti-sum>
        </qti-set-outcome-value>
        ${completes ? '<qti-set-outcome-value identifier="completionStatus"><qti-base-value base-type="identifier">completed</qti-base-value></qti-set-outcome-value>' : ""}
      </qti-response-else-if>
    </qti-response-condition>
  </qti-response-processing>
</qti-assessment-item>
`;
}
