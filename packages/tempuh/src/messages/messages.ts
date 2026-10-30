/**
 * The text of the player's interface in one language. Every key is one function of the interface, so the same function
 * has the same name everywhere (WCAG 3.2.4). A message is plain text: nothing in it is markup.
 */
export interface Messages {
  /** The title of the frame of a portable custom interaction that has no prompt to take it from. */
  readonly interactiveQuestion: string;
  /** The name of the rule, a tool that measures length on the screen. */
  readonly toolRule: string;
  /** The name of the protractor, a tool that measures angles on the screen. */
  readonly toolProtractor: string;
  /** The name of the line reader, a tool that highlights the line being read. */
  readonly toolLineReader: string;
  /** The name of answer masking, a tool that hides the answer options the candidate chooses to hide. */
  readonly toolAnswerMasking: string;
  /** The name of the basic calculator, which has the four operations. */
  readonly toolBasicCalculator: string;
  /** The name of the standard calculator, which adds memory, percent, square root and sign to the basic one. */
  readonly toolStandardCalculator: string;
  /** The name of the scientific calculator, which the host provides. */
  readonly toolScientificCalculator: string;
  /** The name of the graphing calculator, which the host provides. */
  readonly toolGraphingCalculator: string;
  /** The name of the dictionary, which the host provides. */
  readonly toolDictionary: string;
  /** The name of the thesaurus, which the host provides. */
  readonly toolThesaurus: string;
  /** The name of the homophone checker, which the host provides. */
  readonly toolHomophoneChecker: string;
  /** The name of the note-taking tool, which the host provides. */
  readonly toolNoteTaking: string;
  /** The name of the visual organizer, which the host provides. */
  readonly toolVisualOrganizer: string;
  /** The name of the outliner, which the host provides. */
  readonly toolOutliner: string;
  /** The name of the tool for working with peers, which the host provides. */
  readonly toolPeerInteraction: string;
  /** The name of the spell checker, which the host provides. */
  readonly toolSpellChecker: string;
  /** The name of the region that holds the tools. */
  readonly toolsLabel: string;
  /** The action that closes a tool. */
  readonly toolClose: string;
  /** The notice of a tool that the host did not provide, or whose file cannot be shown. */
  readonly toolUnavailable: string;
  /** The heading of the physical materials that the candidate supplies. */
  readonly toolPhysicalMaterials: string;
  /** The link to a file of a digital material that the viewer cannot show. */
  readonly toolOpenFile: string;
  /** The action that moves the ruler or the protractor up. */
  readonly toolMoveUp: string;
  /** The action that moves the ruler or the protractor down. */
  readonly toolMoveDown: string;
  /** The action that moves the ruler or the protractor to the left. */
  readonly toolMoveLeft: string;
  /** The action that moves the ruler or the protractor to the right. */
  readonly toolMoveRight: string;
  /** The action that turns the ruler or the protractor against the clock. */
  readonly toolRotateLeft: string;
  /** The action that turns the ruler or the protractor with the clock. */
  readonly toolRotateRight: string;
  /** The field for the angle of the ruler or the protractor, in degrees. */
  readonly toolAngle: string;
  /** The keys that move and turn the ruler or the protractor. */
  readonly toolMoveHint: string;
  /** The action that moves the line reader to the line before. */
  readonly toolPreviousLine: string;
  /** The action that moves the line reader to the line after. */
  readonly toolNextLine: string;
  /** The word before the number of the line that the line reader is on. */
  readonly toolLine: string;
  /** The word between the number of the line and the number of lines. */
  readonly toolLineOf: string;
  /** The notice of a line reader with no text to follow. */
  readonly toolNoText: string;
  /** The notice of a mask that hides the answer choices of a question. */
  readonly answerMaskingNotice: string;
  /** The action that takes the mask off the answer choices. */
  readonly answerMaskingShow: string;
  /** The action that puts the mask back on the answer choices. */
  readonly answerMaskingHide: string;
  /** The name of the display of a calculator. */
  readonly calculatorDisplay: string;
  /** The display of a calculator after an operation with no result. */
  readonly calculatorError: string;
  /** The name of the sign that a calculator has a number in its memory. */
  readonly calculatorMemory: string;
  /** The name of the key that clears a calculator; it starts with the letter on the key. */
  readonly calculatorClear: string;
  /** The name of the key that divides. */
  readonly calculatorDivide: string;
  /** The name of the key that multiplies. */
  readonly calculatorMultiply: string;
  /** The name of the key that subtracts. */
  readonly calculatorSubtract: string;
  /** The name of the key that adds. */
  readonly calculatorAdd: string;
  /** The name of the key that completes the operation. */
  readonly calculatorEquals: string;
  /** The name of the key that enters the decimal point. */
  readonly calculatorDecimal: string;
  /** The name of the key that takes the square root. */
  readonly calculatorSquareRoot: string;
  /** The name of the key that takes a percent. */
  readonly calculatorPercent: string;
  /** The name of the key that changes the sign of the number. */
  readonly calculatorSign: string;
  /** The name of the key that clears the memory; it starts with the letters on the key. */
  readonly calculatorMemoryClear: string;
  /** The name of the key that shows the memory; it starts with the letters on the key. */
  readonly calculatorMemoryRecall: string;
  /** The name of the key that adds the number to the memory; it starts with the symbols on the key. */
  readonly calculatorMemoryAdd: string;
  /** The name of the key that subtracts the number from the memory; it starts with the symbols on the key. */
  readonly calculatorMemorySubtract: string;
  /** The word that read-aloud says before a link, when the candidate's link indication is to speak it. */
  readonly speechLink: string;
  /** The word that the typing echo says for the space character. */
  readonly typingSpace: string;
}
