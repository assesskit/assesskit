import type { CatResponse } from "@assesskit/runtime/cat";
import type { CatRequest } from "@assesskit/runtime/delivery";
import { ServiceError } from "../errors.js";
import type { CatFailure, HostStep } from "./host-session.js";

/** What a session gives the answer loop: the requests that wait, the port, and the way to apply and save an answer. */
export interface CatAnswerer {
  /** Returns the CAT requests that wait now, in the order the engine made them. */
  waiting(): Promise<readonly CatRequest[]>;
  /** Makes a request through the port. */
  ask(request: CatRequest): Promise<CatResponse>;
  /** Applies an answer as a `cat-response` action and saves it, so that the next request starts from the saved state. */
  answer(request: CatRequest, response: CatResponse): Promise<HostStep>;
}

/** Why the loop stopped: the failure as a value for the host, and the error for a call that must reject. */
export interface CatLoopFailure {
  readonly failure: CatFailure;
  readonly error: ServiceError;
}

/**
 * Turns what went wrong into a failure: a `ServiceError` of the port passes through, anything else is wrapped. A failure to
 * read the pending work has no request, and its `request` is the empty string.
 */
function failureOf(request: CatRequest | undefined, error: unknown): CatLoopFailure {
  const message = error instanceof Error ? error.message : String(error);
  const subject =
    request === undefined
      ? "The pending CAT requests could not be read"
      : `The CAT engine did not answer the request ${request.id}`;
  return {
    failure: { request: request?.id ?? "", message },
    error: error instanceof ServiceError ? error : new ServiceError(`${subject}: ${message}`, 0, ""),
  };
}

/**
 * Answers the CAT requests that wait, one at a time, until none waits or one fails.
 *
 * @remarks
 * Each answer is saved before the next request is made. A refusal `unknown-request` means that another call answered the
 * request first, so the loop reads the pending work again. Any other refusal, an error of the port, and a failed save stop
 * the loop at that request, which stays pending for the next call; the answers saved before stay.
 *
 * @returns The failure, or `undefined` when nothing waits any more.
 */
async function answerCatRequests(answerer: CatAnswerer): Promise<CatLoopFailure | undefined> {
  let request: CatRequest | undefined;
  try {
    for (request = (await answerer.waiting())[0]; request !== undefined; request = (await answerer.waiting())[0]) {
      const step = await answerer.answer(request, await answerer.ask(request));
      if (step.refusal !== undefined && step.refusal.code !== "unknown-request") {
        throw new Error(`The answer was refused: ${step.refusal.message}`);
      }
    }
    return undefined;
  } catch (error) {
    return failureOf(request, error);
  }
}

/** The running loops, one for each key: the session on a server, a constant on a device. */
export interface CatLoops {
  /** Joins the running loop of the key, or starts one with the answerer; resolves when that loop ends. */
  join(key: string, answerer: CatAnswerer): Promise<CatLoopFailure | undefined>;
  /** Tells whether a loop runs for the key. */
  running(key: string): boolean;
}

/** Creates the registry of running loops, which forgets a loop when it ends. */
export function createCatLoops(): CatLoops {
  const loops = new Map<string, Promise<CatLoopFailure | undefined>>();
  return {
    join: (key, answerer) => {
      const running = loops.get(key);
      if (running !== undefined) return running;
      const started = answerCatRequests(answerer).finally(() => void loops.delete(key));
      loops.set(key, started);
      return started;
    },
    running: (key) => loops.has(key),
  };
}
