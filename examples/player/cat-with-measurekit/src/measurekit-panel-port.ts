import type { CatPort, ItemStage } from "@assesskit/runtime/cat";
import { DataError } from "@assesskit/runtime/errors";
import {
  createMultistageTest,
  type MultistageModule,
  type MultistageTest,
  type MultistageTestState,
} from "@measurekit/psychometrics/cat";
import type { TestItem } from "@measurekit/psychometrics/irt";
import * as v from "valibot";
import { checkRecord, checkString, describe, functionSchema, parseWith, positiveSchema } from "./checks.ts";
import { DEFAULT_SCALING_CONSTANT, poolOf } from "./pool.ts";
import { responseTo, scoreCategory } from "./response.ts";
import { readPanelSection } from "./section.ts";
import { loadSection, type SectionStore, type StoredPanelSection, sectionStoreSchema } from "./section-store.ts";
import { parseSessionState, readProgress } from "./session-state.ts";

/** What the host knows of a panel that its settings file does not say. */
export interface PanelParameters {
  /**
   * The cut points on the theta scale that route a person from a module to a module of the next stage, by module
   * identifier: ascending, one fewer than the modules of the next stage. A person goes to module j of the next stage,
   * counting from 0, when exactly j cuts are at most the estimate. Modules of the last stage have none.
   */
  readonly cuts: ReadonlyMap<string, readonly number[]>;
}

/** Options of {@link measurekitPanelPort}. */
export interface MeasurekitPanelPortOptions {
  /** The host's storage of parsed sections, shared by every process of the host. */
  readonly sections: SectionStore;
  /** Returns the parameters of the panel of a section, by its identifier. */
  readonly panels: (section: string) => PanelParameters;
  /**
   * The factor that multiplies the discrimination `a` of every item of the usage data; see
   * {@link MeasurekitCatPortOptions.scalingConstant}. Default: `1`.
   */
  readonly scalingConstant?: number;
}

const optionsSchema = v.strictObject({
  sections: sectionStoreSchema,
  panels: functionSchema<(section: string) => PanelParameters>(),
  scalingConstant: v.optional(positiveSchema, DEFAULT_SCALING_CONSTANT),
});

/** Returns the stage that presents a module, or the empty stage that ends the session when there is none. */
function stageOf(module: MultistageModule | undefined): ItemStage {
  return module === undefined
    ? { itemIdentifiers: [], stageLength: 0 }
    : { itemIdentifiers: module.items.map(({ id }) => id), stageLength: module.items.length };
}

function checkPanelParameters(parameters: unknown, section: string): asserts parameters is PanelParameters {
  checkRecord(parameters, `The option panels must return an object for the section ${describe(section)}`);
  if (!(parameters.cuts instanceof Map)) {
    throw new DataError(
      `The cuts of the panel of the section ${describe(section)} must be a Map of module identifier and cut points, found ${describe(parameters.cuts)}.`,
    );
  }
}

/** Builds the multistage test of a panel: modules routed by the estimate of theta. */
function multistageTestOf(
  section: StoredPanelSection,
  pool: readonly TestItem[],
  { cuts }: PanelParameters,
): MultistageTest {
  const items = new Map(pool.map((item) => [item.id, item]));
  const stages = section.stages.map((stage) =>
    stage.map(({ id, items: listed }): MultistageModule => {
      const moduleCuts = cuts.get(id);
      return {
        id,
        items: listed.flatMap((item) => items.get(item) ?? []),
        ...(moduleCuts === undefined ? {} : { cuts: moduleCuts }),
      };
    }),
  );
  return createMultistageTest({ stages, routing: "theta" });
}

/**
 * Returns a CAT engine for calibrated multistage panels, in process, over measurekit's `createMultistageTest` with routing by the
 * estimate of theta. Like {@link measurekitCatPort}, it keeps no session: the measurekit state travels in the `sessionState`, and
 * sections are stored under the SHA-256 of their section data. The settings file is JSON `{ stages: [{ modules: [{ id,
 * items }] }] }`, the usage data gives the parameters of the items, and the host gives the cut points. A stage of the
 * session is a module: all its items, in order, with the module's length as the stage length. Routing draws no random
 * number, so the port takes no seeds, and its session identifier is the section's.
 *
 * Errors of measurekit pass through unchanged.
 *
 * @throws `DataError` when an option has the wrong type or is out of range.
 */
export function measurekitPanelPort(options: MeasurekitPanelPortOptions): CatPort {
  const { sections, panels, scalingConstant } = parseWith(optionsSchema, options, "The options object");

  const testOf = (identifier: string, section: StoredPanelSection): MultistageTest => {
    const parameters: unknown = panels(identifier);
    checkPanelParameters(parameters, identifier);
    return multistageTestOf(section, poolOf(section.items, [], scalingConstant), parameters);
  };
  const open = async (identifier: unknown) => {
    checkString(identifier, "The section identifier");
    const section = await loadSection(sections, identifier, "panel");
    return { section, test: testOf(identifier, section) };
  };

  return {
    async createSection(_prefix, data) {
      const { identifier, section } = await readPanelSection(data);
      // Building the test checks the modules and their cut points, so that a panel that cannot run fails now.
      testOf(identifier, section);
      await sections.put(identifier, section);
      return { sectionIdentifier: identifier };
    },

    async getSection(_prefix, sectionIdentifier) {
      const { section, test } = await open(sectionIdentifier);
      const itemIdentifiers = test.stages.flat().flatMap(({ items }) => items.map(({ id }) => id));
      return { sectionData: section.data, items: { itemIdentifiers } };
    },

    async createSession(_prefix, sectionIdentifier, request) {
      checkRecord(request, "The request to create a session must be an object");
      const { test } = await open(sectionIdentifier);
      const state = test.start();
      return {
        sessionIdentifier: sectionIdentifier,
        nextItems: stageOf(test.stages.flat().find(({ id }) => id === state.next)),
        sessionState: JSON.stringify(state),
      };
    },

    async submitResults(_prefix, sectionIdentifier, _session, request) {
      checkRecord(request, "The request to submit results must be an object");
      const state: unknown = parseSessionState(request.sessionState);
      const { next } = readProgress(state);
      const { test } = await open(sectionIdentifier);
      const modules = test.stages.flat();
      const module = modules.find(({ id }) => id === next);
      if (module === undefined) {
        throw new DataError(`The session waits for the module ${describe(next)}, which the panel does not have.`);
      }
      const responses = module.items.map((item) => responseTo(item, request.assessmentResult, scoreCategory));
      // The sessionState is untrusted JSON, and measurekit checks the whole state when it takes the responses.
      const after = test.answer(state as MultistageTestState, responses);
      return {
        nextItems: stageOf(modules.find(({ id }) => id === after.next)),
        sessionState: JSON.stringify(after),
      };
    },

    endSession: async () => undefined,
    endSection: async () => undefined,
  };
}
