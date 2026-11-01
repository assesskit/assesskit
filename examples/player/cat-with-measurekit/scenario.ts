import { Buffer } from "node:buffer";
import { type CatFetch, createRestCatPort } from "@assesskit/player/cat-rest";
import { type CatPort, isSessionEnd } from "@assesskit/runtime/cat";
import type { AssessmentResult } from "@assesskit/runtime/results";
import { type ItemStatistic, writeUsageData } from "@assesskit/runtime/usage";
import { single } from "@assesskit/runtime/values";
import { DEMO_CREDENTIALS, demoServer } from "./src/demo-server.ts";
import { measurekitCatPort } from "./src/measurekit-cat-port.ts";
import { memoryStore } from "./src/memory-store.ts";

const PREFIX = "https://cat.example/ims/cat/v1p0";

/** The calibrated items of the bank: the discrimination `a` and the difficulty `b` of each. */
const BANK = [
  { id: "q1", a: 1.2, b: -1.5 },
  { id: "q2", a: 0.9, b: -0.6 },
  { id: "q3", a: 1.5, b: 0 },
  { id: "q4", a: 1.1, b: 0.7 },
  { id: "q5", a: 1.4, b: 1.4 },
];

/** The usage data of the bank: an ordinary statistic for each parameter of each item. */
const usage = writeUsageData({
  statistics: BANK.flatMap(({ id, a, b }): ItemStatistic[] =>
    [
      ["A-Param", a],
      ["B-Param", b],
    ].map(([name, value]) => ({
      kind: "ordinary",
      name: String(name),
      context: "http://example.org/calibration",
      targetObjects: [{ identifier: id }],
      value: { value: Number(value) },
    })),
  ),
});

const base64 = (text: string): string => Buffer.from(text).toString("base64");

/** The result of one answered item, as the delivery engine sends it: the outcome `SCORE`. */
const resultOf = (item: string, score: number): AssessmentResult => ({
  context: { sessionIdentifiers: [] },
  itemResults: [
    {
      identifier: item,
      sequenceIndex: 1,
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
    },
  ],
});

/**
 * Runs an adaptive section of three items over the bank the way the delivery engine does: creates the section and a
 * session, then submits the result of each presented item until the port answers with the empty stage.
 *
 * @param port - The engine. Any implementation of `CatPort` works in its place.
 * @param answer - Tells whether the candidate answers an item correctly.
 * @returns The identifiers of the items in the order they were presented.
 */
export async function administer(port: CatPort, answer: (item: string) => boolean): Promise<readonly string[]> {
  const { sectionIdentifier } = await port.createSection(PREFIX, {
    sectionConfiguration: base64(JSON.stringify({ length: 3 })),
    qtiUsagedata: base64(usage),
  });
  const session = await port.createSession(PREFIX, sectionIdentifier, {});
  const presented: string[] = [];
  let { nextItems, sessionState } = session;
  while (!isSessionEnd(nextItems)) {
    const [item] = nextItems.itemIdentifiers ?? [];
    if (item === undefined) break;
    presented.push(item);
    const submitted = await port.submitResults(PREFIX, sectionIdentifier, session.sessionIdentifier, {
      assessmentResult: resultOf(item, answer(item) ? 1 : 0),
      ...(sessionState === undefined ? {} : { sessionState }),
    });
    nextItems = submitted.nextItems ?? { itemIdentifiers: [] };
    sessionState = submitted.sessionState;
  }
  return presented;
}

/** The candidate of the scenario answers the items of the bank that are easier than 0.5 and misses the others. */
export const answersEasyItems = (item: string): boolean => (BANK.find(({ id }) => id === item)?.b ?? 0) < 0.5;

/**
 * Returns a `fetch` that hands each request to a server in the same process, so that the REST client reaches an engine
 * server without a network. The client requires `https` URLs, and a server behind real TLS is reached with the real `fetch`.
 *
 * @param server - Answers each request.
 */
export function fetchFrom(server: (request: Request) => Promise<Response>): CatFetch {
  return async (url, { method, headers, body, signal }) => {
    const response = await server(
      new Request(url, { method, headers, signal, ...(body === undefined ? {} : { body }) }),
    );
    return { ok: response.ok, status: response.status, text: () => response.text() };
  };
}

if (import.meta.main) {
  const port = measurekitCatPort({ sections: memoryStore(), seeds: () => 42 });
  console.log((await administer(port, answersEasyItems)).join(", "));
  // The same section over the REST binding: the client of the player, the engine server, and the engine behind it.
  const client = createRestCatPort({
    fetch: fetchFrom(demoServer()),
    engines: new Map([[PREFIX, { endpoint: PREFIX, credentials: DEMO_CREDENTIALS }]]),
  });
  console.log((await administer(client, answersEasyItems)).join(", "));
}
