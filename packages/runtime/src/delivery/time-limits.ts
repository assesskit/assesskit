import { checkFinite, checkNonNegative, checkRecord, describe } from "../checks.js";
import { DataError } from "../errors.js";
import { type PersonalNeedsProfile, resolveSupports, type TestingTime } from "../pnp/index.js";
import { ancestry, partOf, type StructureNode } from "./structure.js";

/**
 * The time limits of one scope, in seconds, with the extra time of a candidate's profile applied (INFO §2.8.5, §7.40;
 * BPIG §5.2.4).
 */
export interface EffectiveTimeLimits {
  /** The least time to spend; absent when there is none, or for an item or section of a nonlinear part. */
  readonly minTime?: number;
  /** The most time to spend; absent when there is none, or when the profile makes the time unlimited. */
  readonly maxTime?: number;
  /** Whether a submission after `maxTime` is still accepted. Default: `false`. */
  readonly allowLateSubmission: boolean;
}

/** The seconds in a minute, which turns `fixed-minutes` into the unit of `max-time`. */
const SECONDS_PER_MINUTE = 60;

/**
 * Returns the extra testing time that a profile gives (BPIG §5.2.4): the setting of `additional-testing-time`, unless
 * the profile prohibits that support. The sets of the profile decide nothing else: a time extension that is an option
 * or active from the start applies from the start of the session.
 *
 * @throws `DataError` when the profile is not a profile.
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
  return ancestry(node).some(
    (outer) => !(outer.kind === "section" && outer.dissolved) && outer.model.timeLimits?.maxTime !== undefined,
  );
}

/** Returns the maximum time after the extra time, `undefined` when there is none (G41). */
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

/**
 * Returns the time limits of a test, test part, section or item reference, in seconds (B35, B36, G41).
 *
 * - The limits are the ones the scope declares in `qti-time-limits`; limits are not inherited, and each scope has its
 *   own. `allow-late-submission` is `false` unless it says otherwise.
 * - The minimum time of an item reference or section applies only in a linear test part, so it is absent in a
 *   nonlinear one; the minimum of a test part or test always applies (INFO §2.8.5). Extra time never changes a minimum.
 * - Extra time changes the maximum time only. A `time-multiplier` multiplies every maximum, `fixed-minutes` adds the
 *   minutes to the outermost maximum, the one that no enclosing scope has, so that each path from the test down to an
 *   item is extended once, and `unlimited` removes every maximum.
 * - A section that ordering mixes into its parent has no extent in the plan, so it has no limits and is not an
 *   enclosing scope.
 *
 * @param node - The test, a part, a section or an item reference of a structure.
 * @param extra - The extra testing time of the candidate, from {@link additionalTestingTime}. Default: none.
 * @throws `DataError` when an argument has the wrong type, or the multiplier is not positive.
 */
export function timeLimits(node: StructureNode, extra?: TestingTime): EffectiveTimeLimits {
  checkRecord(node, "The node must be an object from resolveStructure");
  if (extra !== undefined) checkTestingTime(extra);
  if (node.kind === "section" && node.dissolved) return { allowLateSubmission: false };
  const declared = node.model.timeLimits;
  const nonlinear =
    (node.kind === "item-ref" || node.kind === "section") && partOf(node).model.navigationMode !== "linear";
  const minTime = nonlinear ? undefined : declared?.minTime;
  const maxTime = extendedMaximum(node, declared?.maxTime, extra);
  return {
    ...(minTime === undefined ? {} : { minTime }),
    ...(maxTime === undefined ? {} : { maxTime }),
    allowLateSubmission: declared?.allowLateSubmission ?? false,
  };
}
