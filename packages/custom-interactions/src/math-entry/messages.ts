/** The words of worked steps, which an item without them gets in the language of its document. */
export interface StepWords {
  /** Names a line, before its number: "Step 2". */
  readonly step: string;
  /** The button that adds a line. */
  readonly addStep: string;
  /** Names the button that removes a line, before its number: "Remove step 2". */
  readonly removeStep: string;
}

/** The words of worked steps by language: English, the default, and Indonesian. */
const ENGLISH: StepWords = { step: "Step", addStep: "Add a step", removeStep: "Remove step" };
const CATALOGS: ReadonlyMap<string, StepWords> = new Map([
  ["en", ENGLISH],
  ["id", { step: "Langkah", addStep: "Tambah langkah", removeStep: "Hapus langkah" }],
]);

/**
 * Returns the words of worked steps: those of the item's `data-step-label`, `data-add-step-label` and
 * `data-remove-step-label`, and for the others the catalog of the item's language, else English.
 *
 * @param language - The BCP 47 tag of the item's language.
 * @param properties - The properties of the interaction.
 */
export function selectStepWords(language: string, properties: Readonly<Record<string, string>>): StepWords {
  const catalog = CATALOGS.get(language.toLowerCase().split("-")[0] ?? "") ?? ENGLISH;
  return {
    step: properties.stepLabel ?? catalog.step,
    addStep: properties.addStepLabel ?? catalog.addStep,
    removeStep: properties.removeStepLabel ?? catalog.removeStep,
  };
}
