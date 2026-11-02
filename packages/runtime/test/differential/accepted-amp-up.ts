import type { AcceptedDifference } from "./accepted.js";

/** The items whose template processing draws with `qti-random-integer` or `qti-random`, in which the two draws differ. */
const DRAWN_DIFFERENTLY = [
  "packaging/BBQsTest/id-13b92f311fc0/SineRule-002-maths.xml",
  "packaging/feedbackTest/id-aaa0bbf5da1d/Example03-feedbackBlock-solution-random.xml",
  "packaging/feedbackTest/id-d599169403d2/Example04-feedbackBlock-templateBlock.xml",
  "packaging/items/Example03-feedbackBlock-solution-random.xml",
  "packaging/items/Example04-feedbackBlock-templateBlock.xml",
  "packaging/items/adaptive_template.xml",
  "packaging/items/mc_calc3.xml",
  "packaging/items/mc_calc5.xml",
  "packaging/items/mc_stat2.xml",
  "packaging/items/template.xml",
  "packaging/items/template_image.xml",
];

/** The differences from Amp-up qti3-item-player that the specification settles in the runtime's favor, or leaves open. */
export const ACCEPTED_AMP_UP_DIFFERENCES: readonly AcceptedDifference[] = [
  {
    reason:
      "Amp-up leaves completionStatus at not_attempted through an attempt. The specification sets it to unknown when the first attempt begins, as the runtime does; response processing that sets it is not affected.",
    variable: "completionStatus",
    values: { reference: "not_attempted", subject: "unknown" },
  },
  {
    reason:
      "Amp-up declares the outcomes SCORE and MAXSCORE with the value 0 in every item. The specification declares no outcome but completionStatus, so the runtime reports them only when the item declares them.",
    variable: "SCORE",
    values: { reference: 0, subject: undefined },
  },
  {
    reason:
      "Amp-up declares the outcomes SCORE and MAXSCORE with the value 0 in every item. The specification declares no outcome but completionStatus, so the runtime reports them only when the item declares them.",
    variable: "MAXSCORE",
    values: { reference: 0, subject: undefined },
  },
  {
    reason:
      "Amp-up draws qti-random-integer by shuffling every integer of the range and taking the first, and qti-random by shuffling the container, where the runtime draws once by one number of the generator. Both are random choices; the specification does not say how to draw, so the values differ for the same seed.",
    items: DRAWN_DIFFERENTLY,
    kind: "template",
  },
  {
    reason:
      "The correct response comes from the draw of the runtime, which differs from the draw of Amp-up for the template variables it depends on (see the draws above), so Amp-up scores it as wrong.",
    items: ["packaging/items/template_image.xml (correct responses)"],
    variable: "SCORE",
  },
  {
    reason:
      "Amp-up reads a response processing template by the end of its name, so CC2_map_response is the standard map_response, which sets SCORE and not the FEEDBACK that CC2_map_response also sets.",
    items: ["packaging/ccPackage/testitems/QUE_102011.xml", "packaging/ccPackage/testitems/QUE_102015.xml"],
    variable: "FEEDBACK",
  },
  {
    reason:
      "Amp-up throws a TypeError when an operand of qti-substring is NULL: the statement that logs the result reads the value of the NULL operand. The runtime gives NULL.",
    items: ["packaging/BBQsTest/id-8167235c360b/QuizBowl-multi-geometry.xml", "packaging/items/multi-input.xml"],
  },
  {
    reason:
      "Amp-up throws a TypeError while evaluating the qti-member of the item, whose operands are in the order of a container and then a single value, and does not score it. The runtime scores it.",
    items: ["packaging/items/feedback_adaptive.xml"],
  },
  {
    reason:
      "The item uses the custom operator org.qtitools.mathassess.CasProcess, which nobody registered. The runtime raises a processing error where Amp-up goes on.",
    items: ["packaging/BBQsTest/id-bd44a757f562/SineRule-001.xml"],
  },
  {
    reason:
      "A response processing template sets SCORE, declared an integer, to a float. The runtime checks the type of the variable when the rule runs and Amp-up does not.",
    items: ["packaging/items/choice_ruby.xml"],
  },
  {
    reason:
      "A qti-rubric-block has no use attribute, which the schema requires. The runtime reads the item as invalid and Amp-up renders it.",
    items: ["packaging/items/data-attributes.xml"],
  },
  {
    reason:
      "The correct response of the item has the text 1, which is not an identifier of its base type. The runtime reads the item as invalid and Amp-up takes the text.",
    items: ["packaging/pci/src/fractions1.xml", "packaging/pci/src/fractions_deps.xml"],
  },
  {
    reason:
      "The attribute fallback-configuration is not one that the schema allows on qti-interaction-modules. The runtime reads the item as invalid and Amp-up ignores it.",
    items: ["packaging/pci/src/fractions_deps_2.xml"],
  },
];
