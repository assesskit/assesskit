import { readFileSync } from "node:fs";
import { failOnProblems, fieldReader, isRecord, isText } from "./read.ts";

const isString = (value: unknown): value is string => typeof value === "string";

/** A difference between olah and Longsight qti3-core that the specification settles in olah's favor or leaves open. */
export interface AcceptedDifference {
  /** The item, by its file name in the corpus or the name of the generated case. */
  readonly item: string;
  /** The outcome or template variable that differs; empty when only one implementation accepts the item. */
  readonly variable: string;
  /** Why olah's value is right, or why neither is wrong. */
  readonly reason: string;
  /** The specification reference that settles it. */
  readonly source: string;
}

/** Reads and checks the list of accepted differences. */
export function loadAcceptedDifferences(path: string): AcceptedDifference[] {
  const data: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(data)) throw new Error("The accepted differences must be an array.");
  const problems: string[] = [];
  const accepted: AcceptedDifference[] = [];
  data.forEach((value: unknown, index) => {
    if (!isRecord(value)) {
      problems.push(`[${index}] is not an object.`);
      return;
    }
    const read = fieldReader(`[${index}]`, value, problems);
    const item = read.required("item", isText, "a non-empty string");
    const variable = read.required("variable", isString, "a string");
    const reason = read.required("reason", isText, "a non-empty string");
    const source = read.required("source", isText, "a non-empty string");
    if (item && variable !== undefined && reason && source) accepted.push({ item, variable, reason, source });
  });
  failOnProblems("The accepted differences", problems);
  return accepted;
}
