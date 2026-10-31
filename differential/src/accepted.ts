import { readFileSync } from "node:fs";

/** A difference between the runtime and Longsight qti3-core that the specification settles in the runtime's favor or leaves open. */
export interface AcceptedDifference {
  /** The item, by its file name in the corpus or the name of the generated case. */
  readonly item: string;
  /** The outcome or template variable that differs; empty when only one implementation accepts the item. */
  readonly variable: string;
  /** Why the runtime's value is right, or why neither is wrong. */
  readonly reason: string;
  /** The specification reference that settles it. */
  readonly source: string;
}

/** Reads the list of accepted differences from a JSON file. */
export function loadAcceptedDifferences(path: string): AcceptedDifference[] {
  return JSON.parse(readFileSync(path, "utf8"));
}
