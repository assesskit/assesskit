import type { CatPort, CatResponse } from "../cat/index.js";
import { checkFunction, checkRecord } from "../checks.js";
import { DataError } from "../errors.js";
import type { DeliveryState } from "./delivery-state.js";
import { checkState } from "./delivery-state.js";
import type { Engine } from "./engine.js";
import type { CatRequest } from "./pending-work.js";
import { stamp } from "./stamp.js";

/** The methods of the port that the delivery of a session calls (CAT §3.3 to §3.5). */
const SESSION_METHODS = ["createSession", "submitResults", "endSession"] as const;

/** Makes a request through the port and returns the answer as the engine takes it (E18). */
async function ask(port: CatPort, request: CatRequest): Promise<CatResponse> {
  switch (request.kind) {
    case "create-session":
      return port.createSession(request.prefix, request.sectionIdentifier, request.body);
    case "submit-results":
      return port.submitResults(request.prefix, request.sectionIdentifier, request.sessionIdentifier, {
        assessmentResult: request.assessmentResult,
        ...(request.sessionState === undefined ? {} : { sessionState: request.sessionState }),
      });
    case "end-session":
      await port.endSession(request.prefix, request.sectionIdentifier, request.sessionIdentifier);
      return { ended: true };
  }
}

/**
 * Makes the requests that wait for a CAT engine through a port, one after the other, and applies each answer as a
 * `cat-response` action (E18). It repeats until nothing waits: the answer to a last Submit Results can call for End
 * Session. The clock is read once for each answer, and the action is stamped with it, never earlier than the state.
 *
 * A request that the port rejects rejects the call with the port's error, and the answers applied so far are lost with
 * the state that was not returned. The requests of a CAT engine are not idempotent, so a host that must resume after a
 * failure makes the requests itself: it reads `Engine.pending`, calls the port, applies the `cat-response` action and
 * stores the state after each answer.
 *
 * @param engine - The engine of the test.
 * @param state - The state with requests waiting.
 * @param port - The host's access to the CAT engine; only `createSession`, `submitResults` and `endSession` are called.
 * @param now - The host's clock, in epoch milliseconds.
 * @returns The state after every answer.
 * @throws `DataError` when an argument has the wrong type, or the engine refuses an answer of the port.
 */
export async function drainCat(
  engine: Engine,
  state: DeliveryState,
  port: CatPort,
  now: () => number,
): Promise<DeliveryState> {
  checkRecord(engine, "The engine must be an object from createEngine");
  checkState(state);
  checkRecord(port, "The port must be an object with the methods of CatPort");
  for (const method of SESSION_METHODS) checkFunction(port[method], `The port must have a function ${method}`);
  checkFunction(now, "The clock now must be a function that returns epoch milliseconds");
  let current = state;
  for (let waiting = engine.pending(current).cat; waiting.length > 0; waiting = engine.pending(current).cat) {
    const [request] = waiting;
    if (request === undefined) break;
    const response = await ask(port, request);
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
