import { describe, expect, it } from "vitest";
import { runGuideSamples } from "../guide-samples.ts";

/** A guide with the samples given, each in a fenced block of TypeScript. */
function guide(...samples: string[]): string {
  return `# A guide\n\n${samples.map((sample) => `\`\`\`ts\n${sample}\n\`\`\`\n`).join("\n")}`;
}

const MODULES = {
  "pkg/math": { double: (value: number) => value * 2, label: "math" },
  "pkg/tools": { default: { name: "tools" }, join: (parts: string[]) => parts.join("-") },
};

describe("the runner of the samples of a guide", () => {
  it("checks the result shown on the line of a statement and on the line after it", async () => {
    const text = guide('import { double } from "pkg/math";\n\ndouble(2); // => 4\ndouble(3);\n// => 6');
    expect(await runGuideSamples(text, MODULES)).toBe(2);
  });

  it("checks a declaration by the value it declares", async () => {
    expect(await runGuideSamples(guide("const answer = [1, 2, 3].map((n) => n * 2); // => [2, 4, 6]"), MODULES)).toBe(
      1,
    );
  });

  it("compares objects and arrays by value and refuses a result that differs", async () => {
    const same = guide('import { double } from "pkg/math";\n\n({ twice: double(2) }); // => { twice: 4 }');
    expect(await runGuideSamples(same, MODULES)).toBe(1);
    const different = guide('import { double } from "pkg/math";\n\ndouble(2); // => 5');
    await expect(runGuideSamples(different, MODULES)).rejects.toThrow();
    const extra = guide('import { double } from "pkg/math";\n\n({ twice: double(2) }); // => { twice: 4, thrice: 6 }');
    await expect(runGuideSamples(extra, MODULES)).rejects.toThrow();
  });

  it("reads a named import and a default import, each with a note after it", async () => {
    const text = guide(
      'import { join } from "pkg/tools"; // the helper\nimport tools from "pkg/tools"; // the default\n\njoin(["a", "b"]); // => "a-b"\ntools.name; // => "tools"',
    );
    expect(await runGuideSamples(text, MODULES)).toBe(2);
  });

  it("does not end a statement at a note that follows an opening line", async () => {
    const text = guide('import { join } from "pkg/tools";\n\njoin([ // two parts\n  "a",\n  "b",\n]); // => "a-b"');
    expect(await runGuideSamples(text, MODULES)).toBe(1);
  });

  it("waits for a statement that awaits", async () => {
    const text = guide("const value = await Promise.resolve(7); // => 7");
    expect(await runGuideSamples(text, MODULES)).toBe(1);
  });

  it("runs the samples of a guide in order, each alone, and counts every result", async () => {
    const text = guide(
      'import { double } from "pkg/math";\n\ndouble(1); // => 2',
      'import { label } from "pkg/math";\n\nlabel; // => "math"',
    );
    expect(await runGuideSamples(text, MODULES)).toBe(2);
  });

  it("refuses a result that no statement picked up", async () => {
    const text = guide('import { double } from "pkg/math";\n\ndouble(2)\n// => 4');
    await expect(runGuideSamples(text, MODULES)).rejects.toThrow();
  });

  it("runs the blocks of TypeScript alone", async () => {
    const text = `${guide("1 + 1; // => 2")}\n\`\`\`bash\npnpm test\n\`\`\`\n`;
    expect(await runGuideSamples(text, MODULES)).toBe(1);
  });
});
