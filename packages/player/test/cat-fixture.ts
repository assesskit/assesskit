import { Buffer } from "node:buffer";
import { CP_NAMESPACE } from "@assesskit/runtime/metadata";
import { openPackage, type QtiPackage } from "@assesskit/runtime/package";
import type { AssessmentResult } from "@assesskit/runtime/results";
import { type ItemStatistic, writeUsageData } from "@assesskit/runtime/usage";
import { single } from "@assesskit/runtime/values";

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

/** Returns the usage data of a bank: an ordinary statistic for each parameter that an item has. */
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

/** Returns the results of items that the candidate answered, one `SCORE` for each, as the engine sends them. */
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

/** The bank of the tests: six items with logistic parameters. */
export const BANK: readonly Bank[] = [
  { id: "q1", a: 1.2, b: -1.5, c: 0.2 },
  { id: "q2", a: 0.9, b: -0.6, c: 0.15 },
  { id: "q3", a: 1.5, b: 0, c: 0.2 },
  { id: "q4", a: 1.1, b: 0.7, c: 0.25 },
  { id: "q5", a: 1.4, b: 1.4, c: 0.1 },
  { id: "q6", a: 1, b: 2 },
];

export const ASI = "http://www.imsglobal.org/xsd/imsqtiasi_v3p0";

const resource = (identifier: string, type: string, href: string): string =>
  `<resource identifier="${identifier}" type="${type}" href="${href}"><file href="${href}"/></resource>`;

/** The resource type of a document, by its root element. */
const DOCUMENT_TYPES: readonly (readonly [root: string, type: string])[] = [
  ["<qti-assessment-test", "imsqti_test_xmlv3p0"],
  ["<qti-assessment-section", "imsqti_section_xmlv3p0"],
  ["<qti-assessment-item", "imsqti_item_xmlv3p0"],
];

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

/** A package in memory: its files, and a manifest that lists the QTI documents among them. */
export function packageOf(files: Readonly<Record<string, string>>): QtiPackage {
  const documents = Object.entries(files).flatMap(([path, text], index) => {
    const type = DOCUMENT_TYPES.find(([root]) => text.startsWith(root))?.[1];
    return type === undefined ? [] : [resource(`r${index}`, type, path)];
  });
  const manifest = `<manifest xmlns="${CP_NAMESPACE}" identifier="m"><metadata><schema>QTI Package</schema><schemaversion>3.0.0</schemaversion></metadata><organizations/><resources>${documents.join("")}</resources></manifest>`;
  const all = new Map([
    ["imsmanifest.xml", bytes(manifest)],
    ...Object.entries(files).map(([path, text]): [string, Uint8Array] => [path, bytes(text)]),
  ]);
  return openPackage({ paths: [...all.keys()].sort(), read: (path) => all.get(path) });
}

export const itemRefs = (ids: readonly string[]): string =>
  ids.map((id) => `<qti-assessment-item-ref identifier="${id}" href="items/${id}.xml"/>`).join("");

export const selectionXml = (settings: string, usage: string): string =>
  `<qti-adaptive-selection><qti-adaptive-engine-ref identifier="engine" href="${PREFIX}"/>${settings}${usage}</qti-adaptive-selection>`;

export const SETTINGS_REF = '<qti-adaptive-settings-ref identifier="settings" href="cat/settings.json"/>';
export const USAGE_REF = '<qti-usagedata-ref identifier="usage" href="cat/usage.xml"/>';

export const testXml = (sections: string): string =>
  `<qti-assessment-test xmlns="${ASI}" identifier="exam" title="Exam"><qti-test-part identifier="part" navigation-mode="nonlinear" submission-mode="individual">${sections}</qti-test-part></qti-assessment-test>`;

export const adaptiveSection = (selection: string, ids: readonly string[]): string =>
  `<qti-assessment-section identifier="cat" title="Adaptive" visible="true">${selection}${itemRefs(ids)}</qti-assessment-section>`;

export const IDS = BANK.map(({ id }) => id);
export const FILES = {
  "cat/settings.json": '{"length":3}',
  "cat/usage.xml": usageXml(BANK),
};

/** A package with a fixed section and an adaptive one, whose settings and usage data the files hold. */
export const DEPLOYABLE = packageOf({
  "test.xml": testXml(
    `${adaptiveSection(selectionXml(SETTINGS_REF, USAGE_REF), IDS)}<qti-assessment-section identifier="fixed" title="Fixed" visible="true">${itemRefs(["f1"])}</qti-assessment-section>`,
  ),
  ...FILES,
});
