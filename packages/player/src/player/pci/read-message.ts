import { checkNonNegativeInteger, checkRecord, checkString, describe } from "@assesskit/runtime/checks";
import { DataError } from "@assesskit/runtime/errors";
import {
  isRequestedStatus,
  type PciFailure,
  type PciFrameMessage,
  type PciRequestedStatus,
  type PciValidityResult,
} from "./protocol.js";

const FAILURES: readonly PciFailure[] = ["csp", "modules", "register", "instance", "files"];
/**
 * Turns a value into JSON: `undefined`, which `getResponse` returns for no response, becomes `null`, and what JSON cannot
 * carry, such as an object that only a structured clone can hold, is lost as `JSON.stringify` loses it.
 *
 * @param value - The value.
 * @returns The JSON.
 * @throws `DataError` when the value has a cycle, a BigInt or too many levels.
 */
export function toJson(value: unknown): unknown {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    throw new DataError("A value must be JSON, found a value with a cycle, a BigInt or too many levels.", {
      cause: error,
    });
  }
}
function readState(value: unknown): string {
  checkString(value, "The state of an interaction");
  return value;
}
function readValid(value: unknown): boolean | undefined {
  if (value !== undefined && typeof value !== "boolean") {
    throw new DataError(`The validity of an interaction must be a boolean or undefined, found ${describe(value)}.`);
  }
  return value;
}
function readStatus(value: unknown): PciRequestedStatus {
  if (!isRequestedStatus(value)) {
    throw new DataError(
      `The status that an interaction asks for must be "interacting", "closed", "solution" or "review", found ${describe(value)}.`,
    );
  }
  return value;
}
function readValidityResult(value: unknown): PciValidityResult {
  if (value === undefined || typeof value === "boolean" || typeof value === "string") return value;
  throw new DataError(`A validity method gives a boolean, a string or undefined, found ${describe(value)}.`);
}
function readFlushed(value: unknown): { readonly response: unknown; readonly state: string } | null {
  if (value === null) return null;
  checkRecord(value, "The final state of an interaction must be an object or null");
  return { response: toJson(value.response), state: readState(value.state) };
}
function readFailure(value: unknown): PciFailure {
  const reason = FAILURES.find((candidate) => candidate === value);
  if (reason === undefined) {
    throw new DataError(
      `A failure must be "csp", "modules", "register", "instance" or "files", found ${describe(value)}.`,
    );
  }
  return reason;
}
/**
 * Reads a message that a frame posted to the player.
 *
 * @remarks
 * A frame holds code of the package, so a message is untrusted: it is checked for its shape, and responses become JSON.
 * The caller checks that the message came from the frame's window.
 *
 * @param data - The data of the message.
 * @returns The message.
 * @throws `DataError` when the message is not one that the frame sends.
 */
export function readFrameMessage(data: unknown): PciFrameMessage {
  checkRecord(data, "A message from the frame must be an object");
  switch (data.type) {
    case "loaded":
      return { type: "loaded" };
    case "ready":
      return { type: "ready", state: readState(data.state) };
    case "changed":
      return {
        type: "changed",
        response: toJson(data.response),
        state: readState(data.state),
        valid: readValid(data.valid),
      };
    case "done":
      return {
        type: "done",
        response: toJson(data.response),
        state: readState(data.state),
        status: readStatus(data.status),
      };
    case "height":
      checkNonNegativeInteger(data.height, "The height of the frame");
      return { type: "height", height: data.height };
    case "validity":
      checkNonNegativeInteger(data.id, "The identifier of a validity request");
      return { type: "validity", id: data.id, value: readValidityResult(data.value) };
    case "snapshot":
      checkNonNegativeInteger(data.id, "The identifier of a snapshot request");
      return { type: "snapshot", id: data.id, flushed: readFlushed(data.flushed) };
    case "completed":
      return { type: "completed", flushed: readFlushed(data.flushed) };
    case "failed":
      return { type: "failed", reason: readFailure(data.reason) };
    default:
      throw new DataError(
        `A message from the frame has the type "loaded", "ready", "changed", "done", "height", "validity", "snapshot", "completed" or "failed", found ${describe(data.type)}.`,
      );
  }
}
