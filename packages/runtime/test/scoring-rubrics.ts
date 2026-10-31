import type { RubricKind, ScoringRubric } from "../src/index.js";

/** The example of the convention, as it is written in the guide: one analytic rubric of an essay. */
export const ESSAY_MARKUP = `<qti-rubric-block view="scorer" use="scoring" class="external-scoring-rubric" xml:lang="en"
    data-outcome-identifier="SCORE" data-rubric-kind="analytic">
  <qti-content-body>
    <p>Rate the essay on each criterion.</p>
    <ol>
      <li data-criterion-identifier="content" data-weight="2">
        <p>Content: the response addresses the task.</p>
        <ol>
          <li data-score="0" data-quality="Absent">No idea relates to the task.</li>
          <li data-score="1" data-quality="Partial">Some ideas relate to the task.</li>
          <li data-score="2" data-quality="Full">Every idea addresses the task.</li>
        </ol>
      </li>
      <li data-criterion-identifier="language">
        <p>Language: grammar and vocabulary.</p>
        <ol>
          <li data-score="0" data-quality="Weak">Errors block meaning.</li>
          <li data-score="1" data-quality="Adequate">Errors do not block meaning.</li>
        </ol>
      </li>
    </ol>
  </qti-content-body>
</qti-rubric-block>`;

export const ESSAY: ScoringRubric = {
  outcomeIdentifier: "SCORE",
  kind: "analytic",
  language: "en",
  criteria: [
    {
      identifier: "content",
      weight: 2,
      description: "Content: the response addresses the task.",
      levels: [
        { score: 0, quality: "Absent", description: "No idea relates to the task." },
        { score: 1, quality: "Partial", description: "Some ideas relate to the task." },
        { score: 2, quality: "Full", description: "Every idea addresses the task." },
      ],
    },
    {
      identifier: "language",
      weight: 1,
      description: "Language: grammar and vocabulary.",
      levels: [
        { score: 0, quality: "Weak", description: "Errors block meaning." },
        { score: 1, quality: "Adequate", description: "Errors do not block meaning." },
      ],
    },
  ],
};

/** A rubric of a kind with the criteria and levels that its shape requires, for the sums that can be derived by hand. */
export const KIND_EXAMPLES: Readonly<Record<RubricKind, ScoringRubric>> = {
  analytic: ESSAY,
  holistic: {
    outcomeIdentifier: "SCORE",
    kind: "holistic",
    criteria: [{ identifier: "overall", weight: 1, levels: [0, 1, 2, 3, 4].map((score) => ({ score })) }],
  },
  checklist: {
    outcomeIdentifier: "SCORE",
    kind: "checklist",
    criteria: [
      { identifier: "title", weight: 1, levels: [{ score: 0 }, { score: 1 }] },
      { identifier: "date", weight: 1, levels: [{ score: 1 }, { score: 0 }] },
      { identifier: "signature", weight: 2, levels: [{ score: 0 }, { score: 1 }] },
    ],
  },
  "single-point": {
    outcomeIdentifier: "SCORE",
    kind: "single-point",
    criteria: [
      { identifier: "clarity", weight: 1, levels: [{ score: 0 }, { score: 1 }, { score: 2 }] },
      { identifier: "depth", weight: 3, levels: [{ score: 1 }, { score: 2 }, { score: 3 }] },
    ],
  },
};
