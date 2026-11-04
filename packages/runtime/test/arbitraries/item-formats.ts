import fc from "fast-check";
import { mutationsOf } from "./xml.js";

/** The positive credits of Moodle's grade list, as GIFT writes them in percent. */
const GRADES = [
  "100",
  "90",
  "83.33333",
  "80",
  "75",
  "70",
  "66.66667",
  "60",
  "50",
  "40",
  "33.33333",
  "30",
  "25",
  "20",
  "16.66667",
  "14.28571",
  "12.5",
  "11.11111",
  "10",
  "5",
];

/** The marks that GIFT reserves, and characters that HTML escapes, between ordinary text. */
const MARKS = ["{", "}", "=", "~", "#", ":", "\\", "->", "<", ">", "&", "%", "[", "]", "*", "//", "\n", "####"];

/** Whether a character is a control character, which XML does not hold or GIFT does not keep. */
function isControl(character: string): boolean {
  const code = character.charCodeAt(0);
  return code < 0x20 || code === 0x7f;
}

/** A text of a question or an answer that holds GIFT's reserved marks: never empty or only spaces, as Moodle trims it. */
export const markedText: fc.Arbitrary<string> = fc
  .array(fc.oneof(fc.constantFrom(...MARKS), fc.string({ minLength: 1, maxLength: 6, unit: "grapheme-ascii" })), {
    minLength: 1,
    maxLength: 12,
  })
  .map((parts) => [...parts.join("")].filter((character) => character === "\n" || !isControl(character)).join(""))
  .filter((text) => text.trim() !== "" && !text.includes("\r"));

/** A credit of Moodle's list in percent, positive or negative. */
const gradePercent: fc.Arbitrary<string> = fc
  .tuple(fc.constantFrom(...GRADES), fc.boolean())
  .map(([grade, negative]) => (negative ? `-${grade}` : grade));

/** A GIFT question of several answers with credits of Moodle's list, single when one answer is `=`. */
export const weightedChoices: fc.Arbitrary<{
  readonly gift: string;
  readonly answers: number;
  readonly single: boolean;
}> = fc
  .record({
    weights: fc.array(fc.option(gradePercent, { nil: undefined }), { minLength: 2, maxLength: 6 }),
    single: fc.boolean(),
  })
  .map(({ weights, single }) => {
    const answers = weights.map((weight, index) => {
      if (single && index === 0) return `=answer ${index}`;
      return weight === undefined ? `~answer ${index}` : `~%${weight}%answer ${index}`;
    });
    return { gift: `::Weights::Choose.{${answers.join(" ")}}`, answers: weights.length, single };
  });

/** Mutations of a GIFT file: GIFT's marks and lines that end and begin questions. */
export const giftMutations = mutationsOf([
  "{",
  "}",
  "=",
  "~",
  "#",
  "->",
  "::",
  "\n\n",
  "\n0\n",
  "%-50%",
  "$CATEGORY: x\n",
  "\\",
]);
