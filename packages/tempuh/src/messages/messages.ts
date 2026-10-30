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
}
