// biome-ignore-all lint/style/useNamingConvention: the names of LTI messages and of AGS scores are camelCase or snake_case by the specifications.

import type { Fetch } from "@interopkit/core";
import { expect } from "vitest";
import { type FakePlatform, ISSUER } from "./fake-platform.ts";
import { textOf } from "./fixture.ts";

export const LINE_ITEM_URL = `${ISSUER}/2344/lineitems/1234/lineitem`;
const LINE_ITEM_TYPE = "application/vnd.ims.lis.v2.lineitem+json";
const SCORE_TYPE = "application/vnd.ims.lis.v1.score+json";
export const SUBJECT = "a6d5c443-1f51-4783-ba1a-7686ffe3b54a";

const ACTIVITY_PROGRESS = ["Initialized", "Started", "InProgress", "Submitted", "Completed"];
const GRADING_PROGRESS = ["FullyGraded", "Pending", "PendingManual", "Failed", "NotReady"];
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+(?:Z|[+-]\d{2}(?::?\d{2})?)$/u;

/** A score that the learning platform accepted, as the tool posted it. */
export type ReceivedScore = Record<string, unknown>;

/**
 * The learning platform's services for a tool that has been launched: the token endpoint and the key set of `FakePlatform`,
 * the line item, and the score service of LTI AGS 2.0 section 3.4. It checks what the specification says a platform may
 * rely on: the bearer token and the media types, a `userId`, a timestamp with a sub-second part and a zone, the values of the
 * two progress properties, `scoreGiven` from 0 with a `scoreMaximum` above 0, and that the timestamp grows. It is written
 * from the specification, not from the code under test.
 */
export class FakeLms {
  /** The scores it accepted, in order, with an older one dropped as the specification allows. */
  readonly accepted: ReceivedScore[] = [];
  /** Every score request that reached it, accepted or not. */
  readonly received: ReceivedScore[] = [];
  /** The calls to the line item and the score service, as `METHOD url`. */
  readonly calls: string[] = [];
  /** The `scoreMaximum` of the line item; `undefined` makes the line item answer without one. */
  scoreMaximum: number | undefined = 100;
  /** Makes the score service answer with this status while set. */
  scoreStatus: number | undefined;
  /** The platform whose token endpoint and key set the tool uses. */
  readonly platform: FakePlatform;
  private lastTimestamp = Number.NEGATIVE_INFINITY;

  constructor(platform: FakePlatform) {
    this.platform = platform;
  }

  /** The `fetch` of the tool: the platform's, and the services of the line item. */
  readonly fetch: Fetch = async (url, init) => {
    if (url === LINE_ITEM_URL) return this.lineItem(url, init);
    if (url === `${LINE_ITEM_URL}/scores`) return this.scores(url, init);
    return this.platform.fetch(url, init);
  };

  private authorized(init: Parameters<Fetch>[1]): boolean {
    expect(init.redirect).toBe("manual");
    return init.headers.authorization === "Bearer access-token-1";
  }

  private lineItem(url: string, init: Parameters<Fetch>[1]): Response {
    this.calls.push(`${init.method} ${url}`);
    expect(init.method).toBe("GET");
    expect(init.headers.accept).toBe(LINE_ITEM_TYPE);
    if (!this.authorized(init)) return new Response("", { status: 401 });
    return new Response(
      JSON.stringify({
        id: LINE_ITEM_URL,
        label: "Exam",
        resourceLinkId: "200d101f-2c14-434a-a0f3-57c2a42369fd",
        ...(this.scoreMaximum === undefined ? {} : { scoreMaximum: this.scoreMaximum }),
      }),
      { status: 200, headers: { "content-type": LINE_ITEM_TYPE } },
    );
  }

  private scores(url: string, init: Parameters<Fetch>[1]): Response {
    this.calls.push(`${init.method} ${url}`);
    expect(init.method).toBe("POST");
    expect(init.headers["content-type"]).toBe(SCORE_TYPE);
    if (!this.authorized(init)) return new Response("", { status: 401 });
    const score: ReceivedScore = JSON.parse(textOf(init.body));
    this.received.push(score);
    if (this.scoreStatus !== undefined) return new Response("no", { status: this.scoreStatus });
    expect(score.userId, "the userId").toBe(SUBJECT);
    expect(String(score.timestamp)).toMatch(TIMESTAMP);
    expect(ACTIVITY_PROGRESS).toContain(score.activityProgress);
    expect(GRADING_PROGRESS).toContain(score.gradingProgress);
    if (score.scoreGiven !== undefined) {
      expect(typeof score.scoreGiven === "number" && score.scoreGiven >= 0, "scoreGiven from 0").toBe(true);
      expect(typeof score.scoreMaximum === "number" && score.scoreMaximum > 0, "scoreMaximum above 0").toBe(true);
    }
    const time = Date.parse(String(score.timestamp));
    // The platform must not update a result when the last timestamp on record is later than the incoming score.
    if (time >= this.lastTimestamp) {
      this.lastTimestamp = time;
      this.accepted.push(score);
    }
    return new Response(null, { status: 204 });
  }
}
