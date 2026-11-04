import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The folder of the fixtures that the reference scripts of `validation/` write. */
const FIXTURES = join(import.meta.dirname, "fixtures");

/**
 * Reads a JSON file of `fixtures/` as the type that the test declares for the fields it reads. A test never imports a JSON
 * file: the type checker builds a type for every element of it, which measurekit's tests of 26 MB of fixtures took to a million
 * types and 2.3 GB. A type that several files use is declared here.
 *
 * @param name - The name of the file in `fixtures/`.
 */
export function readFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
}

/** One conversion of `printf.json`: the format, the number and the text that C's `printf` gives. */
interface PrintfCase {
  readonly format: string;
  readonly value: number;
  readonly expected: string;
}

/** `printf.json`, which `validation/printf.py` writes. */
export interface PrintfFixture {
  readonly floats: readonly PrintfCase[];
  readonly integers: readonly PrintfCase[];
}

/** The rounding of one number in `rounding.json`. */
interface RoundToCase {
  readonly value: number;
  readonly mode: string;
  readonly figures: number;
  readonly expected: string;
}

/** The comparison of two rounded numbers in `rounding.json`. */
interface EqualRoundedCase {
  readonly a: number;
  readonly b: number;
  readonly mode: string;
  readonly figures: number;
  readonly expected: boolean;
}

/** `rounding.json`, which `validation/rounding.py` writes. */
export interface RoundingFixture {
  readonly roundTo: readonly RoundToCase[];
  readonly equalRounded: readonly EqualRoundedCase[];
}

/** `state-1.json`: states of the first release, as the actions that reach them and the states written after some of them. */
export interface StateFixture {
  readonly package: string;
  readonly test: string;
  readonly seed: number;
  readonly at: number;
  readonly actions: readonly { readonly at: number; readonly action: unknown }[];
  readonly suspendedAfter: number;
  readonly suspended: string;
  readonly ended: string;
}
