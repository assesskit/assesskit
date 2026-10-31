import { readFileSync } from "node:fs";
import { expect } from "vitest";

/** The text of the fenced blocks of a language in a Markdown file, in order. */
function codeBlocks(markdown: string, language: string): string[] {
  const blocks: string[] = [];
  const fence = new RegExp(`^\`\`\`${language}\\n([\\s\\S]*?)^\`\`\`$`, "gm");
  for (const match of markdown.matchAll(fence)) blocks.push(match[1] ?? "");
  return blocks;
}

/** A statement of a sample, and the result that the sample shows for it on its line or on the next one. */
interface Statement {
  readonly code: string;
  readonly expected: string | undefined;
}

const RESULT = /^(.*;)\s*\/\/ => (.+)$/;
const RESULT_LINE = /^\s*\/\/ => (.+)$/;

/** Splits a sample into statements: lines up to one that ends with a semicolon, with the result that follows it. */
function statementsOf(sample: string): Statement[] {
  const lines = sample.split("\n");
  const statements: Statement[] = [];
  let pending: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (pending.length === 0 && (line.trim() === "" || line.trim().startsWith("//"))) continue;
    const inline = RESULT.exec(line);
    const complete = inline !== null || line.trimEnd().endsWith(";");
    pending.push(inline?.[1] ?? line);
    if (!complete) continue;
    const next = RESULT_LINE.exec(lines[index + 1] ?? "");
    statements.push({ code: pending.join("\n"), expected: inline?.[2] ?? next?.[1] });
    pending = [];
  }
  return statements;
}

const IMPORT = /^import\s*\{([^}]*)\}\s*from\s*"([^"]+)";$/;
const DECLARATION = /^(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/;

/** Turns a statement into code that runs: an import reads the module it names, and a shown result becomes a check. */
function compile({ code, expected }: Statement): string {
  const imported = IMPORT.exec(code);
  if (imported !== null) return `const {${imported[1]}} = modules[${JSON.stringify(imported[2])}];`;
  if (expected === undefined) return code;
  const declared = DECLARATION.exec(code)?.[1];
  return declared === undefined
    ? `check(${code.replace(/;$/, "")}, ${expected});`
    : `${code}\ncheck(${declared}, ${expected});`;
}

/** The function type of an asynchronous function, which the constructor of `Function` does not give. */
const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (
  ...parameters: string[]
) => (...values: unknown[]) => Promise<void>;

/**
 * Runs the TypeScript samples of a guide and checks the results that they show.
 *
 * A sample is a block of statements. A statement that is followed by `// => result`, on its line or on the next one, must
 * give that result, which is an expression compared with `toStrictEqual`; a `const` declaration is checked by the value it
 * declares. An `import` reads the module that the caller gives for its address. The samples hold no syntax of TypeScript,
 * so that they run as they are.
 *
 * @param path - The Markdown file.
 * @param modules - The modules that the samples import, by address.
 * @returns The number of results that were checked, which is the number of results that the file shows.
 */
export async function runGuideSamples(path: URL, modules: Readonly<Record<string, object>>): Promise<number> {
  let checked = 0;
  const check = (actual: unknown, expected: unknown): void => {
    checked += 1;
    expect(actual).toStrictEqual(expected);
  };
  const markdown = readFileSync(path, "utf8");
  for (const sample of codeBlocks(markdown, "ts")) {
    const code = statementsOf(sample).map(compile).join("\n");
    await new AsyncFunction("modules", "check", code)(modules, check);
  }
  // A result that no statement picked up, such as one after a line that does not end with a semicolon, would pass unseen.
  expect(checked, "every result that the guide shows is checked").toBe(markdown.match(/\/\/ => /g)?.length ?? 0);
  return checked;
}
