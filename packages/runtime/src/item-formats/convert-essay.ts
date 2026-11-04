import { buildSingle } from "../values/index.js";
import type { XmlElement } from "../xml/index.js";
import { classifyFeedback, elements, type ItemView, textOf } from "./item-view.js";
import { attribute, type Probe } from "./probe.js";
import type { Question, QuestionCommon } from "./question.js";

// An extended text as Moodle's essay, which a person scores: its format, its lines, its starting text and the information
// for graders that the item's rubric for scorers holds.

/** The attributes of an extended text that Moodle's essay has no place for. */
const ESSAY_ATTRIBUTES = ["max-strings", "min-strings", "expected-length", "pattern-mask"];

/** Converts an extended text into an essay, which a person scores. */
export function convertEssay(interaction: XmlElement, probe: Probe, view: ItemView, common: QuestionCommon): Question {
  const format = attribute(interaction, "format") ?? "plain";
  const lines = Number(attribute(interaction, "expected-lines") ?? "15");
  for (const name of ESSAY_ATTRIBUTES.filter((candidate) => attribute(interaction, candidate) !== undefined)) {
    view.losses.push({
      reason: "setting",
      message: `The attribute ${name} of the extended text has no place in Moodle's essay.`,
    });
  }
  const result = probe.run(buildSingle("string", "x"));
  if ((result.score ?? 0) !== 0) {
    view.losses.push({
      reason: "scoring",
      message: "The item scores the text itself; Moodle's essay is scored by a person.",
    });
  }
  const defaultValue = view.declaration === undefined ? undefined : elements(view.declaration, "qti-default-value")[0];
  const feedback = classifyFeedback(view, [{ answers: [0], result, fraction: 0 }], 1);
  return {
    ...common,
    defaultMark: view.mark ?? 1,
    generalFeedback: { text: `${feedback.general.text}${feedback.answers.get(0)?.text ?? ""}`, format: "html" },
    qtype: "essay",
    responseFormat: format === "xhtml" ? "editor" : format === "preformatted" ? "monospaced" : "plain",
    responseRequired: true,
    fieldLines: Number.isInteger(lines) && lines > 0 ? lines : 15,
    minWords: null,
    maxWords: null,
    attachments: 0,
    graderInfo: { text: view.graderInfo.join(""), format: "html" },
    template: {
      text: textOf(elements(defaultValue ?? interaction, "qti-value")[0]),
      format: format === "xhtml" ? "html" : "plain",
    },
  };
}
