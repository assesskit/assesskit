import type { AssessmentItem } from "@assesskit/runtime/asi";
import type { CatSessionPort } from "@assesskit/runtime/cat";
import {
  checkAbortSignal,
  checkFunction,
  checkPositiveInteger,
  functionSchema,
  methodsSchema,
  nonEmptyStringSchema,
  optional,
  parseWith,
  recordSchema,
  untilAborted,
} from "@assesskit/runtime/checks";
import type {
  CandidateAction,
  CandidateView,
  DeliveryDefinition,
  DeliveryEvent,
  DeliveryState,
  EngineOptions,
  HostAction,
  StartOptions,
  Step,
  TestStructure,
} from "@assesskit/runtime/delivery";
import { DataError } from "@assesskit/runtime/errors";
import { resolveReference } from "@assesskit/runtime/package";
import * as v from "valibot";
import {
  type Clock,
  type DocumentSource,
  type HostSession,
  type HostStep,
  type SessionCallOptions,
  type SessionClient,
  type ViewDocuments,
  viewDocuments,
} from "../protocol/index.js";
import {
  type CatAnswerer,
  type CatLoopFailure,
  checkCallOptions,
  checkHostAction,
  checkHostApplyOptions,
  clockSchema,
  createCatLoops,
  readClock,
  stepAfterIdle,
} from "../protocol/internal.js";
import { BROWSER_CLOCK } from "./clock.js";
import { notifyListeners } from "./notify.js";
import { MAX_TIMER_DELAY_MS } from "./timer-delay.js";

/** What a {@link LocalStore} saves for a step: the state, and the events of the step. */
export interface LocalSave {
  /** The state as the runtime's `serializeState` writes it. */
  readonly state: string;
  /** The events of the step that made the state: those of `Engine.apply`, none for the step that starts the session. */
  readonly events: readonly DeliveryEvent[];
}

/** The storage of a session on the device, such as IndexedDB: the state as the runtime's `serializeState` writes it. */
export interface LocalStore {
  /**
   * Returns the saved state of a session.
   *
   * @param session - The identifier of the session.
   * @param options - See {@link SessionCallOptions}. A store may ignore them.
   * @returns The state, or `undefined` when there is none.
   */
  load(session: string, options?: SessionCallOptions): Promise<string | undefined>;
  /**
   * Saves the state of a session in place of the one before, with the events of the step that made it, in one write. It
   * rejects only when the state was not saved, so that the session applies a step only when this resolved, and then no
   * event is stored without its state.
   *
   * @param session - The identifier of the session.
   * @param record - The state as `serializeState` writes it, and the events of the step.
   * @param options - See {@link SessionCallOptions}. A store may ignore them.
   */
  save(session: string, record: LocalSave, options?: SessionCallOptions): Promise<void>;
}

/**
 * The options of {@link createLocalSession}.
 *
 * @remarks The `signal` stops the creation before its load and its first save. It does not reach later calls: each of them
 * takes its own.
 */
export interface LocalSessionOptions extends SessionCallOptions {
  /** What to deliver: a test, or an item alone for a preview. */
  readonly definition: DeliveryDefinition;
  /**
   * The options of `createEngine`.
   *
   * @defaultValue the defaults of the engine
   */
  readonly engine?: EngineOptions;
  /**
   * What `Engine.start` takes besides the seed and the time: the PNP, the universal supports and the context.
   *
   * @defaultValue none
   */
  readonly start?: Omit<StartOptions, "seed" | "at">;
  /** Where the state is saved and restored from. */
  readonly store: LocalStore;
  /** The identifier of the session in the store. */
  readonly session: string;
  /** The seed of a session that the store does not have yet, a safe integer. */
  readonly seed: number;
  /** Turns the path of a file in the package into the URL to load it from, such as a URL of the host's own files. */
  readonly assets: (path: string) => string;
  /**
   * Returns the paths of the pronunciation lexicons (PLS) that the item whose document is at the given path depends on,
   * which reading aloud uses. The host reads them from the manifest of the package the definition was made from.
   *
   * @defaultValue none, so that no item has a lexicon
   */
  readonly lexicons?: (item: string) => readonly string[];
  /**
   * The clock that stamps actions and times the deadlines.
   *
   * @defaultValue {@link BROWSER_CLOCK}
   */
  readonly clock?: Clock;
  /**
   * Receives the errors that the client can only report: a listener that threw, and a failure of the timer's step or of the
   * answer loop that no call waits for.
   *
   * @defaultValue `reportError` of the page
   */
  readonly onError?: (error: unknown) => void;
  /**
   * The longest gap between steps, in milliseconds, that counts as time on task: a gap above it counts as suspended, from
   * the latest step to the next action, so that a learner who comes back after days has used no time in between.
   *
   * @remarks
   * Pick a value above the longest pause that a learner takes while working. A running maximum time stops with the gap,
   * and the `time` action of the timer that finds a gap is dropped: nothing is saved or armed again, and the next action
   * closes the gap. Until then the view counts it.
   *
   * @defaultValue none, so that every gap counts
   */
  readonly maxIdle?: number;
  /**
   * The port of the CAT engines of the adaptive sections. Each call then answers the CAT requests that wait, one at a time,
   * saving each answer before the next request.
   *
   * @defaultValue none, so that the host answers with `cat-response` actions itself
   */
  readonly cat?: CatSessionPort;
}

// The engine reads the definition, the engine options, the start options and the seed with their own checks.
const optionsSchema = v.strictObject({
  definition: recordSchema,
  engine: v.optional(v.unknown()),
  start: v.optional(v.unknown()),
  store: methodsSchema<LocalStore>("load", "save"),
  session: nonEmptyStringSchema,
  seed: v.unknown(),
  assets: functionSchema<(path: string) => string>(),
  lexicons: v.optional(functionSchema<(item: string) => readonly string[]>()),
  clock: v.optional(clockSchema),
  onError: v.optional(functionSchema<(error: unknown) => void>()),
  maxIdle: v.optional(v.unknown()),
  signal: v.optional(v.unknown()),
  cat: v.optional(methodsSchema<CatSessionPort>("createSession", "submitResults", "endSession")),
});

/** Returns the paths of the stimuli an item names, resolved against its document. */
const stimulusPaths = (item: AssessmentItem, path: string): readonly string[] =>
  item.stimulusRefs.map((ref) => resolveReference(path, ref.href) ?? "");

/** Returns where the documents of the definition are, for the paths that the references of the content resolve against. */
function sourceOf(
  definition: DeliveryDefinition,
  structure: TestStructure | undefined,
  lexicons: (item: string) => readonly string[],
): DocumentSource {
  if (definition.kind === "item") {
    const { item, base } = definition;
    return { test: "", item: () => ({ path: base, stimuli: stimulusPaths(item, base), lexicons: lexicons(base) }) };
  }
  return {
    test: definition.base,
    item: (reference) => {
      const node = structure?.itemRef(reference);
      const path = node === undefined ? undefined : resolveReference(node.base, node.model.href);
      if (node === undefined || path === undefined) return undefined;
      const { deliverable } = definition.resolvers.items(node.model.href, node.base);
      return {
        path,
        stimuli: deliverable.kind === "qti" ? stimulusPaths(deliverable.item, path) : [],
        lexicons: lexicons(path),
      };
    },
  };
}

/** The host side of a local session, with the events of each step. */
export interface LocalHostSession extends HostSession {
  /**
   * Calls the listener with the events of every step that the session saves after this call, the candidate's and the
   * host's, in order, after the view listeners have run. A step with no events calls no listener, as `forward.log` is not
   * called for one, and a refused action makes no step.
   *
   * @param listener - The function to call.
   * @returns The function that removes the listener.
   * @throws `DataError` when the listener is not a function, or the client is closed.
   */
  subscribeSteps(listener: (events: readonly DeliveryEvent[]) => void): () => void;
}

/** A session client of practice that also offers the host side of its session. */
export interface LocalSession extends SessionClient {
  /** The host side of the session on the device. Its results are never official. */
  readonly host: LocalHostSession;
}

/** What the host side answers to a step. */
const hostStep = (step: Step): HostStep => (step.ok ? { events: step.events } : { events: [], refusal: step.refusal });

/** An accepted or refused action, with the view after it. */
interface Applied {
  readonly step: Step;
  readonly view: CandidateView;
}

/**
 * Creates the session client of practice: the engine runs on the device, with the same client interface as exam mode, and
 * `host` offers the host side of the session.
 *
 * @remarks
 * It loads the runtime's engine with `import()`, so an exam's bundle holds no engine. The answer keys are on the device, which practice accepts, and its results are never official.
 *
 * It stamps each action with the clock and saves the state after each step that is accepted, before it applies the step:
 * an action whose save fails is rejected and changes nothing. It fires a `time` action at each maximum time with
 * `setTimeout`. A session that the store has resumes from its state; a preview of one item is a session of the definition
 * of an item.
 *
 * Actions and reads of the client and of `host` run one after the other, in the order of the calls. A scoring request
 * that the session makes has no event on a resumed session, and the events of the first step come before any listener can
 * subscribe, so a host checks `host.pending()` once after this function resolves. The store key belongs to one live
 * session: two sessions on one key overwrite each other.
 *
 * @param options - See {@link LocalSessionOptions}.
 * @returns The session client.
 * @throws `DataError` when an option has the wrong type, the engine cannot be created, or the session cannot start.
 * @throws `signal.reason` when the signal aborts before the load or the first save. A session already saved stays, and a
 * new call resumes it.
 */
export async function createLocalSession(options: LocalSessionOptions): Promise<LocalSession> {
  parseWith(optionsSchema, options, "The options object");
  const { signal: creating, cat, maxIdle } = options;
  optional(creating, (value) => checkAbortSignal(value, "The option signal"));
  optional(maxIdle, (value) => checkPositiveInteger(value, "The option maxIdle"));
  const { definition, store, session, seed, assets, lexicons = () => [], clock = BROWSER_CLOCK } = options;
  const onError = options.onError ?? ((error: unknown) => reportError(error));
  const now = (): number => readClock(clock);

  const delivery = await import("@assesskit/runtime/delivery");
  const engine = delivery.createEngine(definition, options.engine);
  const structure =
    definition.kind === "test"
      ? delivery.resolveStructure(definition.test, definition.base, definition.resolvers)
      : undefined;
  const source = sourceOf(definition, structure, lexicons);

  creating?.throwIfAborted();
  const saved = await store.load(session, { signal: creating });
  let state: DeliveryState;
  if (saved === undefined) {
    const step = engine.start({ ...options.start, seed, at: now() });
    if (!step.ok) throw new DataError(`The session cannot start: ${step.refusal.message}`);
    creating?.throwIfAborted();
    await store.save(
      session,
      { state: delivery.serializeState(step.state), events: step.events },
      { signal: creating },
    );
    state = step.state;
  } else {
    state = delivery.deserializeState(saved);
  }

  const listeners = new Set<(view: CandidateView) => void>();
  const stepListeners = new Set<(events: readonly DeliveryEvent[]) => void>();
  let queue: Promise<unknown> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let latest: { view: CandidateView; documents: ViewDocuments; receivedAt: number };

  const look = (): void => {
    const at = now();
    const view = engine.view(state, at);
    latest = { view, documents: viewDocuments(view, source), receivedAt: at };
  };
  look();

  /** Sets the timer for the nearest maximum time, which fires a `time` action. */
  const arm = (): void => {
    clearTimeout(timer);
    const times = engine.deadlines(state).flatMap((each) => (each.kind === "max-time" ? [each.at] : []));
    if (closed || times.length === 0) return;
    const delay = Math.max(0, Math.min(...times) - now());
    timer = setTimeout(
      () => {
        if (Math.min(...times) > now()) arm();
        else
          void run({ type: "time" }, undefined)
            .then(settleTimer)
            .catch((error: unknown) => onError(error));
      },
      Math.min(delay, MAX_TIMER_DELAY_MS),
    );
  };

  /** Runs one task after the ones before it. A call whose signal aborted by its turn is dropped. */
  const enqueue = <T>(task: () => T | Promise<T>, signal: AbortSignal | undefined): Promise<T> => {
    const result = queue.then(async () => {
      signal?.throwIfAborted();
      return task();
    });
    queue = result.catch(() => undefined);
    return result;
  };

  /**
   * Applies one action after the ones before it. An accepted step is saved before it takes effect, so that a store that
   * rejects leaves the state, the view and the timer as they were; then the view listeners and the step listeners run. A
   * `time` action that `maxIdle` drops changes nothing and arms no timer.
   */
  const run = (action: CandidateAction | HostAction, signal: AbortSignal | undefined): Promise<Applied> =>
    enqueue(async (): Promise<Applied> => {
      const taken = stepAfterIdle({ engine, stamp: delivery.stamp }, { state, action, now: now(), maxIdle });
      if (taken === undefined) return { step: { ok: true, state, events: [] }, view: latest.view };
      const { step } = taken;
      if (step.ok) {
        await store.save(session, { state: delivery.serializeState(step.state), events: step.events }, { signal });
        state = step.state;
      }
      look();
      notifyListeners(listeners, latest.view, onError);
      if (step.ok && step.events.length > 0) notifyListeners(stepListeners, step.events, onError);
      arm();
      return { step, view: latest.view };
    }, signal);

  /** Reads the state the actions before it left. */
  const readState = <T>(from: (state: DeliveryState) => T, signal: AbortSignal | undefined): Promise<T> =>
    enqueue(() => from(state), signal);

  const read = async <T>(
    from: (state: DeliveryState) => T,
    callOptions: SessionCallOptions | undefined,
  ): Promise<T> => {
    checkCallOptions(callOptions);
    return readState(from, callOptions?.signal);
  };

  /** What the answer loop uses: the pending requests, the port, and the saved `cat-response` action. The port is called outside the queue. */
  const answerer: CatAnswerer | undefined =
    cat === undefined
      ? undefined
      : {
          waiting: async () => (await readState((current) => engine.pending(current), undefined)).cat,
          ask: (request) => delivery.sendCatRequest(cat, request),
          answer: async (request, response) =>
            hostStep((await run({ type: "cat-response", request: request.id, response }, undefined)).step),
        };
  const loops = createCatLoops();

  /**
   * Waits as a call that serves a candidate: joins the answer loop or starts it, and returns its failure as a value. The loop
   * takes no signal, so an abort ends this wait and never the loop.
   */
  const serve = async (signal: AbortSignal | undefined): Promise<CatLoopFailure | undefined> =>
    answerer === undefined ? undefined : untilAborted(loops.join("", answerer), signal);

  /** Runs the answer loop after a step of the host, unless one runs: that loop is told to read the pending work once more. */
  const finish = async (step: HostStep): Promise<HostStep> => {
    if (answerer === undefined || loops.wake("")) return step;
    const failed = await loops.join("", answerer);
    return failed === undefined ? step : { ...step, catFailure: failed.failure };
  };

  /** Runs the answer loop after the timer's step; a failure goes to `reportError`, and the next call retries. */
  const settleTimer = async (): Promise<void> => {
    if (answerer === undefined || loops.wake("")) return;
    const failed = await loops.join("", answerer);
    if (failed !== undefined) onError(failed.error);
  };

  /** Rejects with the failure of the loop when the candidate has nothing to do: the session is in progress and presents no item. */
  const rejectStranded = (failure: CatLoopFailure | undefined): void => {
    if (failure !== undefined && latest.view.status === "in-progress" && latest.view.current === undefined) {
      throw failure.error;
    }
  };

  arm();
  try {
    rejectStranded(await serve(creating));
  } catch (error) {
    // No client is returned, so nothing may keep running.
    closed = true;
    clearTimeout(timer);
    throw error;
  }

  const host: LocalHostSession = {
    apply: async (action, options) => {
      checkHostApplyOptions(options);
      if (closed) throw new DataError("The session client is closed.");
      checkHostAction(action);
      return finish(hostStep((await run(action, options?.signal)).step));
    },
    pending: (options) => read((current) => engine.pending(current), options),
    scorerView: (request, options) => read((current) => engine.scorerView(current, request), options),
    results: (options) => read((current) => engine.results(current), options),
    subscribeSteps: (listener) => {
      checkFunction(listener, "The listener must be a function");
      if (closed) throw new DataError("The session client is closed.");
      stepListeners.add(listener);
      return () => void stepListeners.delete(listener);
    },
  };

  return {
    get view() {
      return latest.view;
    },
    get documents() {
      return latest.documents;
    },
    age: () => now() - latest.receivedAt,
    assets: (path) => assets(path),
    dispatch: async (action, options) => {
      checkCallOptions(options);
      if (closed) throw new DataError("The session client is closed.");
      delivery.actionToJson(action);
      // Without the option cat the action joins the queue at once, in the order of the calls.
      const before = answerer === undefined ? undefined : await serve(options?.signal);
      const { step } = await run(action, options?.signal);
      const failure = before ?? (answerer === undefined ? undefined : await serve(options?.signal));
      rejectStranded(failure);
      return { view: latest.view, ...(step.ok ? {} : { refusal: step.refusal }) };
    },
    refresh: async (options) => {
      checkCallOptions(options);
      if (closed) throw new DataError("The session client is closed.");
      return enqueue(() => {
        look();
        notifyListeners(listeners, latest.view, onError);
        return latest.view;
      }, options?.signal);
    },
    subscribe: (listener) => {
      checkFunction(listener, "The listener must be a function");
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    close: () => {
      closed = true;
      clearTimeout(timer);
      listeners.clear();
      stepListeners.clear();
    },
    host,
  };
}
