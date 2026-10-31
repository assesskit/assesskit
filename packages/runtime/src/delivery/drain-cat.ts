import type { CatPort, CatResponse } from "../cat/index.js";
import { checkAbortSignal, checkChoice, checkFunction, checkOptions, checkRecord, optional } from "../checks.js";
import { DataError } from "../errors.js";
import type { DeliveryState } from "./delivery-state.js";
import { checkState } from "./delivery-state.js";
import type { Engine } from "./engine.js";
import type { CatRequest } from "./pending-work.js";
import { stamp } from "./stamp.js";

/** The methods of the port that the delivery of a session calls (Create Session, Submit Results and End Session). */
const SESSION_METHODS = ["createSession", "submitResults", "endSession"] as const;

/** The kinds of request that the engine makes. */
const REQUEST_KINDS = [
  "create-session",
  "submit-results",
  "end-session",
] as const satisfies readonly CatRequest["kind"][];

/** Checks that the port has a method that the delivery calls. */
function checkMethod(port: CatPort, method: (typeof SESSION_METHODS)[number]): void {
  checkFunction(port[method], `The port must have a function ${method}`);
}

/**
 * Makes one CAT request through a port and returns the answer as a `cat-response` action takes it: the engine's reply to
 * Create Session or Submit Results, or `{ ended: true }` for End Session, which the CAT specification answers with no
 * body.
 *
 * @remarks
 * It is the one place that maps a request to a method of the port, for `drainCat` and for a host that answers requests
 * itself. The requests of a CAT engine are not idempotent, so a request that fails is not repeated.
 *
 * @param port - The host's access to the CAT engine; only the method that the request needs is called.
 * @param request - A request from `Engine.pending`.
 * @returns The answer, for the `response` of a `cat-response` action.
 * @throws `DataError` when the request is not a CAT request or the port lacks the method that it needs; the error of the
 * port when it rejects.
 */
export async function sendCatRequest(port: CatPort, request: CatRequest): Promise<CatResponse> {
  checkRecord(port, "The port must be an object with the methods of CatPort");
  checkRecord(request, "The request must be a CAT request from Engine.pending");
  checkChoice(request.kind, "The kind of the request", REQUEST_KINDS);
  switch (request.kind) {
    case "create-session":
      checkMethod(port, "createSession");
      return port.createSession(request.prefix, request.sectionIdentifier, request.body);
    case "submit-results":
      checkMethod(port, "submitResults");
      return port.submitResults(request.prefix, request.sectionIdentifier, request.sessionIdentifier, {
        assessmentResult: request.assessmentResult,
        ...(request.sessionState === undefined ? {} : { sessionState: request.sessionState }),
      });
    case "end-session":
      checkMethod(port, "endSession");
      await port.endSession(request.prefix, request.sectionIdentifier, request.sessionIdentifier);
      return { ended: true };
  }
}

/** The options of {@link drainCat}. */
export interface DrainCatOptions {
  /**
   * Stops the drain before its next request. The call then rejects with the reason of the signal, and the answers applied
   * so far are lost with the state that was not returned.
   *
   * @defaultValue none
   */
  readonly signal?: AbortSignal;
}

/**
 * Makes the requests that wait for a CAT engine through a port, one after the other, and applies each answer as a
 * `cat-response` action.
 *
 * @remarks
 * It repeats until nothing waits: the answer to a last Submit Results can call for End Session. The clock is read once
 * for each answer, and the action is stamped with it, never earlier than the state.
 *
 * A request that the port rejects rejects the call with the port's error, and the answers applied so far are lost with
 * the state that was not returned. The requests of a CAT engine are not idempotent, so a host that must resume after a
 * failure makes the requests itself: it reads `Engine.pending`, calls `sendCatRequest`, applies the `cat-response` action
 * and stores the state after each answer.
 *
 * @param engine - The engine of the test.
 * @param state - The state with requests waiting.
 * @param port - The host's access to the CAT engine; only `createSession`, `submitResults` and `endSession` are called.
 * @param now - The host's clock, in epoch milliseconds.
 * @param options - See {@link DrainCatOptions}.
 * @returns The state after every answer.
 * @throws `DataError` when an argument has the wrong type, or the engine refuses an answer of the port.
 * @throws `signal.reason` when the signal aborts before a request.
 */
export async function drainCat(
  engine: Engine,
  state: DeliveryState,
  port: CatPort,
  now: () => number,
  options: DrainCatOptions = {},
): Promise<DeliveryState> {
  checkRecord(engine, "The engine must be an object from createEngine");
  checkState(state);
  checkRecord(port, "The port must be an object with the methods of CatPort");
  for (const method of SESSION_METHODS) checkMethod(port, method);
  checkFunction(now, "The clock now must be a function that returns epoch milliseconds");
  checkOptions(options);
  const { signal } = options;
  optional(signal, (value) => checkAbortSignal(value, "The option signal"));
  let current = state;
  for (let waiting = engine.pending(current).cat; waiting.length > 0; waiting = engine.pending(current).cat) {
    const [request] = waiting;
    if (request === undefined) break;
    signal?.throwIfAborted();
    const response = await sendCatRequest(port, request);
    const step = engine.apply(current, stamp(current, { type: "cat-response", request: request.id, response }, now()));
    if (!step.ok) {
      throw new DataError(
        `The answer of the CAT engine to the request ${request.id} was refused: ${step.refusal.message}`,
      );
    }
    current = step.state;
  }
  return current;
}
