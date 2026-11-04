import type { AssessmentItem } from "../asi/index.js";
import { checkArray, checkFunction, checkRecord, describe } from "../checks.js";
import { checkOptions } from "../checks-internal.js";
import { DataError } from "../errors.js";
import {
  DURATION,
  type ItemSessionFilter,
  type ItemSessionView,
  type ItemVariables,
  QTI_CONTEXT,
  readDeclaredValue,
  type TestScope,
} from "../processing/index.js";
import type { AssessmentResult, ItemResult, TestResult } from "../results/index.js";
import { buildSingle, type Value } from "../values/index.js";
import { attemptsOf } from "./attempt.js";
import type { ScopeClock } from "./delivery-state.js";
import { fitReported, itemVariablesFromResult, type ReportedValues, reportedValues } from "./result-variables.js";
import { keeps, type TestVariableSource, testVariable } from "./session-scope.js";
import type { ItemRefNode, TestStructure } from "./structure.js";

/** The `duration` of a clock that was not entered. */
const NOT_ENTERED = buildSingle("duration", 0);

/** What the test reads of one result of an item instance. */
interface ReadSession {
  readonly node: ItemRefNode;
  readonly view: ItemSessionView;
  readonly status: ItemResult["sessionStatus"];
  /** The datestamp of the result in epoch milliseconds. */
  readonly at: number;
}

/**
 * What `runOutcomeProcessing` takes besides the test and its random source, read from a stored report.
 */
export interface TestInputs {
  /** The values that outcome processing starts from: the declared `external-scored` outcomes, as the report holds them. */
  readonly outcomes: ReadonlyMap<string, Value | null>;
  /** The item sessions and the other variables of the test. */
  readonly scope: TestScope;
}

/** The options of {@link readTestInputs}. */
export interface ReadTestInputsOptions {
  /**
   * The variables that replace those of the report for an instance, by its position in `itemResults`, such as the
   * result of `runResponseProcessing` on the variables of `readItemVariables`.
   *
   * @defaultValue none
   */
  readonly variables?: ReadonlyMap<number, ItemVariables>;
}

/**
 * What the expressions of a test read in a stored report: the item sessions of its item results, and the variables of
 * the test that are not outcomes.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
class ResultScope implements TestScope {
  private readonly structure: TestStructure;
  private readonly sessions: readonly ReadSession[];
  private readonly byRef: ReadonlyMap<string, readonly ReadSession[]>;
  private readonly source: TestVariableSource;

  constructor(structure: TestStructure, test: TestResult, sessions: readonly ReadSession[]) {
    this.structure = structure;
    this.sessions = sessions;
    const byRef = new Map<string, ReadSession[]>();
    for (const session of sessions) {
      const known = byRef.get(session.node.model.identifier);
      if (known === undefined) byRef.set(session.node.model.identifier, [session]);
      else known.push(session);
    }
    this.byRef = byRef;
    const reported = reportedValues(test.variables);
    this.source = {
      duration: (scope, identifier) => this.durationOf(reported, scope, identifier),
      context: (identifier) => this.contextOf(reported, identifier),
    };
  }

  itemSessions(filter: ItemSessionFilter): Iterable<ItemSessionView> {
    return this.sessions.filter(({ node }) => keeps(node, filter)).map(({ view }) => view);
  }

  /**
   * Returns the instance that `ITEM.VAR` or `ITEM.n.VAR` names: the nth result of the reference, in the order of the
   * report. Without `n`, the one with the latest datestamp among those with an attempt that are not
   * `pendingSubmission`, else the last.
   */
  itemSession(identifier: string, instance: number | undefined): ItemSessionView | undefined {
    const instances = this.byRef.get(identifier) ?? [];
    if (instance !== undefined) return instances[instance - 1]?.view;
    let chosen = instances.at(-1);
    let latest = Number.NEGATIVE_INFINITY;
    for (const session of instances) {
      if (attemptsOf(session.view.variables) > 0 && session.status !== "pendingSubmission" && session.at >= latest) {
        latest = session.at;
        chosen = session;
      }
    }
    return chosen?.view;
  }

  variable(identifier: string): Value | null | undefined {
    return testVariable(this.structure, this.source, identifier);
  }

  /** Returns the duration the test result holds for the test, or `PART.duration` or `SECTION.duration`; 0 if it holds none. */
  private durationOf(reported: ReportedValues, scope: ScopeClock["scope"], identifier: string): Value {
    const owner = scope === "test" ? DURATION : `${identifier}.${DURATION}`;
    const value = reported.responses.get(owner);
    const type = { cardinality: "single", baseType: "duration" } as const;
    return value === undefined || value === null
      ? NOT_ENTERED
      : (fitReported(`the test ${this.structure.test.model.identifier}`, "response", owner, type, value) ??
          NOT_ENTERED);
  }

  /** Returns the value the test result holds for `QTI_CONTEXT` or a context variable of the test, else the default. */
  private contextOf(reported: ReportedValues, identifier: string): Value | null | undefined {
    const held = reported.contexts.get(identifier);
    if (identifier === QTI_CONTEXT) return held ?? null;
    const test = this.structure.test.model;
    const declaration = test.contextDeclarations.find((each) => each.identifier === identifier);
    if (declaration === undefined) return undefined;
    if (held !== undefined) return fitReported(`the test ${test.identifier}`, "context", identifier, declaration, held);
    return readDeclaredValue(declaration.defaultValue?.values, declaration, `The default value of ${identifier}`);
  }
}

/** Returns the datestamp of a result in epoch milliseconds. */
function instantOf(result: ItemResult, position: number): number {
  const at = Date.parse(result.datestamp);
  if (Number.isNaN(at)) {
    throw new DataError(
      `The datestamp of the item result at position ${position} must be a date and time such as 2026-10-30T12:00:00Z, found ${describe(result.datestamp)}.`,
    );
  }
  return at;
}

/**
 * Reads what `runOutcomeProcessing` takes out of a stored report: the outcomes that processing does not set, and the
 * scope of the item sessions.
 *
 * @remarks
 * The outcomes are those of the test with `external-scored` that the report holds, because a scorer sets them and the
 * reset before each run would erase them; every other outcome starts from its default, as the specification says. An
 * outcome that a CAT engine reported and no declaration takes stays in the report.
 *
 * Each item result is one planned instance, and the scope lists them in the order of the report. The sessions are the
 * report's, but for the positions of the option `variables`. The scope mirrors the engine's: `ITEM.VAR` reads the result
 * with the latest datestamp among those of the reference that have an attempt and are not `pendingSubmission`, else
 * the last; `ITEM.n.VAR` reads the nth; `duration`, `PART.duration` and `SECTION.duration` are the test result's, 0 for
 * one not entered. A report that lists presented instances only, or holds several results for one instance, makes
 * `ITEM.n`, `qti-number-*` and every aggregate read wrong, and one in another order than the plan's makes `ITEM.n.VAR`
 * and a tie of `ITEM.VAR` read another instance; no error says so. Read reports of ended sessions that list every planned
 * instance in plan order, as `Engine.results` writes them.
 *
 * @param structure - The structure of the test, as `resolveStructure` returns it.
 * @param result - The stored report, with a test result.
 * @param items - The items by identifier of the item reference, the fixed items among them.
 * @param options - See {@link ReadTestInputsOptions}.
 * @returns The outcomes and the scope to give `runOutcomeProcessing`.
 * @throws `DataError` when an argument has the wrong type, the report has no test result, a result is for an item
 * reference that the test or `items` lacks, a position of `variables` is not one of `itemResults`, a value of the report
 * does not fit its declaration, or a datestamp is not a date and time.
 * @see {@link https://www.imsglobal.org/sites/default/files/spec/qti/v3/rr-bind/index.html | QTI 3.0 Results Reporting}
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export function readTestInputs(
  structure: TestStructure,
  result: AssessmentResult,
  items: ReadonlyMap<string, AssessmentItem>,
  options: ReadTestInputsOptions = {},
): TestInputs {
  checkRecord(structure, "The structure must be an object");
  for (const method of ["part", "section", "itemRef"] as const) {
    checkFunction(structure[method], `The structure must have a function ${method} of an identifier`);
  }
  checkRecord(result, "The report must be an object");
  checkArray(result.itemResults, "The item results of the report must be an array");
  if (!(items instanceof Map)) {
    throw new DataError(`The items must be a Map from item reference identifier to item, found ${describe(items)}.`);
  }
  checkOptions(options);
  const { variables = new Map<number, ItemVariables>() } = options;
  if (!(variables instanceof Map)) {
    throw new DataError(`The option variables must be a Map from position to variables, found ${describe(variables)}.`);
  }
  const { testResult } = result;
  if (testResult === undefined) {
    throw new DataError(
      "The report has no test result. An item delivered alone has no outcome processing; read its variables with readItemVariables.",
    );
  }
  checkRecord(testResult, "The test result of the report must be an object");
  checkArray(testResult.variables, "The variables of the test result must be an array");
  for (const position of variables.keys()) {
    if (!Number.isInteger(position) || position < 0 || position >= result.itemResults.length) {
      throw new DataError(
        `The option variables names the position ${describe(position)}, which is not one of the ${result.itemResults.length} item results.`,
      );
    }
  }
  const sessions = result.itemResults.map((itemResult, position): ReadSession => {
    checkRecord(itemResult, `The item result at position ${position} must be an object`);
    const node = structure.itemRef(itemResult.identifier);
    if (node === undefined) {
      throw new DataError(
        `The item result at position ${position} is for ${describe(itemResult.identifier)}, which the test has no item reference for.`,
      );
    }
    const item = items.get(itemResult.identifier);
    if (item === undefined) {
      throw new DataError(
        `The item result at position ${position} is for ${describe(itemResult.identifier)}, which the items do not hold.`,
      );
    }
    return {
      node,
      view: { ref: node.model, item, variables: variables.get(position) ?? itemVariablesFromResult(item, itemResult) },
      status: itemResult.sessionStatus,
      at: instantOf(itemResult, position),
    };
  });
  const reported = reportedValues(testResult.variables);
  const outcomes = new Map<string, Value | null>();
  for (const declaration of structure.test.model.outcomeDeclarations) {
    const value = reported.outcomes.get(declaration.identifier);
    if (declaration.externalScored !== undefined && value !== undefined) {
      outcomes.set(
        declaration.identifier,
        fitReported(
          `the test ${structure.test.model.identifier}`,
          "outcome",
          declaration.identifier,
          declaration,
          value,
        ),
      );
    }
  }
  return { outcomes, scope: new ResultScope(structure, testResult, sessions) };
}
