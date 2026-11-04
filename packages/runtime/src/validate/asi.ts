import type { AsiDocument } from "../asi/index.js";
import { walkDocument } from "../asi/internal.js";
import type { Issue } from "../errors.js";
import { checkElements } from "./generic-checks.js";
import { checkItem } from "./item.js";
import { type CheckedOptions, checkValidateOptions, type ValidateOptions } from "./options.js";
import { Reports } from "./reports.js";
import { checkTest } from "./test.js";

/**
 * Validates an assessment document beyond its schema: the rule sets of the XML binding, the information-model constraints that a
 * schema cannot state, and the static types of its processing, so that what would fail when it runs is reported before it
 * does. The checks are listed in the guide `docs/runtime/validate.md`. An item is checked with its declarations; a stimulus, section
 * or processing document by what its elements say alone; a test by its own document, without resolving the items it
 * names (see `validateTest`). An `xi:include` left in the document is an error: resolve includes first.
 *
 * @param document - The document, as `readAsi` reads it.
 * @param options - See {@link ValidateOptions}.
 * @returns The issues in the order the checks found them; none when the document is valid.
 * @throws `DataError` when an argument has the wrong type, or the document is not an object of one of the kinds of
 * `AsiDocument` with models of the shape the schema gives them.
 */
export function validateAsi(document: AsiDocument, options: ValidateOptions = {}): readonly Issue[] {
  const checked = checkValidateOptions(options);
  // The checks read the model by its properties, so the shape of the whole model is checked first.
  walkDocument(document, () => undefined);
  const reports = new Reports(checked.maxFindings);
  checkDocument(document, reports, checked);
  return reports.issues;
}

/**
 * Runs the checks of a document of any kind, in the findings of its path.
 *
 * @param document - The document of any kind.
 * @param reports - The findings by path.
 * @param options - The checked options.
 */
export function checkDocument(document: AsiDocument, reports: Reports, options: CheckedOptions): void {
  const findings = reports.of(options.path);
  if (document.kind === "item") checkItem(document.item, findings, options);
  else if (document.kind === "test") checkTest(document.test, reports, options, undefined);
  else checkElements(document, findings);
}
