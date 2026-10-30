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
  /** The action that closes a tool or a dialog. */
  readonly toolClose: string;
  /** The notice of a tool that the host did not provide, or whose file cannot be shown. */
  readonly toolUnavailable: string;
  /** The heading of the physical materials that the candidate supplies. */
  readonly toolPhysicalMaterials: string;
  /** The link to a file that the player cannot show in the page: a digital material, or an object of another type. */
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
  /** The heading of the feedback that the candidate gets after an attempt or during a test. */
  readonly feedbackTitle: string;
  /** The notice of a question with content that the candidate asked to avoid and that could not be left out; a list of the hazards follows it. */
  readonly hazardNotice: string;
  /** The name of flashing content, a hazard that the candidate can avoid. */
  readonly hazardFlashing: string;
  /** The name of sound, a hazard that the candidate can avoid. */
  readonly hazardSound: string;
  /** The name of smell, a hazard that the candidate can avoid. */
  readonly hazardOlfactory: string;
  /** The name of simulated motion, a hazard that the candidate can avoid. */
  readonly hazardMotionSimulation: string;
  /** The name of the area that holds the choices which are not placed yet. */
  readonly boardChoices: string;
  /** The name of one choice that shows no text, such as an image without an alternative; its number follows. */
  readonly choiceLabel: string;
  /** The label of the button that puts the chosen choice in a place. */
  readonly boardPlaceHere: string;
  /** The label of the button that takes a placed choice out of its place; the name of the choice follows it. */
  readonly boardRemove: string;
  /** The name of one place of an order; its number follows. */
  readonly boardPosition: string;
  /** The name of the area where the candidate puts the choices in order. */
  readonly boardOrder: string;
  /** The name of one pair of an association; its number follows. */
  readonly boardPair: string;
  /** The word that names the first choice of a pair. */
  readonly boardFirst: string;
  /** The word that names the second choice of a pair. */
  readonly boardSecond: string;
  /** The name of one gap in a text; its number follows. */
  readonly boardGap: string;
  /** What is announced after the name of a choice that the candidate picked up. */
  readonly boardSelected: string;
  /** What is announced between the name of a choice and the name of the place it was put in. */
  readonly boardPlaced: string;
  /** What is announced after the name of a choice that the candidate took out of its place. */
  readonly boardRemoved: string;
  /** What is announced when the candidate chooses a place before choosing a choice. */
  readonly boardNothingSelected: string;
  /** The hint for an answer that no change of the candidate's can fix, such as one that names a choice that does not exist. */
  readonly hintInvalid: string;
  /** The hint for a required answer that is missing. */
  readonly hintRequired: string;
  /** The hint for too few selected choices; the least number follows it. */
  readonly hintMinChoices: string;
  /** The hint for too many selected choices; the greatest number follows it. */
  readonly hintMaxChoices: string;
  /** The hint for too few placed choices; the least number follows it. */
  readonly hintMinPlaced: string;
  /** The hint for too many placed choices; the greatest number follows it. */
  readonly hintMaxPlaced: string;
  /** The hint for too few associations; the least number follows it. */
  readonly hintMinAssociations: string;
  /** The hint for too many associations; the greatest number follows it. */
  readonly hintMaxAssociations: string;
  /** The hint for a choice that is used fewer times than it needs. */
  readonly hintMatchMin: string;
  /** The hint for a choice that is used more times than it allows. */
  readonly hintMatchMax: string;
  /** The hint for choices that are matched but cannot be matched together. */
  readonly hintMatchGroup: string;
  /** The hint for too few texts entered; the least number follows it. */
  readonly hintMinStrings: string;
  /** The hint for too many texts entered; the greatest number follows it. */
  readonly hintMaxStrings: string;
  /** The hint for a text that does not have the required form. */
  readonly hintPatternMask: string;
  /** The hint for a recording played too few times; the least number follows it. */
  readonly hintMinPlays: string;
  /** The hint for a recording played too many times; the greatest number follows it. */
  readonly hintMaxPlays: string;
  /** The hint for a file of a type that is not accepted; the accepted types follow it. */
  readonly hintMimeType: string;
  /** The hint for a text that is not a number where a number is needed. */
  readonly hintNumber: string;
  /** The hint for a number with a fraction where a whole number is needed. */
  readonly hintInteger: string;
  /** The name of a field where the candidate types an answer. */
  readonly answerLabel: string;
  /** The unit after the number of characters typed, next to the expected number. */
  readonly counterCharacters: string;
  /** The words after the number of characters that remain of the expected number. */
  readonly counterLeft: string;
  /** The name of the group of buttons that format the text of an answer. */
  readonly editorToolbar: string;
  /** The name of the button that makes the selected text bold. */
  readonly editorBold: string;
  /** The name of the button that makes the selected text italic. */
  readonly editorItalic: string;
  /** The name of the button that underlines the selected text. */
  readonly editorUnderline: string;
  /** The name of the button that makes the selected lines a bulleted list. */
  readonly editorBulletList: string;
  /** The name of the button that makes the selected lines a numbered list. */
  readonly editorNumberedList: string;
  /** The text of the menu that offers choices inside a sentence, before the candidate chooses. */
  readonly inlineChoicePrompt: string;
  /** The value that a slider reads out while the candidate has not chosen one. */
  readonly sliderNotSet: string;
  /** The name of the group of buttons that control a recording. */
  readonly mediaPlayer: string;
  /** The name of the button that starts or resumes a recording. */
  readonly mediaPlay: string;
  /** The name of the button that pauses a recording. */
  readonly mediaPause: string;
  /** The name of the button that takes a recording back to its start. */
  readonly mediaRewind: string;
  /** The name of the button that turns captions on and off. */
  readonly mediaCaptions: string;
  /** The name of the button that turns audio description on and off. */
  readonly mediaAudioDescription: string;
  /** The word before the number of times a recording was played and the number it can be played. */
  readonly mediaPlays: string;
  /** The notice that a recording cannot be played again. */
  readonly mediaNoPlaysLeft: string;
  /** The notice while a recording waits before it starts. */
  readonly mediaStartsSoon: string;
  /** The notice that a recording cannot be paused again. */
  readonly mediaNoPauses: string;
  /** The notice while a paused recording waits to continue by itself. */
  readonly mediaResumes: string;
  /** The name of the control that picks a file to upload. */
  readonly uploadChoose: string;
  /** The name of the button that starts a recording to upload. */
  readonly uploadRecord: string;
  /** The name of the button that ends a recording. */
  readonly uploadStopRecording: string;
  /** The indicator that the microphone is recording. */
  readonly uploadRecording: string;
  /** The notice while a file is sent to be kept. */
  readonly uploadUploading: string;
  /** The notice that a file could not be sent to be kept. */
  readonly uploadFailed: string;
  /** The notice that the microphone could not be used for a recording. */
  readonly uploadNoMicrophone: string;
  /** The name of the button that takes the uploaded file away. */
  readonly uploadRemove: string;
  /** The notice in place of a question of a kind that the player does not run. */
  readonly customUnsupported: string;
}
