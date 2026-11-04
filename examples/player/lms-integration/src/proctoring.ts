import type { Caller } from "@assesskit/player/protocol";
import type { SessionHost } from "@assesskit/player/server";
import { readView } from "@assesskit/runtime/delivery";
import type { HttpRequest } from "@interopkit/core/http";
import { type AttemptStatus, type ControlAction, LtiError } from "@interopkit/tool-integration";
import {
  type AssessmentControl,
  type MessageInput,
  readStartAssessment,
  type ToolMessageOptions,
} from "@interopkit/tool-integration/platform";
import { type LaunchTarget, LEARNER } from "./tool-item.ts";

/** The actions of the Assessment Control Service that the host maps to the actions of its proctor, and nothing more. */
const PROCTOR_OF: Readonly<Partial<Record<ControlAction, "suspend" | "resume" | "end-test">>> = {
  pause: "suspend",
  resume: "resume",
  terminate: "end-test",
};

/** The attempt that a proctoring tool started: the candidate's session, the tool that proctors it, and how it ended. */
interface Attempt {
  readonly caller: Caller;
  readonly clientId: string;
  terminated: boolean;
}

/** What the proctoring of the host needs. */
export interface ProctoringOptions {
  /** The session host: `start` for the attempt, `proctor` for the actions of the tool, `view` for the status. */
  readonly host: Pick<SessionHost, "start" | "proctor" | "view">;
  /** The platform and its tools, as `readStartAssessment` needs them. */
  readonly tool: ToolMessageOptions;
}

/** The proctoring of a host: the store behind the Assessment Control Service, and the route that starts an attempt. */
export interface Proctoring {
  /** The store for `services.control` of `handlePlatformRequest`. */
  readonly control: AssessmentControl;
  /**
   * Starts the session of the candidate when their proctoring tool sends them back: the route at the start assessment URL.
   *
   * @param request - The request to the route.
   * @param caller - The session and the user that the host authenticated for this request.
   * @param seed - The seed of the session.
   * @throws `LtiError` with the reason of the failed check of the message, and `launch-refused` when the browser's user is not
   * the candidate of the Start Proctoring message. Answer with its `status`.
   */
  start(request: HttpRequest, caller: Caller, seed: number): Promise<void>;
}

/**
 * Builds the Start Proctoring message that sends a candidate to a proctoring tool before the attempt: the assessment is the
 * resource link, and the message offers the tool the actions of the Assessment Control Service that the host maps.
 *
 * @param caller - The candidate session that the host authenticated.
 * @param tool - The proctoring tool the host registered.
 * @param assessment - The resource link of the assessment and the attempt number.
 * @param startAssessmentUrl - The host's route that calls `Proctoring.start`.
 */
export function proctoringLaunch(
  caller: Caller,
  tool: LaunchTarget & { readonly targetLinkUri: string },
  assessment: { readonly id: string; readonly attemptNumber: number },
  startAssessmentUrl: string,
): MessageInput {
  return {
    messageType: "LtiStartProctoring",
    clientId: tool.clientId,
    deploymentId: tool.deploymentId,
    targetLinkUri: tool.targetLinkUri,
    user: { subject: caller.principal },
    roles: [LEARNER],
    resourceLink: { id: assessment.id },
    attemptNumber: assessment.attemptNumber,
    startAssessmentUrl,
    services: { control: { actions: ["pause", "resume", "terminate"] } },
  };
}

/**
 * Creates the proctoring of a host. A real host keeps its attempts in its database; the rules are the same: an attempt belongs
 * to the tool that started it, and no other tool can control it.
 *
 * @remarks
 * `pause`, `resume` and `terminate` become the `suspend`, `resume` and `end-test` of `SessionHost.proctor`. The runtime has no
 * extra time and no flags, so the message does not offer them. An action that the state of the session does not allow is
 * refused by the engine and changes nothing, and the answer is the status as it is (Proctoring Services 1.0 section 5.1.4).
 */
export function createProctoring(options: ProctoringOptions): Proctoring {
  const { host, tool } = options;
  const attempts = new Map<string, Attempt>();
  const keyOf = (subject: string, resourceLinkId: string, attemptNumber: number) =>
    JSON.stringify([subject, resourceLinkId, attemptNumber]);
  const statusOf = async (attempt: Attempt): Promise<AttemptStatus> => {
    const { status } = readView((await host.view(attempt.caller)).view);
    if (status === "in-progress") return "running";
    if (status === "suspended") return "paused";
    return attempt.terminated ? "terminated" : "complete";
  };
  return {
    control: {
      async control({ clientId }, { user, resourceLink, attemptNumber, action }, call) {
        const attempt = attempts.get(keyOf(user.subject, resourceLink.id, attemptNumber));
        // An attempt that the caller does not proctor is as unknown as one that does not exist: the platform answers 404.
        if (attempt === undefined || attempt.clientId !== clientId) return undefined;
        const type = PROCTOR_OF[action];
        if (type !== undefined) {
          const step = await host.proctor(attempt.caller.session, { type }, call);
          if (type === "end-test" && step.refusal === undefined) attempt.terminated = true;
        }
        return { status: await statusOf(attempt) };
      },
    },
    async start(request, caller, seed) {
      const message = await readStartAssessment(request, tool);
      if (message.subject !== caller.principal) {
        throw new LtiError(
          "The browser's user is not the candidate of the Start Proctoring message.",
          "launch-refused",
        );
      }
      await host.start(caller, { seed });
      attempts.set(keyOf(caller.principal, message.resourceLink.id, message.attemptNumber), {
        caller,
        clientId: message.clientId,
        terminated: false,
      });
    },
  };
}
