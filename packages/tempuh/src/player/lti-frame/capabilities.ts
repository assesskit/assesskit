// biome-ignore-all lint/style/useNamingConvention: the names of LTI messages are snake_case.
import { isRecord } from "../../checks.js";
import { LTI_STORAGE_FRAME } from "../../protocol/index.js";

/** The subject of the request with which a tool asks which messages the platform supports. */
const CAPABILITIES_SUBJECT = "lti.capabilities";

/**
 * Reads a request for the capabilities of the platform: an object with the subject `lti.capabilities` and a `message_id`.
 * Returns the answer to post, or `undefined` for any other message.
 *
 * The platform supports the capabilities request itself, which the player answers, and the two messages of the storage, which
 * the frame of the storage page answers and `frame` says so.
 *
 * @see {@link https://www.imsglobal.org/spec/lti-cs-pm/v0p1 | LTI Client Side postMessages 0.1}
 */
export function answerCapabilities(data: unknown): Record<string, unknown> | undefined {
  if (!isRecord(data) || data.subject !== CAPABILITIES_SUBJECT || typeof data.message_id !== "string") return undefined;
  return {
    subject: `${CAPABILITIES_SUBJECT}.response`,
    message_id: data.message_id,
    supported_messages: [
      { subject: CAPABILITIES_SUBJECT },
      { subject: "lti.put_data", frame: LTI_STORAGE_FRAME },
      { subject: "lti.get_data", frame: LTI_STORAGE_FRAME },
    ],
  };
}
