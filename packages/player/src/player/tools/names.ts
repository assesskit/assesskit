import type { Messages } from "../../messages/index.js";
import type { BuiltInCalculator, FileMaterial, SlotTool, ToolSpec } from "./model.js";

/** The messages that name the tools that the host provides. */
const SLOT_NAMES: Readonly<Record<SlotTool, keyof Messages>> = {
  "scientific-calculator": "toolScientificCalculator",
  "graphing-calculator": "toolGraphingCalculator",
  dictionary: "toolDictionary",
  thesaurus: "toolThesaurus",
  "homophone-checker": "toolHomophoneChecker",
  "note-taking": "toolNoteTaking",
  "visual-organizer": "toolVisualOrganizer",
  outliner: "toolOutliner",
  "peer-interaction": "toolPeerInteraction",
  "spell-checker": "toolSpellChecker",
};

/** The messages that name the built-in calculators. */
const CALCULATOR_NAMES: Readonly<Record<BuiltInCalculator, keyof Messages>> = {
  basic: "toolBasicCalculator",
  standard: "toolStandardCalculator",
  scientific: "toolScientificCalculator",
};

/**
 * Returns the name of a digital material: its label, or the name of its file.
 *
 * @param material - The material.
 * @returns The name.
 */
export function materialName({ label, fileHref }: FileMaterial): string {
  return label ?? fileHref.value.split("/").at(-1) ?? fileHref.value;
}

/**
 * Returns the name of a tool in the language of the interface.
 *
 * @param spec - The tool.
 * @param messages - The interface messages.
 * @returns The name.
 */
export function toolName(spec: ToolSpec, messages: Messages): string {
  switch (spec.kind) {
    case "rule":
      return messages.toolRule;
    case "protractor":
      return messages.toolProtractor;
    case "line-reader":
      return messages.toolLineReader;
    case "answer-masking":
      return messages.toolAnswerMasking;
    case "highlighter":
      return messages.toolHighlighter;
    case "eliminator":
      return messages.toolEliminator;
    case "calculator":
      return messages[CALCULATOR_NAMES[spec.type]];
    case "slot":
      return messages[SLOT_NAMES[spec.tool]];
    case "digital":
      return materialName(spec.material);
  }
}
