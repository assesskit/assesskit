import { AccessError } from "@assesskit/player";
import type { Caller } from "@assesskit/player/protocol";
import type { SessionHost, ToolScore } from "@assesskit/player/server";
import type { ItemKey } from "@assesskit/runtime/delivery";
import { DataError } from "@assesskit/runtime/errors";
import { type LtiLink, ltiLaunchUrl } from "@assesskit/runtime/package";
import { LtiError } from "@interopkit/tool-integration";
import type {
  AgsScore,
  AgsScoresOptions,
  PlatformAuthorizeOptions,
  PlatformLoginOptions,
  ToolLaunch,
} from "@interopkit/tool-integration/platform";

/**
 * Names what a launch is for in the terms of the host: the session and the item instance. The platform signs the text into the
 * login URL and hands it back with the score, so it holds no secret and no personal data: the tool and the browser can read it.
 * The same launch gives the same text.
 */
export function resourceOf(session: string, item: ItemKey): string {
  return JSON.stringify([session, item.ref, item.instance]);
}

/**
 * Reads what `resourceOf` wrote.
 *
 * @throws `DataError` when the text is not the resource of an item instance.
 */
export function parseResource(resource: string): { readonly session: string; readonly item: ItemKey } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(resource);
  } catch {
    parsed = undefined;
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 3 ||
    typeof parsed[0] !== "string" ||
    typeof parsed[1] !== "string" ||
    typeof parsed[2] !== "number"
  ) {
    throw new DataError(
      `The resource ${JSON.stringify(resource)} must be a JSON array of a session, an item reference and an instance.`,
    );
  }
  return { session: parsed[0], item: { ref: parsed[1], instance: parsed[2] } };
}

/**
 * Builds the launch of the tool of an LTI item for a candidate: the link of the item, its launch URL by the rule of the
 * implementation guide (`ltiLaunchUrl`), and the highest score of the item, which the line item offers.
 *
 * @param caller - The candidate session that the host authenticated.
 * @param item - The item instance that holds the link.
 * @param link - The link, as the runtime read it from the package.
 * @param scoreMaximum - The highest score of the item, above 0.
 * @throws `DataError` when the link names only a vendor, and so has no launch URL.
 */
export function toolLaunch(caller: Caller, item: ItemKey, link: LtiLink, scoreMaximum: number): ToolLaunch {
  return {
    principal: caller.principal,
    resource: resourceOf(caller.session, item),
    target: ltiLaunchUrl(link),
    title: link.title,
    custom: Object.fromEntries(link.custom),
    scoreMaximum,
  };
}

/**
 * The hooks that tie the platform role to the session host: a launch is the candidate's only when the session is bound to the
 * principal that the launch names.
 *
 * @remarks
 * `check` runs first in `ltiPlatformFrame` and nothing is signed when it throws: the `AccessError` of the session host passes
 * through and stays the host's to map to 403. `checkLaunch` runs in `ltiPlatformAuthorize` before the hint is used, so that a
 * refusal does not burn it, and it throws the `LtiError` `caller-mismatch`.
 */
export function launchHooks(host: Pick<SessionHost, "check">): {
  check: PlatformLoginOptions["check"];
  checkLaunch: NonNullable<PlatformAuthorizeOptions["checkLaunch"]>;
} {
  return {
    check: async (launch, options) => {
      const { session } = parseResource(launch.resource);
      await host.check({ session, principal: launch.principal }, options);
    },
    checkLaunch: async (launch, options) => {
      const { session } = parseResource(launch.resource);
      try {
        await host.check({ session, principal: launch.principal }, options);
      } catch (error) {
        if (!(error instanceof AccessError)) throw error;
        throw new LtiError(
          "The launch is for a session that is not bound to the principal of the hint.",
          "caller-mismatch",
        );
      }
    },
  };
}

/** Turns the score that the tool posted into the score that delivery needs: only a fully graded score is final. */
export function toToolScore(score: AgsScore): ToolScore {
  return {
    ...(score.scoreGiven === undefined ? {} : { scoreGiven: score.scoreGiven }),
    ...(score.scoreMaximum === undefined ? {} : { scoreMaximum: score.scoreMaximum }),
    final: score.gradingProgress === "FullyGraded",
    timestampMs: score.timestampMs,
  };
}

/** Returns the `onScore` of `agsScores`: it reads the resource of the line item and gives the score to the intake. */
export function onToolScore(intake: {
  readonly onScore: (
    session: string,
    item: ItemKey,
    score: ToolScore,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<void>;
}): AgsScoresOptions["onScore"] {
  return async (resource, score, options) => {
    const { session, item } = parseResource(resource);
    await intake.onScore(session, item, toToolScore(score), options);
  };
}
