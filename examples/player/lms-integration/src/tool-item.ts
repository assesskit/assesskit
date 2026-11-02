import { AccessError } from "@assesskit/player";
import type { Caller } from "@assesskit/player/protocol";
import type { SessionHost, ToolScore } from "@assesskit/player/server";
import type { ItemKey } from "@assesskit/runtime/delivery";
import { DataError } from "@assesskit/runtime/errors";
import { type LtiLink, ltiLaunchUrl } from "@assesskit/runtime/package";
import type {
  MessageInput,
  PlatformLoginOptions,
  PlatformRequestOptions,
  ReceivedScore,
} from "@interopkit/tool-integration/platform";

/** The role of a candidate in the context of a launch (LTI 1.3 Core, Appendix A). */
export const LEARNER = "http://purl.imsglobal.org/vocab/lis/v2/membership#Learner";

/** The tool that a launch is for: its client at the platform, and the deployment the launch belongs to. */
export interface LaunchTarget {
  readonly clientId: string;
  readonly deploymentId: string;
}

/**
 * Names an item instance in the terms of LTI: the identifier of the resource link and of the line item of its launch. The
 * session is the context, so that the pair of them is all a score needs to find its place. The tool reads the text, so it
 * holds no secret and no personal data, and the same item instance gives the same text.
 */
export function itemId(item: ItemKey): string {
  return JSON.stringify([item.ref, item.instance]);
}

/** Reads what `itemId` wrote, or returns `undefined` when the text is not the identifier of an item instance. */
export function parseItemId(id: string): ItemKey | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(id);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) return undefined;
  const [ref, instance] = parsed;
  return typeof ref === "string" && typeof instance === "number" ? { ref, instance } : undefined;
}

/**
 * Builds the launch of the tool of an LTI item for a candidate: the item instance is the resource link and the session is its
 * context. The message offers the tool the line item of the item instance, to which it posts its scores.
 *
 * @param caller - The candidate session that the host authenticated.
 * @param item - The item instance that holds the link.
 * @param link - The link, as the runtime read it from the package.
 * @param tool - The tool the host registered for the link.
 * @throws `DataError` when the link names only a vendor, and so has no launch URL.
 */
export function toolLaunch(caller: Caller, item: ItemKey, link: LtiLink, tool: LaunchTarget): MessageInput {
  return {
    messageType: "LtiResourceLinkRequest",
    clientId: tool.clientId,
    deploymentId: tool.deploymentId,
    targetLinkUri: ltiLaunchUrl(link),
    user: { subject: caller.principal },
    roles: [LEARNER],
    context: { id: caller.session },
    resourceLink: { id: itemId(item), title: link.title },
    custom: Object.fromEntries(link.custom),
    services: { grades: { lineItemId: itemId(item), container: false } },
  };
}

/**
 * The `check` of `ltiPlatformFrame` for the request of one browser: the message is for the browser's user, and a message that
 * names a session, the launch of an item, names one that is bound to that user.
 *
 * @remarks
 * Nothing is signed when it throws. The `AccessError` passes through and stays the host's to map to 403. The Start Proctoring
 * message comes before the session exists, so it has only the first check.
 *
 * @param host - The session host, of which the check uses `check`.
 * @param principal - The user of the browser's session, whom the host authenticated for this request.
 */
export function checkSession(host: Pick<SessionHost, "check">, principal: string): PlatformLoginOptions["check"] {
  return async (message, options) => {
    if (message.user.subject !== principal) {
      throw new AccessError("The message is for another user than the browser's.", "not-bound");
    }
    if (message.messageType === "LtiStartProctoring") return;
    if (message.context === undefined) {
      throw new DataError("The launch of an item must name its session as the context.");
    }
    await host.check({ session: message.context.id, principal }, options);
  };
}

/**
 * The `checkLaunch` of `handlePlatformRequest` for the request of one browser: the tool's authentication request is the
 * candidate's own. The check runs before the message is taken, so that a refusal does not spend the launch.
 *
 * @param principal - The user of the browser's session, whom the host authenticated for this request.
 */
export function checkBrowser(principal: string): NonNullable<PlatformRequestOptions["checkLaunch"]> {
  return async (launch) => launch.principal === principal;
}

/** Turns the score that the tool posted into the score that delivery needs: only a fully graded score is final. */
export function toToolScore(score: ReceivedScore): ToolScore {
  return {
    ...(score.scoreGiven === undefined ? {} : { scoreGiven: score.scoreGiven }),
    ...(score.scoreMaximum === undefined ? {} : { scoreMaximum: score.scoreMaximum }),
    final: score.gradingProgress === "FullyGraded",
    timestampMs: score.timestampMs,
  };
}
