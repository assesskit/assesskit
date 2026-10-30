import type { AssessmentItem } from "@luthfanwakan/olah/asi";
import type {
  CandidateAction,
  CandidateView,
  DeliveryDefinition,
  DeliveryState,
  EngineOptions,
  HostAction,
  StartOptions,
  TestStructure,
} from "@luthfanwakan/olah/delivery";
import { resolveReference } from "@luthfanwakan/olah/package";
import { checkFunction, checkNonEmptyString, checkProperties, checkRecord } from "../checks.js";
import { DataError } from "../errors.js";
import {
  type DispatchResult,
  type DocumentSource,
  type SessionClient,
  type ViewDocuments,
  viewDocuments,
} from "../protocol/index.js";
import { BROWSER_CLOCK, type Clock, checkClock } from "./clock.js";

/** The longest delay that `setTimeout` takes; a longer one fires at once. */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

/** The storage of a session on the device, such as IndexedDB: the state as olah's `serializeState` writes it. */
export interface LocalStore {
  /** Returns the saved state of a session, or `undefined` when there is none. */
  load(session: string): Promise<string | undefined>;
  /** Saves the state of a session in place of the one before. */
  save(session: string, state: string): Promise<void>;
}

/** The options of {@link createLocalSession}. */
export interface LocalSessionOptions {
  /** What to deliver: a test, or an item alone for a preview (E12). */
  readonly definition: DeliveryDefinition;
  /** The options of `createEngine`. Default: none. */
  readonly engine?: EngineOptions;
  /** What `Engine.start` takes besides the seed and the time: the PNP, the universal supports and the context. Default: none. */
  readonly start?: Omit<StartOptions, "seed" | "at">;
  /** Where the state is saved and restored from. */
  readonly store: LocalStore;
  /** The identifier of the session in the store. */
  readonly session: string;
  /** The seed of a session that the store does not have yet, a safe integer. */
  readonly seed: number;
  /** Turns the path of a file in the package into the URL to load it from, such as a URL of the host's own files. */
  readonly assets: (path: string) => string;
  /** The clock that stamps actions and times the deadlines. Default: the clock of the browser. */
  readonly clock?: Clock;
}

const OPTION_NAMES = ["definition", "engine", "start", "store", "session", "seed", "assets", "clock"];

/** Returns the paths of the stimuli an item names, resolved against its document. */
const stimulusPaths = (item: AssessmentItem, path: string): readonly string[] =>
  item.stimulusRefs.map((ref) => resolveReference(path, ref.href) ?? "");

/** Returns where the documents of the definition are, for the paths that the references of the content resolve against. */
function sourceOf(definition: DeliveryDefinition, structure: TestStructure | undefined): DocumentSource {
  if (definition.kind === "item") {
    const { item, base } = definition;
    return { test: "", item: () => ({ path: base, stimuli: stimulusPaths(item, base) }) };
  }
  return {
    test: definition.base,
    item: (reference) => {
      const node = structure?.itemRef(reference);
      const path = node === undefined ? undefined : resolveReference(node.base, node.model.href);
      if (node === undefined || path === undefined) return undefined;
      const { deliverable } = definition.resolvers.items(node.model.href, node.base);
      return { path, stimuli: deliverable.kind === "qti" ? stimulusPaths(deliverable.item, path) : [] };
    },
  };
}

/**
 * Creates the session client of practice (tempuh design §2.3): the engine runs on the device, with the same client
 * interface as exam mode. It loads olah's engine with `import()`, the one place the browser code does, so an exam's
 * bundle holds no engine; the answer keys are on the device, which practice accepts, and its results are never official.
 *
 * It stamps each action with the clock, saves the state after each step that is accepted, and fires a `time` action at
 * each maximum time with `setTimeout`. A session that the store has resumes from its state; a preview of one item is a
 * session of the definition of an item.
 *
 * @param options - See {@link LocalSessionOptions}.
 * @throws `DataError` when an option has the wrong type, the engine cannot be created, or the session cannot start.
 */
export async function createLocalSession(options: LocalSessionOptions): Promise<SessionClient> {
  checkRecord(options, "The options must be an object");
  checkProperties(options, "The options", OPTION_NAMES);
  const { definition, store, session, seed, assets, clock = BROWSER_CLOCK } = options;
  checkRecord(definition, "The option definition must be an object");
  checkRecord(store, "The option store must be an object");
  checkFunction(store.load, "The function load of the option store must be a function");
  checkFunction(store.save, "The function save of the option store must be a function");
  checkNonEmptyString(session, "The option session");
  checkFunction(assets, "The option assets must be a function");
  checkClock(clock);

  const delivery = await import("@luthfanwakan/olah/delivery");
  const engine = delivery.createEngine(definition, options.engine);
  const structure =
    definition.kind === "test"
      ? delivery.resolveStructure(definition.test, definition.base, definition.resolvers)
      : undefined;
  const source = sourceOf(definition, structure);

  const saved = await store.load(session);
  let state: DeliveryState;
  if (saved === undefined) {
    const step = engine.start({ ...options.start, seed, at: clock.now() });
    if (!step.ok) throw new DataError(`The session cannot start: ${step.refusal.message}`);
    state = step.state;
    await store.save(session, delivery.serializeState(state));
  } else {
    state = delivery.deserializeState(saved);
  }

  const listeners = new Set<(view: CandidateView) => void>();
  let queue: Promise<unknown> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let latest: { view: CandidateView; documents: ViewDocuments; receivedAt: number };

  const look = (): void => {
    const now = clock.now();
    const view = engine.view(state, now);
    latest = { view, documents: viewDocuments(view, source), receivedAt: now };
  };
  look();

  /** Sets the timer for the nearest maximum time, which fires a `time` action. */
  const arm = (): void => {
    clearTimeout(timer);
    const times = engine.deadlines(state).flatMap((each) => (each.kind === "max-time" ? [each.at] : []));
    if (closed || times.length === 0) return;
    const delay = Math.max(0, Math.min(...times) - clock.now());
    timer = setTimeout(
      () => {
        if (Math.min(...times) > clock.now()) arm();
        else void run({ type: "time" }).catch((error: unknown) => reportError(error));
      },
      Math.min(delay, MAX_TIMER_DELAY_MS),
    );
  };

  /** Applies one action after the ones before it, saves an accepted step, and tells the listeners. */
  const run = (action: CandidateAction | HostAction): Promise<DispatchResult> => {
    const result = queue.then(async (): Promise<DispatchResult> => {
      const step = engine.apply(state, delivery.stamp(state, action, clock.now()));
      if (step.ok) {
        state = step.state;
        await store.save(session, delivery.serializeState(state));
      }
      look();
      for (const listener of [...listeners]) {
        try {
          listener(latest.view);
        } catch (error) {
          reportError(error);
        }
      }
      arm();
      return { view: latest.view, ...(step.ok ? {} : { refusal: step.refusal }) };
    });
    queue = result.catch(() => undefined);
    return result;
  };
  arm();

  return {
    get view() {
      return latest.view;
    },
    get documents() {
      return latest.documents;
    },
    age: () => clock.now() - latest.receivedAt,
    assets: (path) => assets(path),
    dispatch: async (action) => {
      if (closed) throw new DataError("The session client is closed.");
      delivery.actionToJson(action);
      return run(action);
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
    },
  };
}
