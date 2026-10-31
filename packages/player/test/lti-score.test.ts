// biome-ignore-all lint/style/useNamingConvention: the names of LTI messages and of OAuth 2.0 responses are snake_case.

import type { PendingWork, ScoringRequest } from "@assesskit/runtime/delivery";
import { DataError } from "@assesskit/runtime/errors";
import type { AssessmentResult, ResultVariable } from "@assesskit/runtime/results";
import { single } from "@assesskit/runtime/values";
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceError } from "../src/index.js";
import {
  type AccessTokenOptions,
  createJwksCache,
  type LtiLaunch,
  ltiLaunch,
  ltiLogin,
  publishScore,
  type ResourceLinkLaunch,
} from "../src/lti/index.js";
import { gradingProgressOf, scoreFields } from "../src/lti/score-body.js";
import { markOfficial, type OfficialResult } from "../src/protocol/official.js";
import { FakeLms, LINE_ITEM_URL, SCORE_TYPE, SUBJECT } from "./lti-fake-lms.js";
import { cookieOf, FakePlatform, MemoryStore, registrationOf } from "./lti-fake-platform.js";
import { createClock, generateKeyPair, type TestClock } from "./lti-fixture.js";

/**
 * The expected bodies come from the examples of LTI AGS 2.0: 3.4.3.1 posts a final score, and 3.4.8.1 posts a score that
 * waits for a person. The fake learning platform checks the rules of 3.4.4, 3.4.7, 3.4.8 and 3.4.9 on every request.
 */

afterEach(() => vi.useRealTimers());

const platformKey = await generateKeyPair("platform-1");
const toolKey = await generateKeyPair("tool-1");
const AGS = "https://purl.imsglobal.org/spec/lti-ags/scope/";
const DATESTAMP = "2023-11-14T22:13:20.000Z";

/** A tool with its registration against a learning platform, and the launch of a test. */
async function setup(): Promise<{
  readonly clock: TestClock;
  readonly lms: FakeLms;
  readonly launch: ResourceLinkLaunch;
  readonly options: AccessTokenOptions;
}> {
  const clock = createClock();
  const platform = new FakePlatform(clock, platformKey);
  platform.toolKey = toolKey;
  const lms = new FakeLms(platform);
  const registration = registrationOf(toolKey);
  const options = {
    registration: async () => registration,
    clock,
    store: new MemoryStore(),
    jwks: createJwksCache({ fetch: platform.fetch }),
    fetch: lms.fetch,
  };
  const started = await ltiLogin(platform.initiation(), options);
  const auth = await platform.authenticate(started.headers.location ?? "", { claims: { sub: SUBJECT } });
  const launched: LtiLaunch | unknown = await ltiLaunch(
    auth.post({ cookie: cookieOf(started.headers["set-cookie"]) }),
    options,
  );
  if (typeof launched !== "object" || launched === null || !("messageType" in launched)) throw new Error("No launch.");
  if (launched.messageType !== "LtiResourceLinkRequest") throw new Error("Not a resource link launch.");
  return { clock, lms, launch: launched as ResourceLinkLaunch, options };
}

/** A float outcome of a report. */
const outcome = (identifier: string, value: number | null): ResultVariable => ({
  kind: "outcome",
  identifier,
  cardinality: "single",
  baseType: "float",
  value: value === null ? null : single("float", value),
});

/** A report of a test with the given outcomes, marked official as the session host does. */
function report(outcomes: Readonly<Record<string, number | null>>, datestamp = DATESTAMP): OfficialResult {
  const result: AssessmentResult = {
    context: { sessionIdentifiers: [] },
    testResult: {
      identifier: "exam",
      datestamp,
      variables: Object.entries(outcomes).map(([identifier, value]) => outcome(identifier, value)),
      supports: [],
    },
    itemResults: [],
  };
  return markOfficial(result);
}

const open = (mode: "human" | "externalMachine", id = "test:SCORE"): ScoringRequest => ({
  id,
  scope: "test",
  outcome: "SCORE",
  mode,
  declaration: { cardinality: "single", baseType: "float" },
  covers: [],
  requestedAt: 0,
});
const nothing: PendingWork = { scoring: [], cat: [] };
const waiting = (...modes: readonly ("human" | "externalMachine")[]): PendingWork => ({
  scoring: modes.map((mode, index) => open(mode, `test:R${index}`)),
  cat: [],
});

describe("publishScore", () => {
  it("[T105] posts a final score as LTI AGS 2.0 example 3.4.3.1 does: scoreGiven with scoreMaximum, Completed and FullyGraded", async () => {
    const { lms, launch, options } = await setup();
    await publishScore(report({ SCORE: 83, MAXSCORE: 100 }), launch, nothing, options);
    expect(lms.accepted).toEqual([
      {
        userId: SUBJECT,
        timestamp: DATESTAMP,
        scoreGiven: 83,
        scoreMaximum: 100,
        activityProgress: "Completed",
        gradingProgress: "FullyGraded",
      },
    ]);
    expect(lms.calls).toEqual([`POST ${LINE_ITEM_URL}/scores`]);
    expect(lms.platform.grants.map(({ scope }) => scope)).toEqual([`${AGS}score`]);
  });

  it("[T105] posts a score that waits for a person as example 3.4.8.1 does, without a score, though the report has one", async () => {
    const { lms, launch, options } = await setup();
    await publishScore(report({ SCORE: 12, MAXSCORE: 100 }), launch, waiting("human", "externalMachine"), options);
    expect(lms.accepted).toEqual([
      { userId: SUBJECT, timestamp: DATESTAMP, activityProgress: "Completed", gradingProgress: "PendingManual" },
    ]);
  });

  it("[T105] posts the score so far as Pending while only scoring services are left", async () => {
    const { lms, launch, options } = await setup();
    await publishScore(report({ SCORE: 12, MAXSCORE: 100 }), launch, waiting("externalMachine"), options);
    expect(lms.accepted).toEqual([
      {
        userId: SUBJECT,
        timestamp: DATESTAMP,
        scoreGiven: 12,
        scoreMaximum: 100,
        activityProgress: "Completed",
        gradingProgress: "Pending",
      },
    ]);
  });

  it("[T105] sends a negative SCORE as 0 with the report's value in the comment, and a zero as it is", async () => {
    const { lms, launch, options } = await setup();
    await publishScore(report({ SCORE: -2.5, MAXSCORE: 10 }), launch, nothing, options);
    await publishScore(report({ SCORE: 0, MAXSCORE: 10 }, "2023-11-14T22:13:21.000Z"), launch, nothing, options);
    expect(lms.accepted).toMatchObject([
      { scoreGiven: 0, scoreMaximum: 10, comment: "Raw score: -2.5" },
      { scoreGiven: 0, scoreMaximum: 10 },
    ]);
    expect(lms.accepted[1]).not.toHaveProperty("comment");
  });

  it("[T105] takes the time of the report as the timestamp, which grows as the session changes", async () => {
    const { lms, launch, options } = await setup();
    await publishScore(report({ SCORE: 1, MAXSCORE: 10 }, "2023-11-14T22:13:20.001Z"), launch, nothing, options);
    await publishScore(report({ SCORE: 2, MAXSCORE: 10 }, "2023-11-14T22:14:00.000Z"), launch, nothing, options);
    expect(lms.accepted.map(({ timestamp }) => timestamp)).toEqual([
      "2023-11-14T22:13:20.001Z",
      "2023-11-14T22:14:00.000Z",
    ]);
  });

  it("[T105] reads the scoreMaximum of the line item when the report has no MAXSCORE, and asks for the scope to read it", async () => {
    const { lms, launch, options } = await setup();
    await publishScore(report({ SCORE: 7 }), launch, nothing, options);
    expect(lms.calls).toEqual([`GET ${LINE_ITEM_URL}`, `POST ${LINE_ITEM_URL}/scores`]);
    expect(lms.accepted[0]).toMatchObject({ scoreGiven: 7, scoreMaximum: 100 });
    expect(lms.platform.grants.map(({ scope }) => scope)).toEqual([`${AGS}score ${AGS}lineitem`]);
  });

  it("[T105] prefers the read-only line item scope when the launch offers it", async () => {
    const { lms, launch, options } = await setup();
    const offered = {
      ...launch,
      ags: { ...launch.ags, scopes: [`${AGS}lineitem`, `${AGS}lineitem.readonly`, `${AGS}score`] },
    };
    // The fake platform grants only what its list holds, so the read-only scope is asked and not granted.
    await expect(
      publishScore(report({ SCORE: 7 }), offered as ResourceLinkLaunch, nothing, options),
    ).rejects.toMatchObject({
      reason: "scope-denied",
    });
    expect(lms.platform.grants.map(({ scope }) => scope)).toEqual([`${AGS}score ${AGS}lineitem.readonly`]);
  });

  it("[T105] needs no line item when there is no score to give", async () => {
    const { lms, launch, options } = await setup();
    await publishScore(report({}), launch, nothing, options);
    await publishScore(
      report({ SCORE: null }, "2023-11-14T22:13:21.000Z"),
      launch,
      waiting("externalMachine"),
      options,
    );
    expect(lms.calls).toEqual([`POST ${LINE_ITEM_URL}/scores`, `POST ${LINE_ITEM_URL}/scores`]);
    expect(lms.accepted).toMatchObject([{ gradingProgress: "FullyGraded" }, { gradingProgress: "Pending" }]);
    expect(lms.accepted.every((score) => !("scoreGiven" in score))).toBe(true);
  });

  it("[T105] keeps the query of the line item URL on the URL of its scores", async () => {
    const { launch, options, lms } = await setup();
    const line = `${LINE_ITEM_URL}?type_id=3`;
    const urls: string[] = [];
    const fetch: AccessTokenOptions["fetch"] = async (url, init) => {
      if (url.includes("/scores")) {
        urls.push(url);
        return new Response(null, { status: 204 });
      }
      return lms.fetch(url, init);
    };
    await publishScore(
      report({ SCORE: 1, MAXSCORE: 2 }),
      { ...launch, ags: { ...launch.ags, scopes: launch.ags?.scopes ?? [], lineitem: line } },
      nothing,
      { ...options, fetch },
    );
    expect(urls).toEqual([`${LINE_ITEM_URL}/scores?type_id=3`]);
  });

  it("[T105] scores the one item that a session delivered alone, and refuses a report with several items and no test", async () => {
    const { lms, launch, options } = await setup();
    const itemResult = (identifier: string) => ({
      identifier,
      datestamp: DATESTAMP,
      sessionStatus: "final" as const,
      variables: [outcome("SCORE", 3), outcome("MAXSCORE", 4)],
      supports: [],
    });
    const alone = markOfficial({ context: { sessionIdentifiers: [] }, itemResults: [itemResult("q1")] });
    await publishScore(alone, launch, nothing, options);
    expect(lms.accepted[0]).toMatchObject({ scoreGiven: 3, scoreMaximum: 4 });
    const several = markOfficial({
      context: { sessionIdentifiers: [] },
      itemResults: [itemResult("q1"), itemResult("q2")],
    });
    await expect(publishScore(several, launch, nothing, options)).rejects.toThrow(
      "The results report must have a test result or the result of one item",
    );
  });

  it("[T105] refuses a report that the session host did not return, and one that is a copy of it", async () => {
    const { lms, launch, options } = await setup();
    const official = report({ SCORE: 1, MAXSCORE: 2 });
    const refusal = "A score is published from the results report that SessionHost.results returned";
    await expect(publishScore({ ...official } as OfficialResult, launch, nothing, options)).rejects.toThrow(refusal);
    await expect(publishScore(structuredClone(official), launch, nothing, options)).rejects.toThrow(refusal);
    await expect(publishScore(JSON.parse("null"), launch, nothing, options)).rejects.toThrow(refusal);
    expect(lms.received).toEqual([]);
  });

  it("[T105] refuses a Deep Linking request, a launch without grade services, without the score scope and without a user", async () => {
    const { lms, launch, options } = await setup();
    const results = report({ SCORE: 1, MAXSCORE: 2 });
    const refuse = (change: object, reason: string) =>
      expect(publishScore(results, { ...launch, ...change } as LtiLaunch, nothing, options)).rejects.toMatchObject({
        name: "LtiError",
        reason,
      });
    await refuse({ ags: undefined }, "line-item-unavailable");
    await refuse(
      { ags: { scopes: launch.ags?.scopes ?? [], lineitems: "https://lms.example.edu/lineitems" } },
      "line-item-unavailable",
    );
    await refuse({ ags: { scopes: [`${AGS}lineitem`], lineitem: LINE_ITEM_URL } }, "scope-unavailable");
    await refuse({ subject: undefined }, "subject-unavailable");
    await expect(
      publishScore(results, { ...launch, messageType: "LtiDeepLinkingRequest" } as never, nothing, options),
    ).rejects.toThrow(
      'A score is published for a resource link launch, found the message type "LtiDeepLinkingRequest".',
    );
    expect(lms.received).toEqual([]);
  });

  it("[T105] refuses to read the line item without a scope to read it, and a line item without a scoreMaximum", async () => {
    const { lms, launch, options } = await setup();
    const results = report({ SCORE: 1 });
    await expect(
      publishScore(results, { ...launch, ags: { scopes: [`${AGS}score`], lineitem: LINE_ITEM_URL } }, nothing, options),
    ).rejects.toMatchObject({ reason: "scope-unavailable" });
    lms.scoreMaximum = undefined;
    await expect(publishScore(results, launch, nothing, options)).rejects.toThrow(
      "The scoreMaximum of the line item must be a number above 0 when the results have no MAXSCORE, found undefined.",
    );
    expect(lms.received).toEqual([]);
  });

  it("[T105] refuses a SCORE or MAXSCORE that cannot be a score", async () => {
    const { launch, options } = await setup();
    const text: AssessmentResult = {
      context: { sessionIdentifiers: [] },
      testResult: {
        identifier: "exam",
        datestamp: DATESTAMP,
        variables: [
          {
            kind: "outcome",
            identifier: "SCORE",
            cardinality: "single",
            baseType: "string",
            value: single("string", "high"),
          },
        ],
        supports: [],
      },
      itemResults: [],
    };
    await expect(publishScore(markOfficial(text), launch, nothing, options)).rejects.toThrow(DataError);
    await expect(publishScore(report({ SCORE: 1, MAXSCORE: 0 }), launch, nothing, options)).rejects.toThrow(
      "The outcome MAXSCORE must be above 0 to be the scoreMaximum of a score, found 0.",
    );
    await expect(publishScore(report({ SCORE: Number.POSITIVE_INFINITY }), launch, nothing, options)).rejects.toThrow(
      "must be one finite integer or float to publish",
    );
  });

  it("[T105] fails with the status of a score service that does not accept the score", async () => {
    const { lms, launch, options } = await setup();
    lms.scoreStatus = 503;
    await expect(publishScore(report({ SCORE: 1, MAXSCORE: 2 }), launch, nothing, options)).rejects.toMatchObject({
      name: ServiceError.name,
      status: 503,
    });
    lms.scoreStatus = 422;
    await expect(publishScore(report({ SCORE: 1, MAXSCORE: 2 }), launch, nothing, options)).rejects.toMatchObject({
      status: 422,
      body: "no",
    });
  });

  it("[T105] throws DataError for arguments of other types", async () => {
    const { launch, options } = await setup();
    const results = report({ SCORE: 1, MAXSCORE: 2 });
    await expect(publishScore(results, launch, nothing, JSON.parse("null"))).rejects.toThrow(
      new DataError("The options must be an object, found null."),
    );
    await expect(publishScore(results, JSON.parse("null"), nothing, options)).rejects.toThrow(
      new DataError("The launch must be an object, found null."),
    );
    await expect(publishScore(results, launch, JSON.parse('{"scoring": "none"}'), options)).rejects.toThrow(
      new DataError('The scoring requests of the pending work must be an array, found "none".'),
    );
    await expect(publishScore(results, launch, JSON.parse("[]"), options)).rejects.toThrow(DataError);
    await expect(publishScore(results, launch, JSON.parse('{"scoring": [null]}'), options)).rejects.toThrow(
      new DataError("A scoring request of the pending work must be an object, found null."),
    );
    const broken = (change: object): Promise<void> =>
      publishScore(results, { ...launch, ...change } as never, nothing, options);
    await expect(
      broken({ ags: JSON.parse('{"lineitem": "https://lms.example.edu/l", "scopes": "score"}') }),
    ).rejects.toThrow(new DataError('The scopes of the grade services of the launch must be an array, found "score".'));
    await expect(broken({ ags: JSON.parse('{"lineitem": "http://lms.example.edu/l", "scopes": []}') })).rejects.toThrow(
      new DataError('The line item of the launch must be an absolute https URL, found "http://lms.example.edu/l".'),
    );
    await expect(broken({ ags: JSON.parse("5") })).rejects.toThrow(
      new DataError("The grade services of the launch must be an object, found 5."),
    );
    await expect(broken({ subject: JSON.parse("7") })).rejects.toThrow(
      new DataError("The subject of the launch must be a non-empty string, found 7."),
    );
  });

  it("[T105] sends the score with the media type of the score service and the token of the platform", async () => {
    const { launch, options, lms } = await setup();
    const seen: Record<string, string>[] = [];
    const fetch: AccessTokenOptions["fetch"] = async (url, init) => {
      if (url.endsWith("/scores")) seen.push({ ...init.headers });
      return lms.fetch(url, init);
    };
    await publishScore(report({ SCORE: 1, MAXSCORE: 2 }), launch, nothing, { ...options, fetch });
    expect(seen).toEqual([{ "content-type": SCORE_TYPE, authorization: "Bearer access-token-1" }]);
  });
});

describe("gradingProgressOf", () => {
  it("[T105] is PendingManual while any request waits for a person, Pending while only services are left, and FullyGraded after", () => {
    expect(gradingProgressOf(waiting("externalMachine", "human"))).toBe("PendingManual");
    expect(gradingProgressOf(waiting("externalMachine", "externalMachine"))).toBe("Pending");
    expect(gradingProgressOf(nothing)).toBe("FullyGraded");
  });
});

describe("properties", () => {
  const modes = fc.array(fc.constantFrom("human" as const, "externalMachine" as const), { maxLength: 4 });
  const number = fc.double({ noNaN: true, noDefaultInfinity: true, min: -1e9, max: 1e9 });

  it("[T105] gives scoreGiven from 0 together with a scoreMaximum above 0 for any SCORE, and none while a person scores", () => {
    fc.assert(
      fc.property(
        number,
        fc.double({ noNaN: true, noDefaultInfinity: true, min: 1e-9, max: 1e9 }),
        modes,
        (raw, maximum, kinds) => {
          const fields = scoreFields(report({ SCORE: raw, MAXSCORE: maximum }), waiting(...kinds));
          expect(fields.gradingProgress).toBe(gradingProgressOf(waiting(...kinds)));
          if (fields.gradingProgress === "PendingManual") {
            expect(fields.scoreGiven).toBeUndefined();
            return;
          }
          expect(fields.scoreGiven).toBe(Math.max(0, raw));
          expect(fields.scoreGiven).toBeGreaterThanOrEqual(0);
          expect(fields.maximum).toBe(maximum);
          expect(fields.comment !== undefined).toBe(raw < 0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("[T105] posts any finite SCORE as a score that the platform accepts", async () => {
    const { lms, launch, options } = await setup();
    await fc.assert(
      fc.asyncProperty(number, fc.integer({ min: 0, max: 1_000_000 }), async (raw, offset) => {
        const before = lms.accepted.length;
        const datestamp = new Date(Date.parse(DATESTAMP) + (before + offset) * 1000 + before).toISOString();
        await publishScore(report({ SCORE: raw, MAXSCORE: 50 }, datestamp), launch, nothing, options);
        const posted = lms.received.at(-1);
        expect(posted?.scoreGiven).toBe(Math.max(0, raw));
        expect(posted?.scoreMaximum).toBe(50);
      }),
      { numRuns: 30 },
    );
  });
});
