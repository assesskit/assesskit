import { checkRecord, describe } from "../checks.js";
import { checkFinite, checkNonNegative, checkOptions } from "../checks-internal.js";
import { DataError } from "../errors.js";
import { type PersonalNeedsProfile, resolveSupports, type TestingTime } from "../pnp/index.js";
import { type ContentNode, findTestPart, listAncestors, type StructureNode, type TestStructure } from "./structure.js";

/**
 * The time limits of one scope, in seconds, with the extra time of a candidate's profile applied.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, time limits}
 * @see
 * {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, additional testing time}
 */
export interface EffectiveTimeLimits {
  /** The least time to spend; absent when there is none, or for an item or section of a nonlinear part. */
  readonly minTime?: number;
  /** The most time to spend; absent when there is none, or when the profile makes the time unlimited. */
  readonly maxTime?: number;
  /**
   * Whether a submission after `maxTime` is still accepted.
   *
   * @defaultValue `false`
   */
  readonly allowLateSubmission: boolean;
}

/** The seconds in a minute, which turns `fixed-minutes` into the unit of `max-time`. */
const SECONDS_PER_MINUTE = 60;

/**
 * Returns the extra testing time that a profile gives: the setting of `additional-testing-time`, unless the profile
 * prohibits that support.
 *
 * @remarks
 * The sets of the profile decide nothing else: a time extension that is an option or active from the start applies from
 * the start of the session.
 *
 * @param profile - The profile of the candidate.
 * @returns The extra time, or `undefined` for none.
 * @throws `DataError` when the profile is not a profile.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide}
 */
export function additionalTestingTime(profile: PersonalNeedsProfile): TestingTime | undefined {
  if (resolveSupports(profile).get("additional-testing-time") === "prohibited") return undefined;
  const setting = profile.supports.get("additional-testing-time");
  return setting?.name === "additional-testing-time" ? setting.time : undefined;
}

/** Checks the extra time that a caller gives. */
function checkTestingTime(time: TestingTime): void {
  checkRecord(time, "The extra testing time must be an object");
  switch (time.kind) {
    case "time-multiplier":
      checkFinite(time.multiplier, "The multiplier of the extra testing time");
      if (time.multiplier <= 0) {
        throw new DataError(`The multiplier of the extra testing time must be positive, found ${time.multiplier}.`);
      }
      break;
    case "fixed-minutes":
      checkNonNegative(time.minutes, "The minutes of the extra testing time");
      break;
    case "unlimited":
      break;
    default:
      throw new DataError(
        `The kind of the extra testing time must be "time-multiplier", "fixed-minutes" or "unlimited", found ${describe(Reflect.get(time, "kind"))}.`,
      );
  }
}

/** Returns whether an enclosing scope has a maximum time. A section that ordering mixes into its parent is no scope. */
function hasEnclosingMaximum(node: StructureNode): boolean {
  return listAncestors(node).some(
    (outer) => !(outer.kind === "section" && outer.dissolved) && outer.model.timeLimits?.maxTime !== undefined,
  );
}

/**
 * Returns the maximum time after the extra time, `undefined` when there is none.
 *
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
 */
function extendedMaximum(
  node: StructureNode,
  maxTime: number | undefined,
  extra: TestingTime | undefined,
): number | undefined {
  if (maxTime === undefined || extra === undefined) return maxTime;
  switch (extra.kind) {
    case "time-multiplier":
      return maxTime * extra.multiplier;
    case "fixed-minutes":
      return hasEnclosingMaximum(node) ? maxTime : maxTime + extra.minutes * SECONDS_PER_MINUTE;
    case "unlimited":
      return undefined;
  }
}

/** The options of {@link timeLimits}. */
export interface TimeLimitsOptions {
  /**
   * The extra testing time of the candidate, from {@link additionalTestingTime}.
   *
   * @defaultValue none
   */
  readonly extra?: TestingTime;
}

/**
 * Returns the time limits of a test, test part, section or item reference, in seconds.
 *
 * @remarks
 * - The limits are the ones the scope declares in `qti-time-limits`; limits are not inherited, and each scope has its
 *   own. `allow-late-submission` is `false` unless it says otherwise.
 * - The minimum time of an item reference or section applies only in a linear test part, so it is absent in a
 *   nonlinear one; the minimum of a test part or test always applies. Extra time never changes a minimum.
 * - Extra time changes the maximum time only. A `time-multiplier` multiplies every maximum, `fixed-minutes` adds the
 *   minutes to the outermost maximum, the one that no enclosing scope has, so that each path from the test down to an
 *   item is extended once, and `unlimited` removes every maximum.
 * - A section that ordering mixes into its parent has no extent in the plan, so it has no limits and is not an
 *   enclosing scope.
 *
 * @param node - The test, a part, a section or an item reference of a structure.
 * @param options - See {@link TimeLimitsOptions}.
 * @returns The limits.
 * @throws `DataError` when an argument has the wrong type, or the multiplier is not positive.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-time-limits}
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
 */
export function timeLimits(node: StructureNode, options: TimeLimitsOptions = {}): EffectiveTimeLimits {
  checkRecord(node, "The node must be an object from resolveStructure");
  checkOptions(options);
  const { extra } = options;
  if (extra !== undefined) checkTestingTime(extra);
  if (node.kind === "section" && node.dissolved) return { allowLateSubmission: false };
  const declared = node.model.timeLimits;
  const nonlinear =
    (node.kind === "item-ref" || node.kind === "section") && findTestPart(node).model.navigationMode !== "linear";
  const minTime = nonlinear ? undefined : declared?.minTime;
  const maxTime = extendedMaximum(node, declared?.maxTime, extra);
  return {
    ...(minTime === undefined ? {} : { minTime }),
    ...(maxTime === undefined ? {} : { maxTime }),
    allowLateSubmission: declared?.allowLateSubmission ?? false,
  };
}

/**
 * Returns whether the test, a test part, a section or an item reference of a structure has a maximum time that the engine
 * applies; a section that ordering mixes into its parent has none.
 */
export function hasMaximumTime(structure: TestStructure): boolean {
  const timed = (node: StructureNode): boolean => timeLimits(node).maxTime !== undefined;
  const below = (node: ContentNode): boolean => timed(node) || (node.kind === "section" && node.children.some(below));
  const { test } = structure;
  return timed(test) || test.parts.some((part) => timed(part) || part.sections.some(below));
}
