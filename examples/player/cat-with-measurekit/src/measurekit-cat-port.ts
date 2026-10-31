import type { CatPort, ItemStage } from "@assesskit/runtime/cat";
import { DataError } from "@assesskit/runtime/errors";
import { createRandom } from "@measurekit/psychometrics";
import {
  type AdaptiveTest,
  type AdaptiveTestState,
  adaptiveTest,
  type PoolItem,
  testLength,
} from "@measurekit/psychometrics/cat";
import * as v from "valibot";
import { checkArray, checkRecord, checkString, describe, functionSchema, parseWith, positiveSchema } from "./checks.ts";
import { DEFAULT_SCALING_CONSTANT, poolOf } from "./pool.ts";
import { type CategoryOfOutcomes, responseTo, scoreCategory } from "./response.ts";
import { readAdaptiveSection } from "./section.ts";
import { loadSection, type SectionStore, type StoredAdaptiveSection, sectionStoreSchema } from "./section-store.ts";
import { checkSessionSeed, parseSessionState, readProgress, stepSeed } from "./session-state.ts";

/** Options of {@link measurekitCatPort}. */
export interface MeasurekitCatPortOptions {
  /** The host's storage of parsed sections, shared by every process of the host. */
  readonly sections: SectionStore;
  /**
   * Returns the seed of a new session: an integer from 0 to 2³² − 1, drawn from the host's own source of randomness. The
   * seed travels in the `sessionState`, and the draws of each step come from it.
   */
  readonly seeds: () => number;
  /**
   * Returns the host's items for a section, by its identifier: measurekit items for the models that usage data cannot state,
   * such as the generalized partial credit model, and items with a content area or an exposure parameter. An item
   * replaces the item of the usage data with its identifier, and a new identifier adds an item. Default: no items.
   */
  readonly pool?: (section: string) => readonly PoolItem[];
  /** Maps the outcomes of an item to its response category in the item's model. Default: the `SCORE` of the item. */
  readonly category?: CategoryOfOutcomes;
  /**
   * The factor that multiplies the discrimination `a` of every item of the usage data. measurekit's models are on the scale
   * D = 1; a bank on the normal-ogive metric, D = 1.702, states `1.702`. The usage data does not name its metric, so the
   * host does. Host items from `pool` are not scaled. Default: `1`.
   */
  readonly scalingConstant?: number;
}

/** The pool of a host that gives no items of its own. */
const NO_ITEMS = (): readonly PoolItem[] => [];

const optionsSchema = v.strictObject({
  sections: sectionStoreSchema,
  seeds: functionSchema<() => number>(),
  // A function as the default of valibot is called to make the default, so these return the functions.
  pool: v.optional(functionSchema<(section: string) => readonly PoolItem[]>(), () => NO_ITEMS),
  category: v.optional(functionSchema<CategoryOfOutcomes>(), () => scoreCategory),
  scalingConstant: v.optional(positiveSchema, DEFAULT_SCALING_CONSTANT),
});

/** Returns the stage that presents one item, or the empty stage that ends the session when there is none. */
function stageOf(next: string | null): ItemStage {
  return next === null ? { itemIdentifiers: [], stageLength: 0 } : { itemIdentifiers: [next], stageLength: 1 };
}

/** Builds the adaptive test of a section: it ends after the section's length (the CAT service leaves the settings to the engine). */
function adaptiveTestOf(section: StoredAdaptiveSection, pool: readonly PoolItem[]): AdaptiveTest {
  const { length, contentTargets, enemies } = section;
  return adaptiveTest({
    pool,
    stopping: testLength(length),
    ...(contentTargets.length === 0 ? {} : { contentTargets: Object.fromEntries(contentTargets) }),
    enemies,
  });
}

/**
 * Returns a CAT engine for item-level adaptive sections, in process, over measurekit's `adaptiveTest`. The port keeps no
 * session: the measurekit state of the candidate and the session seed travel in the `sessionState`, and only
 * sections are stored, so that any process of the host answers any request.
 *
 * - **Sections.** Create Section reads the settings (JSON `{ length, contentTargets, enemies }`) and the usage data
 *   (`A-Param`, `B-Param`, `C-Param`, `D-Param`) and stores the parse under the SHA-256 of the section data, so creating it
 *   again changes nothing. The metadata file is kept and not read. The `prefix` of every request names no network
 *   location, and the port ignores it.
 * - **Stages.** Every stage is one item. The draws of each step come from measurekit's `createRandom`, seeded from the session
 *   seed and the number of items administered, so a repeated request gives the same stage.
 * - **Responses.** The response to an item is its category, by default the `SCORE` of its result.
 * - **End.** End Session and End Section do nothing: the port holds no session, and a section is shared by every
 *   deployment that has its data.
 *
 * Errors of measurekit pass through unchanged.
 *
 * @throws `DataError` when an option has the wrong type or is out of range.
 */
export function measurekitCatPort(options: MeasurekitCatPortOptions): CatPort {
  const { sections, seeds, pool, category, scalingConstant } = parseWith(optionsSchema, options, "The options object");

  const poolFor = (identifier: string, section: StoredAdaptiveSection): PoolItem[] => {
    const hostItems = pool(identifier);
    checkArray(hostItems, `The option pool must return an array of items for the section ${describe(identifier)}`);
    return poolOf(section.items, hostItems, scalingConstant);
  };
  const open = async (identifier: unknown) => {
    checkString(identifier, "The section identifier");
    const section = await loadSection(sections, identifier, "adaptive");
    const items = poolFor(identifier, section);
    return { section, items, test: adaptiveTestOf(section, items) };
  };

  return {
    async createSection(_prefix, data) {
      const { identifier, section } = await readAdaptiveSection(data);
      const items = poolFor(identifier, section);
      if (items.length === 0) {
        throw new DataError("A section needs items: the usage data and the option pool give none.");
      }
      // Building the test checks the pool, the content targets and the enemy sets, so that a section that cannot run fails now.
      adaptiveTestOf(section, items);
      await sections.put(identifier, section);
      return { sectionIdentifier: identifier };
    },

    async getSection(_prefix, sectionIdentifier) {
      const { section, items } = await open(sectionIdentifier);
      return { sectionData: section.data, items: { itemIdentifiers: items.map(({ id }) => id) } };
    },

    async createSession(_prefix, sectionIdentifier, request) {
      checkRecord(request, "The request to create a session must be an object");
      const { test } = await open(sectionIdentifier);
      const seed: unknown = seeds();
      checkSessionSeed(seed);
      const state = test.start(createRandom(stepSeed(seed, 0)));
      return {
        sessionIdentifier: String(seed),
        nextItems: stageOf(state.next),
        sessionState: JSON.stringify({ seed, state }),
      };
    },

    async submitResults(_prefix, sectionIdentifier, _session, request) {
      checkRecord(request, "The request to submit results must be an object");
      const { seed, state } = parseSessionState(request.sessionState);
      checkSessionSeed(seed);
      const { administered, next } = readProgress(state);
      const { test, items } = await open(sectionIdentifier);
      const item = items.find(({ id }) => id === next);
      if (item === undefined) {
        throw new DataError(`The session waits for the item ${describe(next)}, which the section does not have.`);
      }
      const response = responseTo(item, request.assessmentResult, category);
      // The sessionState is untrusted JSON, and measurekit checks the whole state when it takes the response.
      const after = test.answer(state as AdaptiveTestState, response, createRandom(stepSeed(seed, administered + 1)));
      return { nextItems: stageOf(after.next), sessionState: JSON.stringify({ seed, state: after }) };
    },

    endSession: async () => undefined,
    endSection: async () => undefined,
  };
}
