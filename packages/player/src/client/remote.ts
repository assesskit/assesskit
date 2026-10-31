import { checkFunction, parseWith, recordSchema } from "@assesskit/runtime/checks";
import { actionToJson, type CandidateAction, type CandidateView, viewFromJson } from "@assesskit/runtime/delivery";
import { DataError } from "@assesskit/runtime/errors";
import type { Value } from "@assesskit/runtime/values";
import * as v from "valibot";
import { AccessError } from "../errors.js";
import {
  type ActionEnvelope,
  type Clock,
  checkViewEnvelope,
  type DispatchResult,
  type SessionCallOptions,
  type SessionClient,
  type ViewDocuments,
  type ViewEnvelope,
} from "../protocol/index.js";
import { checkCallOptions, clockSchema } from "../protocol/internal.js";
import { untilAborted } from "./abort.js";
import { assetResolver } from "./assets.js";
import { BROWSER_CLOCK } from "./clock.js";
import { notifyListeners } from "./notify.js";
import { MAX_TIMER_DELAY_MS } from "./timer-delay.js";

/** How long in milliseconds the client waits after the last change of a response before it sends the responses. */
export const AUTOSAVE_MS = 1000;

/** How long in milliseconds before the nearest timer reaches 0 the client sends the responses it holds, so that the host has them when the time-out ends the attempt. */
export const FLUSH_BEFORE_DEADLINE_MS = 10_000;

/**
 * Sends an envelope to the session host and resolves with its answer: a `fetch` of the host's endpoint, for example.
 *
 * @remarks The client passes the signal of the call that sends the envelope, so that the transport can stop waiting for the
 * answer. A transport that cannot may ignore it.
 */
export type Transport = (envelope: ActionEnvelope, options?: SessionCallOptions) => Promise<ViewEnvelope>;

/** The options of {@link createRemoteSession}. */
export interface RemoteSessionOptions {
  /**
   * The clock that times a view's age.
   *
   * @defaultValue {@link BROWSER_CLOCK}
   */
  readonly clock?: Clock;
}

const remoteOptionsSchema = v.pipe(recordSchema, v.strictObject({ clock: v.optional(clockSchema) }));

const NO_DOCUMENTS: ViewDocuments = { test: "", item: "", stimuli: [], lexicons: [] };

type SetResponses = Extract<CandidateAction, { readonly type: "set-responses" }>;

/** The responses that the client holds back, for one item. */
interface Held {
  readonly item: SetResponses["item"];
  readonly responses: Map<string, Value | null>;
  readonly pciStates: Map<string, string>;
  readonly waiters: { readonly resolve: (result: DispatchResult) => void; readonly reject: (error: unknown) => void }[];
}

/** What the client knows of the latest envelope. */
interface Latest {
  readonly view: CandidateView;
  readonly assets: (path: string) => string;
  readonly documents: ViewDocuments;
  readonly receivedAt: number;
}

/** Whether an error says that the host looked at the request and did not apply it, so that a new request may take its place. */
const isRejection = (error: unknown): boolean => error instanceof DataError || error instanceof AccessError;

/**
 * Creates the session client of exam mode: the engine is on the server, and the client keeps the latest view.
 *
 * @remarks
 * - **Envelopes.** Each request is an `ActionEnvelope` with the next sequence number and the action in the runtime's JSON form,
 *   sent one at a time. The answer is read with `viewFromJson`.
 * - **Lost answers.** A request that got no answer may or may not have been applied, so it is sent again, unchanged, before
 *   any later one; the host answers a repeated sequence number with the answer it stored. A request whose call aborted while
 *   it waited for the answer is one of these.
 * - **Signals.** A call with an aborted `signal` sends nothing. While a request is in flight the signal goes to the
 *   transport. The abort of a call that holds `set-responses` ends its wait, and the responses are still sent.
 * - **Autosave.** `set-responses` actions are held and sent together {@link AUTOSAVE_MS} after the last one, and before any
 *   other action, when the page is hidden, and {@link FLUSH_BEFORE_DEADLINE_MS} before the nearest timer reaches 0. At 0 the
 *   client sends them once more, or an empty `set-responses` if it holds none, to learn from the host whether the time-out
 *   happened.
 *
 * @param transport - Sends an envelope to the host.
 * @param initial - The envelope that `SessionHost.start` or `SessionHost.view` gave. The next request has its sequence
 * number plus one.
 * @param options - See {@link RemoteSessionOptions}.
 * @returns The session client.
 * @throws `DataError` when an argument has the wrong type.
 */
export function createRemoteSession(
  transport: Transport,
  initial: ViewEnvelope,
  options: RemoteSessionOptions = {},
): SessionClient {
  checkFunction(transport, "The transport must be a function");
  checkViewEnvelope(initial);
  parseWith(remoteOptionsSchema, options, "The options object");
  const { clock = BROWSER_CLOCK } = options;

  const listeners = new Set<(view: CandidateView) => void>();
  let sequence = initial.seq;
  let inDoubt: ActionEnvelope | undefined;
  let held: Held | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let syncTimer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const read = (envelope: ViewEnvelope): Latest => ({
    view: viewFromJson(envelope.view),
    assets: assetResolver(envelope.assets),
    documents: envelope.documents ?? NO_DOCUMENTS,
    receivedAt: clock.now(),
  });
  let latest = read(initial);

  const report = (promise: Promise<unknown>): void => {
    promise.catch((error: unknown) => reportError(error));
  };

  const clearTimers = (): void => {
    clearTimeout(flushTimer);
    clearTimeout(syncTimer);
  };

  /** Sets the timers for the nearest maximum time of the latest view. */
  const arm = (): void => {
    clearTimers();
    const remaining = latest.view.timers.flatMap((timer) =>
      timer.remaining !== undefined && timer.remaining > 0 && !timer.late ? [timer.remaining] : [],
    );
    if (closed || remaining.length === 0) return;
    const nearest = Math.min(...remaining);
    if (nearest > MAX_TIMER_DELAY_MS) return;
    flushTimer = setTimeout(() => report(flush()), Math.max(0, nearest - FLUSH_BEFORE_DEADLINE_MS));
    syncTimer = setTimeout(() => report(sync()), nearest);
  };

  const accept = (envelope: ViewEnvelope): DispatchResult => {
    latest = read(envelope);
    notifyListeners(listeners, latest.view);
    arm();
    return { view: latest.view, ...(envelope.refusal === undefined ? {} : { refusal: envelope.refusal }) };
  };

  /** Sends an envelope and reads the answer; one that got no answer stays in doubt and is sent again first next time. */
  const deliver = async (envelope: ActionEnvelope, signal: AbortSignal | undefined): Promise<ViewEnvelope> => {
    try {
      const reply = await transport(envelope, { signal });
      checkViewEnvelope(reply);
      if (reply.seq !== envelope.seq) {
        throw new DataError(`The host answered the sequence number ${reply.seq} to the request ${envelope.seq}.`);
      }
      return reply;
    } catch (error) {
      inDoubt = isRejection(error) ? undefined : envelope;
      throw error;
    }
  };

  const exchange = async (action: CandidateAction, signal: AbortSignal | undefined): Promise<DispatchResult> => {
    signal?.throwIfAborted();
    const again = inDoubt;
    if (again !== undefined) {
      inDoubt = undefined;
      try {
        accept(await deliver(again, signal));
      } catch (error) {
        // A request that the host rejected is gone; one that got no answer again blocks the next.
        if (!isRejection(error)) throw error;
      }
    }
    sequence += 1;
    return accept(await deliver({ seq: sequence, action: actionToJson(action) }, signal));
  };

  /** Sends one action after the ones before it. */
  const send = (action: CandidateAction, signal?: AbortSignal): Promise<DispatchResult> => {
    const result = queue.then(() => exchange(action, signal));
    queue = result.catch(() => undefined);
    return result;
  };

  /** Sends the responses that the client holds, and answers the callers that waited for them. */
  const flush = (): Promise<DispatchResult | undefined> => {
    clearTimeout(saveTimer);
    const batch = held;
    held = undefined;
    if (batch === undefined) return Promise.resolve(undefined);
    const sent = send({
      type: "set-responses",
      item: batch.item,
      responses: batch.responses,
      ...(batch.pciStates.size === 0 ? {} : { pciStates: batch.pciStates }),
    });
    sent.then(
      (result) => {
        for (const waiter of batch.waiters) waiter.resolve(result);
      },
      (error: unknown) => {
        for (const waiter of batch.waiters) waiter.reject(error);
      },
    );
    return sent;
  };

  /** Learns the host's view at a deadline: the held responses, or an empty `set-responses` for the item presented. */
  const sync = async (): Promise<DispatchResult | undefined> => {
    const flushed = await flush();
    if (flushed !== undefined) return flushed;
    const item = latest.view.current;
    return item === undefined ? undefined : send({ type: "set-responses", item: item.key, responses: new Map() });
  };

  const hold = (action: SetResponses, signal: AbortSignal | undefined): Promise<DispatchResult> => {
    if (held !== undefined && (held.item.ref !== action.item.ref || held.item.instance !== action.item.instance)) {
      report(flush());
    }
    held ??= { item: action.item, responses: new Map(), pciStates: new Map(), waiters: [] };
    const batch = held;
    for (const [identifier, value] of action.responses) batch.responses.set(identifier, value);
    for (const [identifier, state] of action.pciStates ?? []) batch.pciStates.set(identifier, state);
    const waiting = new Promise<DispatchResult>((resolve, reject) => batch.waiters.push({ resolve, reject }));
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => report(flush()), AUTOSAVE_MS);
    return untilAborted(waiting, signal);
  };

  const onVisibility = (): void => {
    if (document.visibilityState === "hidden") report(flush());
  };
  document.addEventListener("visibilitychange", onVisibility);
  arm();

  return {
    get view() {
      return latest.view;
    },
    get documents() {
      return latest.documents;
    },
    age: () => clock.now() - latest.receivedAt,
    assets: (path) => latest.assets(path),
    dispatch: async (action, options) => {
      checkCallOptions(options);
      const signal = options?.signal;
      if (closed) throw new DataError("The session client is closed.");
      actionToJson(action);
      if (action.type === "set-responses") return hold(action, signal);
      signal?.throwIfAborted();
      await flush();
      return send(action, signal);
    },
    subscribe: (listener) => {
      checkFunction(listener, "The listener must be a function");
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    close: () => {
      closed = true;
      clearTimers();
      clearTimeout(saveTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      listeners.clear();
    },
  };
}
