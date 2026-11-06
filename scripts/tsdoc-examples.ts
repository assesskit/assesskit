import { runGuideSamples } from "./guide-samples.ts";

/** A TSDoc comment, and the fenced `ts` block in the text of its `@example` tag. */
const TSDOC = /\/\*\*[\s\S]*?\*\//g;
const FENCE = /^```ts\n[\s\S]*?^```$/m;
const IMPORTED = /\bfrom\s*"([^"]+)"/g;

/** An example of a TSDoc comment: where it is, and the fenced block of its code. */
export interface Example {
  readonly file: string;
  readonly line: number;
  readonly block: string;
}

/** Returns the text of a comment without the stars that begin its lines. */
function withoutStars(comment: string): string {
  return comment
    .replace(/^\/\*\*[ \t]*\n?/, "")
    .replace(/\*\/$/, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\* ?/, ""))
    .join("\n");
}

/**
 * Returns the examples of the TSDoc comments of source files: the fenced `ts` block after each `@example` tag, which is empty
 * when the tag has none, so that the run fails on it. It imports no module of Node, so that a test in a browser uses it too.
 *
 * @param sources - The text of the files, by their path.
 */
export function examplesIn(sources: Readonly<Record<string, string>>): Example[] {
  return Object.entries(sources).flatMap(([file, text]) =>
    [...text.matchAll(TSDOC)].flatMap((match) => {
      const body = withoutStars(match[0]);
      const tag = body.indexOf("@example");
      if (tag < 0) return [];
      return [
        {
          file,
          line: text.slice(0, match.index).split("\n").length,
          block: FENCE.exec(body.slice(tag))?.[0] ?? "",
        },
      ];
    }),
  );
}

/**
 * Runs an example as the samples of a guide are run: every result that it shows is compared with what it gives.
 *
 * @param example - The example to run.
 * @param load - Imports a module by the address that the example names, as the test finds it.
 * @returns The number of results that the example showed and that were checked; a test expects at least one.
 */
export async function runExample(example: Example, load: (specifier: string) => Promise<object>): Promise<number> {
  const modules: Record<string, object> = {};
  for (const [, specifier = ""] of example.block.matchAll(IMPORTED)) modules[specifier] = await load(specifier);
  return runGuideSamples(example.block, modules);
}
