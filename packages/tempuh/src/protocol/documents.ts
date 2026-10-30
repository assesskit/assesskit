import type { CandidateView } from "@luthfanwakan/olah/delivery";
import { checkArray, checkProperties, checkRecord, checkString } from "../checks.js";

/**
 * The documents that the content of a view comes from, as paths in the package. A reference in content is written
 * against its own document (B93), and the view does not say which one that is, so the host does.
 */
export interface ViewDocuments {
  /** The path of the test document, against which the rubric and the test feedback of the view resolve. `""` is the root of the package. */
  readonly test: string;
  /** The path of the document of the item presented; `""` for a variant, whose path olah does not know, and when no item is presented. */
  readonly item: string;
  /** The paths of the documents of the stimuli of the item, in the order of `CandidateItem.stimuli`. */
  readonly stimuli: readonly string[];
}

/**
 * Checks documents that arrived as JSON.
 *
 * @throws `DataError` when they are not an object with the properties `test`, `item` and `stimuli` only, the first two
 * strings and the last an array of strings.
 */
export function checkViewDocuments(value: unknown): asserts value is ViewDocuments {
  checkRecord(value, "The documents of a view envelope must be an object");
  checkProperties(value, "The documents of a view envelope", ["test", "item", "stimuli"]);
  checkString(value.test, "The property test of the documents of a view envelope");
  checkString(value.item, "The property item of the documents of a view envelope");
  checkArray(value.stimuli, "The property stimuli of the documents of a view envelope must be an array");
  for (const path of value.stimuli) checkString(path, "A path of the stimuli of the documents of a view envelope");
}

/** The documents of an item that a test names: its own, and those of the stimuli it names. */
export interface ItemDocuments {
  /** The path of the document of the item. */
  readonly path: string;
  /** The paths of the documents of its stimuli, in the order it names them. */
  readonly stimuli: readonly string[];
}

/** Where the documents of a test are, as the host that runs the engine knows: the path of the test, and for an item reference those of its documents. */
export interface DocumentSource {
  /** The path of the test document; `""` when the test has none, as a test that delivers one item alone. */
  readonly test: string;
  /** Returns the documents of the item that an item reference names; `undefined` when the test has no such reference. */
  item(reference: string): ItemDocuments | undefined;
}

/**
 * Names the documents the content of a view comes from. A variant is presented from a document whose path olah does not
 * know, so its references resolve against the root of the package (olah E19); so do those of a view that presents no item.
 *
 * @param view - The view.
 * @param source - Where the documents of the test are; `undefined` for a package that has no test for the view.
 */
export function viewDocuments(view: CandidateView, source: DocumentSource | undefined): ViewDocuments {
  const { current } = view;
  const test = source?.test ?? "";
  if (source === undefined || current === undefined || current.variant !== undefined)
    return { test, item: "", stimuli: [] };
  const item = source.item(current.key.ref);
  return item === undefined ? { test, item: "", stimuli: [] } : { test, item: item.path, stimuli: item.stimuli };
}
