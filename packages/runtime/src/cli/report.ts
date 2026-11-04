import type { Issue } from "../errors.js";

/** The exit codes of `assesskit validate`. */
export const EXIT_CODES = {
  /** The content has no issue with severity error. */
  valid: 0,
  /** The content has at least one issue with severity error. */
  invalid: 1,
  /** The command line is wrong, the input cannot be read or is refused, or the schemas are missing. */
  failed: 2,
} as const;

/** The report of `assesskit validate --format json`. */
export interface Report {
  /** Always `assesskit`. */
  readonly tool: "assesskit";
  /** The version of the runtime package. */
  readonly version: string;
  /** The path that was validated, as the command line gave it. */
  readonly target: string;
  /** Whether no issue has severity error. */
  readonly valid: boolean;
  /** The number of issues of each severity. */
  readonly summary: { readonly errors: number; readonly warnings: number };
  /** The issues: those of the schemas first, then those of the semantic checks. */
  readonly issues: readonly Issue[];
}

/**
 * Builds the report of a validation.
 *
 * @param target - The path that was validated.
 * @param version - The version of the runtime package.
 * @param issues - The issues found.
 * @returns The report.
 */
export function buildReport(target: string, version: string, issues: readonly Issue[]): Report {
  const errors = issues.filter(({ severity }) => severity === "error").length;
  return {
    tool: "assesskit",
    version,
    target,
    valid: errors === 0,
    summary: { errors, warnings: issues.length - errors },
    issues,
  };
}

/**
 * Returns the exit code of a report.
 *
 * @param report - The report.
 * @returns `EXIT_CODES.valid` or `EXIT_CODES.invalid`.
 */
export function exitCodeOf(report: Report): number {
  return report.valid ? EXIT_CODES.valid : EXIT_CODES.invalid;
}

function count(number: number, noun: string): string {
  return `${number} ${noun}${number === 1 ? "" : "s"}`;
}

/** Formats an issue as `path:line:column (element): severity: message [rule]`; the parts that are unknown are left out. */
function formatIssue(issue: Issue, target: string): string {
  const { location } = issue;
  const line = location?.line === undefined ? "" : `:${location.line}`;
  const column = location?.column === undefined ? "" : `:${location.column}`;
  const element = location?.element === undefined ? "" : ` (${location.element})`;
  return `${location?.path ?? target}${line}${column}${element}: ${issue.severity}: ${issue.message} [${issue.rule}]`;
}

/**
 * Formats a report as text: one line for each issue, then the verdict.
 *
 * @param report - The report.
 * @returns The text, ending with a line feed.
 */
export function formatText(report: Report): string {
  const { target, valid, summary } = report;
  const lines = report.issues.map((issue) => formatIssue(issue, target));
  const verdict = valid ? "valid" : "invalid";
  lines.push(`${target}: ${verdict} (${count(summary.errors, "error")}, ${count(summary.warnings, "warning")})`);
  return `${lines.join("\n")}\n`;
}

/**
 * Formats a report as JSON with two spaces of indentation.
 *
 * @param report - The report.
 * @returns The JSON, ending with a line feed.
 */
export function formatJson(report: Report): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
