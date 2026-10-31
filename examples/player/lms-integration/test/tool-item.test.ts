import { AccessError } from "@assesskit/player";
import type { ToolScore } from "@assesskit/player/server";
import { DataError } from "@assesskit/runtime/errors";
import { readLtiLink } from "@assesskit/runtime/package";
import { LtiError } from "@interopkit/tool-integration";
import type { AgsScore } from "@interopkit/tool-integration/platform";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { launchHooks, onToolScore, parseResource, resourceOf, toolLaunch, toToolScore } from "../src/index.ts";
import { examFiles } from "./exam.ts";
import { CANDIDATE, DRAW } from "./rig.ts";

const AT = "2023-11-14T22:13:20.000Z";
const score = (change: Partial<AgsScore> = {}): AgsScore => ({
  userId: "u1",
  scoreGiven: 6,
  scoreMaximum: 10,
  activityProgress: "Completed",
  gradingProgress: "FullyGraded",
  timestamp: AT,
  timestampMs: Date.parse(AT),
  ...change,
});

const link = (inner: string) =>
  readLtiLink(
    `<cartridge_basiclti_link xmlns="http://www.imsglobal.org/xsd/imslticc_v1p0" xmlns:blti="http://www.imsglobal.org/xsd/imsbasiclti_v1p0" xmlns:lticp="http://www.imsglobal.org/xsd/imslticp_v1p0"><blti:title>Tool</blti:title>${inner}</cartridge_basiclti_link>`,
  );

describe("resourceOf", () => {
  it("names the session and the item instance, and gives the same text for the same launch", () => {
    expect(resourceOf("exam-1", { ref: "draw", instance: 2 })).toBe('["exam-1","draw",2]');
    expect(resourceOf("exam-1", DRAW)).toBe(resourceOf("exam-1", { ...DRAW }));
  });

  it("reads back what it wrote, for any session and item", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        fc.integer({ min: 1, max: 1000 }),
        (session, ref, instance) => {
          expect(parseResource(resourceOf(session, { ref, instance }))).toEqual({ session, item: { ref, instance } });
        },
      ),
      { seed: 20_261_101, numRuns: 100 },
    );
  });

  it("refuses text that is not the resource of an item instance", () => {
    for (const text of [
      "",
      "not json",
      "{}",
      "[]",
      '["s","r"]',
      '["s","r","1"]',
      '[1,"r",1]',
      '["s","r",1,2]',
      "null",
    ]) {
      expect(() => parseResource(text), text).toThrow(DataError);
    }
  });
});

describe("toolLaunch", () => {
  const draw = readLtiLink(new TextEncoder().encode(examFiles()["lti/draw.xml"]));

  it("builds the launch of an item from its link: the secure launch URL, the title, the custom properties and the maximum", () => {
    expect(toolLaunch(CANDIDATE, DRAW, draw, 10)).toEqual({
      principal: CANDIDATE.principal,
      resource: resourceOf(CANDIDATE.session, DRAW),
      target: "https://tool.example.com/lti/tools/drawing",
      title: "Drawing tool",
      custom: { exam: "tryout-1" },
      scoreMaximum: 10,
    });
  });

  it("prefers the secure launch URL over the launch URL, and refuses a link that names only a vendor", () => {
    const both = link(
      "<blti:launch_url>http://tool.example/a</blti:launch_url><blti:secure_launch_url>https://tool.example/a</blti:secure_launch_url>",
    );
    expect(toolLaunch(CANDIDATE, DRAW, both, 5).target).toBe("https://tool.example/a");
    const vendor = link("<blti:vendor><lticp:code>IMSGlobal.org</lticp:code></blti:vendor>");
    expect(() => toolLaunch(CANDIDATE, DRAW, vendor, 5)).toThrow(DataError);
  });
});

describe("launchHooks", () => {
  const bound: string[] = [];
  const host = {
    check: async (caller: { session: string; principal: string }) => {
      bound.push(`${caller.session} ${caller.principal}`);
      if (caller.principal !== CANDIDATE.principal) {
        throw new AccessError("The session does not belong to the caller.", "not-bound");
      }
    },
  };
  const launch = toolLaunch(CANDIDATE, DRAW, readLtiLink(new TextEncoder().encode(examFiles()["lti/draw.xml"])), 10);
  const hooks = launchHooks(host);

  it("confirms with the session host that the session is the principal's, before anything is signed", async () => {
    await hooks.check(launch);
    expect(bound.at(-1)).toBe(`${CANDIDATE.session} ${CANDIDATE.principal}`);
  });

  it("lets the AccessError of the session host through as the host's own", async () => {
    await expect(hooks.check({ ...launch, principal: "someone-else" })).rejects.toBeInstanceOf(AccessError);
  });

  it("accepts the launch of a hint whose session is the principal's, and refuses another with the reason caller-mismatch", async () => {
    await hooks.checkLaunch(launch);
    const refused = await hooks.checkLaunch({ ...launch, principal: "someone-else" }).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(LtiError);
    expect(refused).toMatchObject({ reason: "caller-mismatch", status: 403 });
  });

  it("passes on a failure of the session host that is not a refusal", async () => {
    const failing = launchHooks({
      check: async () => {
        throw new Error("The store is down.");
      },
    });
    await expect(failing.checkLaunch(launch)).rejects.toThrow("The store is down.");
    await expect(failing.check(launch)).rejects.toThrow("The store is down.");
  });

  it("refuses a resource that is not an item instance, with a DataError", async () => {
    await expect(hooks.check({ ...launch, resource: "nonsense" })).rejects.toThrow(DataError);
    await expect(hooks.checkLaunch({ ...launch, resource: "nonsense" })).rejects.toThrow(DataError);
  });
});

describe("toToolScore", () => {
  it("makes only a fully graded score final, and keeps the time", () => {
    expect(toToolScore(score())).toEqual({ scoreGiven: 6, scoreMaximum: 10, final: true, timestampMs: Date.parse(AT) });
    for (const gradingProgress of ["Pending", "PendingManual", "Failed", "NotReady"] as const) {
      expect(toToolScore(score({ gradingProgress })).final, gradingProgress).toBe(false);
    }
  });

  it("leaves out the parts that the tool did not give", () => {
    const { scoreGiven: _given, scoreMaximum: _maximum, ...bare } = score();
    expect(toToolScore(bare)).toEqual({ final: true, timestampMs: Date.parse(AT) });
  });
});

describe("onToolScore", () => {
  it("reads the resource of the line item and gives the session, the item and the score to the intake", async () => {
    const received: unknown[][] = [];
    const onScore = onToolScore({
      onScore: async (...args) => void received.push(args),
    });
    const signal = new AbortController().signal;
    await onScore(resourceOf("exam-1", DRAW), score(), { signal });
    const expected: ToolScore = toToolScore(score());
    expect(received).toEqual([["exam-1", DRAW, expected, { signal }]]);
    await expect(onScore("nonsense", score())).rejects.toThrow(DataError);
  });
});
