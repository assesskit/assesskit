/**
 * The text of the player's interface in one language.
 *
 * @remarks
 * Every key is one function of the interface, so the same function has the same name everywhere (WCAG 3.2.4). A message
 * is plain text: nothing in it is markup.
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
  /** The word before the number of a point that the candidate marked on an image, as in "Point 2". */
  readonly graphicPoint: string;
  /** The notice after the candidate marked a point. */
  readonly graphicPointMarked: string;
  /** The notice after the candidate took a point, an object, an association or a choice away. */
  readonly graphicRemoved: string;
  /** The name of the image on which the keyboard moves a crosshair to mark a point. */
  readonly graphicPicker: string;
  /** The instructions for marking a point on an image with one pointer or with the keyboard. */
  readonly graphicPickerHint: string;
  /** The action that takes an object in hand to place it on an image; the name of the object follows it. */
  readonly graphicPlace: string;
  /** The name of an object that the candidate places on an image, when the object has no text alternative. */
  readonly graphicObject: string;
  /** The notice after the candidate placed an object. */
  readonly graphicPlaced: string;
  /** The instructions for placing an object on an image with one pointer, by dragging, or with the keyboard. */
  readonly graphicPlaceHint: string;
  /** The notice after the candidate chose the first of two areas to join, which says what to do next. */
  readonly graphicChooseSecond: string;
  /** The notice after the candidate joined two areas. */
  readonly graphicJoined: string;
  /** The instructions for joining areas of an image in pairs. */
  readonly graphicAssociateHint: string;
  /** The name of the group of drawing tools of a drawing question. */
  readonly drawTools: string;
  /** The name of the pen, a drawing tool that follows the pointer. */
  readonly drawToolPen: string;
  /** The name of the eraser, a drawing tool that follows the pointer and takes away what was drawn. */
  readonly drawToolEraser: string;
  /** The name of the tool that draws a straight line between two points. */
  readonly drawToolLine: string;
  /** The name of the tool that draws a rectangle between two corners. */
  readonly drawToolRectangle: string;
  /** The name of the tool that draws an ellipse in the box between two corners. */
  readonly drawToolEllipse: string;
  /** The name of the tool that fills a region of the picture with a color. */
  readonly drawToolFill: string;
  /** The name of the group of colors of a drawing question. */
  readonly drawColors: string;
  /** The name of the color black. */
  readonly drawColorBlack: string;
  /** The name of the color red. */
  readonly drawColorRed: string;
  /** The name of the color green. */
  readonly drawColorGreen: string;
  /** The name of the color blue. */
  readonly drawColorBlue: string;
  /** The name of the color yellow. */
  readonly drawColorYellow: string;
  /** The action that takes back the last thing drawn. */
  readonly drawUndo: string;
  /** The action that takes away everything drawn and brings back the picture of the question. */
  readonly drawClear: string;
  /** The notice after the candidate picked the first point of a shape, which says what to do next. */
  readonly drawStartSet: string;
  /** The notice when the drawing could not be stored or read, with the way out. */
  readonly drawSaveFailed: string;
  /** The hint when the picture to draw on cannot be loaded. */
  readonly drawLoadFailed: string;
  /** The instructions for drawing: the pen needs a pointer, and the other tools can be used with one pointer or the keyboard. */
  readonly drawHint: string;
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
  /** The word after the number of words typed, which `data-ak-count="words"` shows. */
  readonly counterWords: string;
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
  /** The status that says once that a recording starts by itself when the countdown ends. */
  readonly uploadAutomatic: string;
  /** The label of the clock that counts down to the start of a recording. */
  readonly uploadStartsIn: string;
  /** The label of the clock that counts down the time left to record. */
  readonly uploadTimeLeft: string;
  /** The name of the button that takes the uploaded file away. */
  readonly uploadRemove: string;
  /** The notice in place of a question of a kind that the player does not run. */
  readonly customUnsupported: string;
  /** The name of the map of the questions of the test. */
  readonly navigationLabel: string;
  /** The name of the region that shows the time limits. */
  readonly timersLabel: string;
  /** The name of the region that holds the actions of the test. */
  readonly actionsLabel: string;
  /** The notice of a question that is time dependent: the time the candidate takes is part of the task. */
  readonly timeDependentNotice: string;
  /** The words before the number of attempts the candidate has started on a question. */
  readonly attemptsUsed: string;
  /** The words before the number of attempts the candidate has left on a question. */
  readonly attemptsLeft: string;
  /** The state of a question the candidate has not opened. */
  readonly statusInitial: string;
  /** The state of a question the candidate is answering or can still answer. */
  readonly statusInteracting: string;
  /** The state of a question while the test is paused. */
  readonly statusSuspended: string;
  /** The state of a question whose answers are submitted. */
  readonly statusClosed: string;
  /** The state of a question the candidate reviews. */
  readonly statusReview: string;
  /** The state of a question that shows its solution. */
  readonly statusSolution: string;
  /** The action that goes to the question before. */
  readonly actionPrevious: string;
  /** The action that goes to the question after. */
  readonly actionNext: string;
  /** The action that submits the answer to a question. */
  readonly actionSubmit: string;
  /** The action that skips a question. */
  readonly actionSkip: string;
  /** The action that starts another attempt at a question. */
  readonly actionNextAttempt: string;
  /** The action that shows a question again with the answer submitted. */
  readonly actionReview: string;
  /** The action that shows the solution of a question. */
  readonly actionSolution: string;
  /** The action that ends the part of the test the candidate is in. */
  readonly actionEndPart: string;
  /** The action that ends the test. */
  readonly actionEndTest: string;
  /** The action that pauses the test. */
  readonly actionSuspend: string;
  /** The action that continues a paused test. */
  readonly actionResume: string;
  /** The name of the field in which the candidate comments on a question. */
  readonly commentLabel: string;
  /** The action that saves the comment on a question. */
  readonly actionComment: string;
  /** The name of the dialog that asks the candidate to confirm an action. */
  readonly confirmTitle: string;
  /** The question before a submission that the candidate cannot undo. */
  readonly confirmSubmit: string;
  /** The question before the end of a part. */
  readonly confirmEndPart: string;
  /** The question before the end of the test. */
  readonly confirmEndTest: string;
  /** The sentence that says a part submits all its answers when it ends. */
  readonly confirmSimultaneous: string;
  /** The words before the number of questions whose answers are not submitted. */
  readonly confirmUnsubmitted: string;
  /** The answer that goes on with the action to confirm. */
  readonly confirmYes: string;
  /** The answer that goes back without the action. */
  readonly confirmNo: string;
  /** The name of the time limit of the test. */
  readonly timerTest: string;
  /** The name of the time limit of a part of the test. */
  readonly timerPart: string;
  /** The name of the time limit of a section of the test. */
  readonly timerSection: string;
  /** The name of the time limit of a question. */
  readonly timerItem: string;
  /** The name of the time that must pass before the candidate may leave. */
  readonly timerMinimum: string;
  /** The notice of a time limit that passed and still takes answers. */
  readonly timerLate: string;
  /** The action that hides the timers. */
  readonly timerHide: string;
  /** The action that shows the timers. */
  readonly timerShow: string;
  /** The words that a screen reader says before the time left, when a time limit is near. */
  readonly timerWarning: string;
  /** The announcement that a time limit has passed. */
  readonly timerExpired: string;
  /** The notice of a test that is paused. */
  readonly testSuspended: string;
  /** The button of a paused test that asks the host whether the test continues. */
  readonly checkAgain: string;
  /** The status after a check that finds the test still paused. */
  readonly stillSuspended: string;
  /** The status after a check that could not reach the host. */
  readonly checkFailed: string;
  /** The notice of a test that has ended. */
  readonly testEnded: string;
  /** The notice of a test that waits for its next question. */
  readonly awaitingItem: string;
  /** The notice of an interactive question that did not start. */
  readonly pciFailed: string;
  /** The announcement that the answers are saved. */
  readonly answersSaved: string;
  /** The announcement that the comment is saved. */
  readonly commentSaved: string;
  /** The announcement that the answers did not reach the test and will be sent again. */
  readonly sendFailed: string;
  /** The announcement that the test did not accept an action. */
  readonly sendRejected: string;
  /** The reason for refusing another attempt at a question. */
  readonly refusalAttemptsExhausted: string;
  /** The reason for refusing to move on while the next question is chosen. */
  readonly refusalAwaitingCat: string;
  /** The reason for refusing an action that is dated before the last one. */
  readonly refusalClockRegression: string;
  /** The reason for refusing a comment. */
  readonly refusalCommentNotAllowed: string;
  /** The reason for refusing an action after the test has ended. */
  readonly refusalEnded: string;
  /** The reason for refusing an answer. */
  readonly refusalInvalidResponse: string;
  /** The reason for refusing a change to a question that is closed. */
  readonly refusalItemClosed: string;
  /** The reason for refusing to go back in a part that moves forward only. */
  readonly refusalLinearBackward: string;
  /** The reason for refusing to leave before the minimum time. */
  readonly refusalMinTimeNotReached: string;
  /** The reason for refusing an action on a question that is not on screen. */
  readonly refusalNotCurrent: string;
  /** The reason for refusing a review. */
  readonly refusalReviewNotAllowed: string;
  /** The reason for refusing a score that does not fit the question. */
  readonly refusalScoreTypeMismatch: string;
  /** The reason for refusing to skip a question. */
  readonly refusalSkippingNotAllowed: string;
  /** The reason for refusing to show a solution. */
  readonly refusalSolutionNotAllowed: string;
  /** The reason for refusing to turn a support on or off. */
  readonly refusalSupportNotAvailable: string;
  /** The reason for refusing an action while the test is paused. */
  readonly refusalSuspended: string;
  /** The reason for refusing an action on a question whose time is over. */
  readonly refusalTimeOver: string;
  /** The reason for refusing to go to a question that the test does not have. */
  readonly refusalUnknownItem: string;
  /** The reason for refusing an answer to a request that is not known. */
  readonly refusalUnknownRequest: string;
  /** The reason for refusing a number outside the range that can be stored. */
  readonly refusalValueOutOfRange: string;
  /** The reason for refusing to submit one question of a part that submits all together. */
  readonly refusalWrongSubmissionMode: string;
  /** The heading of the display of a submission that a rater scores. */
  readonly submissionTitle: string;
  /** The name of the outcome that the rater scores. */
  readonly submissionOutcome: string;
  /** The name of the field that says who scores the outcome. */
  readonly submissionScorer: string;
  /** The scorer that is a person. */
  readonly submissionHuman: string;
  /** The scorer that is an external machine. */
  readonly submissionMachine: string;
  /** The name of the cardinality and base type of the outcome. */
  readonly submissionType: string;
  /** The name of the least value of the outcome in normal use. */
  readonly submissionMinimum: string;
  /** The name of the greatest value of the outcome in normal use. */
  readonly submissionMaximum: string;
  /** The name of the value from which the aspect counts as mastered. */
  readonly submissionMastery: string;
  /** The name of the short statement of what the outcome means. */
  readonly submissionMeaning: string;
  /** The name of the address of a longer description of the outcome. */
  readonly submissionDetails: string;
  /** The name of the variable reference that the outcome's declaration names. */
  readonly submissionVariable: string;
  /** The notice of an item that is a link to a tool. */
  readonly submissionLinkedTool: string;
  /** The name of the time the score was requested. */
  readonly submissionRequested: string;
  /** The name of the score that a scorer gave before. */
  readonly submissionEarlier: string;
  /** The name of who gave the earlier score. */
  readonly submissionEarlierBy: string;
  /** The name of the time the earlier score was given. */
  readonly submissionEarlierAt: string;
  /** The heading of the rubric for the scorer. */
  readonly submissionRubric: string;
  /** The notice of an item that the candidate was not shown. */
  readonly submissionNotPresented: string;
  /** The name of the response variable of a response that the outcome rates. */
  readonly submissionResponseId: string;
  /** The name of the kind of interaction that binds a response. */
  readonly submissionInteraction: string;
  /** The name of what the candidate answered. */
  readonly submissionResponse: string;
  /** The text that stands for a response with no value. */
  readonly submissionNoResponse: string;
  /** The heading of the correct responses of an item. */
  readonly submissionCorrect: string;
  /** The heading of the template values of an item. */
  readonly submissionTemplates: string;
  /** The text that stands for a variable with no value. */
  readonly submissionNoValue: string;
  /** The name of a file that the candidate submitted, when it has no name of its own. */
  readonly submissionFile: string;
  /** The name of the form in which a rater chooses a level for each criterion of a rubric. */
  readonly ratingForm: string;
  /** The name of the score that the ratings of a rubric give. */
  readonly ratingScore: string;
  /** The word between a score and the highest score that the rubric gives, as in "7 out of 12". */
  readonly ratingOutOf: string;
  /** The name of the points of a level of a rubric. */
  readonly ratingPoints: string;
  /** The name of the weight of a criterion that counts more or less than the others. */
  readonly ratingWeight: string;
  /** What stands for a criterion or a score that has no rating yet. */
  readonly ratingNotRated: string;
  /** The message under a criterion that has no rating, which the form shows when it is checked. */
  readonly ratingChooseLevel: string;
  /** The level of a checklist criterion that is met. */
  readonly ratingMet: string;
  /** The level of a checklist criterion that is not met. */
  readonly ratingNotMet: string;
  /** The name of the region that holds the supports of the candidate. */
  readonly supportsLabel: string;
  /** The state of a support that the candidate cannot change, when it is on. */
  readonly supportOn: string;
  /** The state of a support that the candidate cannot change, when it is off. */
  readonly supportOff: string;
  /** The name of the support that keeps content with a hazard away from the candidate. */
  readonly supportHazardAvoidance: string;
  /** The name of the support for the way the candidate operates the interface. */
  readonly supportInputRequirements: string;
  /** The name of the support that chooses the language of the interface. */
  readonly supportLanguageOfInterface: string;
  /** The name of the support that explains how language works in the content. */
  readonly supportLinguisticGuidance: string;
  /** The name of the support that emphasizes the keywords of the content. */
  readonly supportKeywordEmphasis: string;
  /** The name of the support that translates the keywords of the content. */
  readonly supportKeywordTranslation: string;
  /** The name of the support that replaces portions of the content with simpler language. */
  readonly supportSimplifiedLanguage: string;
  /** The name of the support that replaces graphics with simpler ones. */
  readonly supportSimplifiedGraphics: string;
  /** The name of the support that shows the question in another language. */
  readonly supportItemTranslation: string;
  /** The name of the support that shows the content in sign language. */
  readonly supportSignLanguage: string;
  /** The name of the support that encourages the candidate. */
  readonly supportEncouragement: string;
  /** The name of the support that gives the candidate more time. */
  readonly supportAdditionalTestingTime: string;
  /** The name of the support that swaps the light and dark colors of the display. */
  readonly supportInvertDisplayPolarity: string;
  /** The name of the support that enlarges the content. */
  readonly supportMagnification: string;
  /** The name of the support that reads the content aloud. */
  readonly supportSpoken: string;
  /** The name of the support that gives the content in a form that can be felt. */
  readonly supportTactile: string;
  /** The name of the support that gives the content in braille. */
  readonly supportBraille: string;
  /** The name of the support that explains how to use the keyboard. */
  readonly supportKeyboardDirections: string;
  /** The name of the support that gives further directions. */
  readonly supportAdditionalDirections: string;
  /** The name of the support that describes images at length. */
  readonly supportLongDescription: string;
  /** The name of the support for the place where the candidate sits the test. */
  readonly supportEnvironment: string;
  /** The name of the support that gives the words of audio and video as text. */
  readonly supportTranscript: string;
  /** The name of the support that gives images a text alternative. */
  readonly supportAlternativeText: string;
  /** The name of the support that shows the content with the strongest contrast. */
  readonly supportHighContrast: string;
  /** The name of the support that shows the content in one column. */
  readonly supportLayoutSingleColumn: string;
  /** The name of the support that sets the look of the text. */
  readonly supportTextAppearance: string;
  /** The name of the support that explains terms of the content; also the name of the button that opens the explanation of a term. */
  readonly supportGlossaryOnScreen: string;
  /** The action that reads the content aloud. */
  readonly readAloud: string;
  /** The action that stops the reading. */
  readonly readAloudStop: string;
  /** The action that reads the word before the one read last. */
  readonly readAloudPreviousWord: string;
  /** The action that reads the word after the one read last. */
  readonly readAloudNextWord: string;
  /** The name of the word that was read last. */
  readonly readAloudWord: string;
  /** The notice that there is nothing to read. */
  readonly readAloudNothing: string;
  /** The notice that the voice could not read. */
  readonly readAloudFailed: string;
  /** The name of the language of the version of a question that is shown; the language follows it. */
  readonly variantLanguage: string;
  /** The notice that a version of a question that is adapted for the candidate is shown. */
  readonly variantAdapted: string;
  /** The notice that the tool of a question that is a link to a tool could not be started. */
  readonly ltiUnavailable: string;
  /** The notice that the tool of a question is closed, which a review shows in place of the tool. */
  readonly ltiClosed: string;
  /** The title of the hidden frame that keeps what the tool of a question stores for its login. */
  readonly ltiStorageFrame: string;
}
