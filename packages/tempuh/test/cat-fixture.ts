import { Buffer } from "node:buffer";
import { type CatPort, isSessionEnd, type SectionData } from "@luthfanwakan/olah/cat";
import type { AssessmentResult } from "@luthfanwakan/olah/results";
import { type ItemStatistic, writeUsageData } from "@luthfanwakan/olah/usage";
import { single } from "@luthfanwakan/olah/values";
import type { SectionStore, StoredSection } from "../src/cat/index.js";

/** The prefix of the engine in the tests: `qti-adaptive-engine-ref` of the sections. */
export const PREFIX = "https://cat.example/ims/cat/v1p0";

/** The parameters of an item of a bank, as a calibration states them; absent ones are left out of the usage data. */
export interface Bank {
  readonly id: string;
  readonly a?: number;
  readonly b: number;
  readonly c?: number;
  readonly d?: number;
}

const STATISTICS = [
  ["A-Param", "a"],
  ["B-Param", "b"],
  ["C-Param", "c"],
  ["D-Param", "d"],
] as const;

/** Returns the usage data of a bank: an ordinary statistic for each parameter that an item has (UD §2.8.2). */
export function usageXml(bank: readonly Bank[]): string {
  const statistics: ItemStatistic[] = bank.flatMap((item) =>
    STATISTICS.flatMap(([name, property]): ItemStatistic[] => {
      const value = item[property];
      return value === undefined
        ? []
        : [
            {
              kind: "ordinary",
              name,
              context: "http://example.org/calibration",
              targetObjects: [{ identifier: item.id }],
              value: { value },
            },
          ];
    }),
  );
  return writeUsageData({ statistics });
}

export const base64 = (text: string): string => Buffer.from(text).toString("base64");

/** Returns the section data of an adaptive section or a panel: settings as JSON, and the usage data of a bank. */
export function sectionDataOf(settings: unknown, bank?: readonly Bank[]): SectionData {
  const sectionConfiguration = base64(JSON.stringify(settings));
  return bank === undefined ? { sectionConfiguration } : { sectionConfiguration, qtiUsagedata: base64(usageXml(bank)) };
}

/** A section store in memory that keeps the JSON of what it is given, as a database would. */
export function memoryStore(): SectionStore & { readonly kept: Map<string, string> } {
  const kept = new Map<string, string>();
  return {
    kept,
    async put(identifier, section) {
      kept.set(identifier, JSON.stringify(section));
    },
    async get(identifier) {
      const text = kept.get(identifier);
      return text === undefined ? undefined : (JSON.parse(text) as StoredSection);
    },
  };
}

/** Returns the results of items that the candidate answered, one `SCORE` for each, as the engine sends them (CAT §4.3.1). */
export function resultsOf(scores: ReadonlyMap<string, number>): AssessmentResult {
  return {
    context: { sessionIdentifiers: [] },
    itemResults: [...scores].map(([identifier, score], index) => ({
      identifier,
      sequenceIndex: index + 1,
      datestamp: "2026-10-30T10:00:00",
      sessionStatus: "final",
      variables: [
        {
          kind: "outcome",
          identifier: "SCORE",
          cardinality: "single",
          baseType: "float",
          value: single("float", score),
        },
      ],
      supports: [],
    })),
  };
}

/** What a run of a session through a port presented. */
export interface Run {
  /** The identifiers of the stages' items, in order. */
  readonly items: readonly string[];
  /** The identifiers of each stage. */
  readonly stages: readonly (readonly string[])[];
  /** The `sessionState` that the last answer gave. */
  readonly sessionState: string | undefined;
}

/**
 * Plays the part of the delivery engine: creates a session, answers every stage with `answer`, and submits the results
 * of the stage with the `sessionState` it was given, until the port ends the session (CAT §3.3, §3.4, C4).
 */
export async function drive(
  port: CatPort,
  section: string,
  answer: (item: string, position: number) => number,
): Promise<Run> {
  const created = await port.createSession(PREFIX, section, {});
  let { nextItems: stage, sessionState } = created;
  const stages: string[][] = [];
  let position = 0;
  while (!isSessionEnd(stage)) {
    const ids = [...(stage.itemIdentifiers ?? [])];
    stages.push(ids);
    const scores = new Map(ids.map((id) => [id, answer(id, position++)]));
    const answered = await port.submitResults(PREFIX, section, created.sessionIdentifier, {
      assessmentResult: resultsOf(scores),
      ...(sessionState === undefined ? {} : { sessionState }),
    });
    stage = answered.nextItems ?? { itemIdentifiers: [] };
    sessionState = answered.sessionState;
  }
  return { items: stages.flat(), stages, sessionState };
}
