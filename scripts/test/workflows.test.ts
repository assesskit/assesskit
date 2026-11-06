import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const DIRECTORY = join(import.meta.dirname, "../../.github/workflows");

interface Job {
  readonly "timeout-minutes"?: number | string;
  readonly if?: string;
  readonly uses?: string;
  readonly needs?: string | readonly string[];
}

interface Workflow {
  readonly on: string | readonly string[] | Readonly<Record<string, unknown>>;
  readonly jobs: Readonly<Record<string, Job>>;
}

const WORKFLOWS = readdirSync(DIRECTORY)
  .filter((file) => file.endsWith(".yml"))
  .map((file) => ({ file, workflow: parse(readFileSync(join(DIRECTORY, file), "utf8")) as Workflow }));

const workflowNamed = (file: string): Workflow =>
  WORKFLOWS.find((entry) => entry.file === file)?.workflow ?? expect.unreachable(`No workflow ${file}.`);

/**
 * The limits that a job's `timeout-minutes` can take: the number itself, or the two numbers of an expression that picks one by
 * the matrix, such as `${{ matrix.project == 'psychometrics' && 80 || 10 }}`.
 */
function limitsOf(job: Job): number[] {
  const limit = job["timeout-minutes"];
  if (typeof limit === "number") return [limit];
  if (typeof limit !== "string" || !/^\$\{\{.*\}\}$/u.test(limit)) return [];
  return [...limit.matchAll(/&&\s*(\d+)\s*\|\|\s*(\d+)/gu)].flatMap(([, picked, otherwise]) => [
    Number(picked),
    Number(otherwise),
  ]);
}

describe("the workflows", () => {
  it("stop every job that runs steps at a timeout of its own, so that a hung job does not run for six hours", () => {
    const unbounded = WORKFLOWS.flatMap(({ file, workflow }) =>
      Object.entries(workflow.jobs)
        .filter(([, job]) => {
          const limits = limitsOf(job);
          return job.uses === undefined && (limits.length === 0 || limits.some((limit) => !(limit > 0)));
        })
        .map(([name]) => `${file}: ${name}`),
    );
    expect(unbounded).toStrictEqual([]);
  });

  it("run every job of ci.yml but check and changes only when changes says that the push reaches it", () => {
    const { jobs } = workflowNamed("ci.yml");
    const gated = Object.entries(jobs).filter(([name]) => name !== "check" && name !== "changes");
    expect(gated.map(([name]) => name)).toStrictEqual(expect.arrayContaining(["test", "bench", "runtimes"]));
    for (const [name, job] of gated) {
      expect([name, [job.needs ?? []].flat()]).toStrictEqual([name, ["changes"]]);
      expect([name, job.if]).toStrictEqual([name, expect.stringContaining("needs.changes.outputs.")]);
    }
  });

  it("publishes only after the mutation rules have passed in the same run", () => {
    const { jobs } = workflowNamed("release.yml");
    const gates = Object.entries(jobs).filter(([, job]) => job.uses === "./.github/workflows/rules.yml");
    expect(gates).toHaveLength(1);
    const needs = [jobs.release?.needs ?? []].flat();
    expect(needs).toStrictEqual(gates.map(([name]) => name));
    expect(Object.keys(workflowNamed("rules.yml").on)).toContain("workflow_call");
  });
});
