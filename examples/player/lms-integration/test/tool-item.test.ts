import { AccessError } from "@assesskit/player";
import { DataError } from "@assesskit/runtime/errors";
import { readLtiLink } from "@assesskit/runtime/package";
import type { MessageInput, ReceivedScore } from "@interopkit/tool-integration/platform";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  checkBrowser,
  checkSession,
  itemId,
  parseItemId,
  proctoringLaunch,
  toolLaunch,
  toToolScore,
} from "../src/index.ts";
import { examFiles } from "./exam.ts";
import { DRAWING } from "./fake-tool.ts";
import { CANDIDATE, DRAW } from "./rig.ts";

const AT = "2023-11-14T22:13:20.000Z";
const score = (change: Partial<ReceivedScore> = {}): ReceivedScore => ({
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

describe("itemId", () => {
  it("names the item instance, and gives the same text for the same item", () => {
    expect(itemId({ ref: "draw", instance: 2 })).toBe('["draw",2]');
    expect(itemId(DRAW)).toBe(itemId({ ...DRAW }));
  });

  it("reads back what it wrote, for any item", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.integer({ min: 1, max: 1000 }), (ref, instance) => {
        expect(parseItemId(itemId({ ref, instance }))).toEqual({ ref, instance });
      }),
      { seed: 20_261_101, numRuns: 100 },
    );
  });

  it("reads text that is not the identifier of an item instance as no item", () => {
    for (const text of ["", "not json", "{}", "[]", '["r"]', '["r","1"]', "[1,1]", '["r",1,2]', "null"]) {
      expect(parseItemId(text), text).toBeUndefined();
    }
  });
});

describe("toolLaunch", () => {
  const draw = readLtiLink(new TextEncoder().encode(examFiles()["lti/draw.xml"]));

  it("builds the launch of an item from its link: the session is the context, the item the resource link and the line item", () => {
    const expected: MessageInput = {
      messageType: "LtiResourceLinkRequest",
      clientId: DRAWING.clientId,
      deploymentId: DRAWING.deploymentId,
      targetLinkUri: "https://tool.example.com/lti/tools/drawing",
      user: { subject: CANDIDATE.principal },
      roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Learner"],
      context: { id: CANDIDATE.session },
      resourceLink: { id: itemId(DRAW), title: "Drawing tool" },
      custom: { exam: "tryout-1" },
      services: { grades: { lineItemId: itemId(DRAW), container: false } },
    };
    expect(toolLaunch(CANDIDATE, DRAW, draw, DRAWING)).toEqual(expected);
  });

  it("prefers the secure launch URL over the launch URL, and refuses a link that names only a vendor", () => {
    const both = link(
      "<blti:launch_url>http://tool.example/a</blti:launch_url><blti:secure_launch_url>https://tool.example/a</blti:secure_launch_url>",
    );
    expect(toolLaunch(CANDIDATE, DRAW, both, DRAWING).targetLinkUri).toBe("https://tool.example/a");
    const vendor = link("<blti:vendor><lticp:code>IMSGlobal.org</lticp:code></blti:vendor>");
    expect(() => toolLaunch(CANDIDATE, DRAW, vendor, DRAWING)).toThrow(DataError);
  });
});

describe("checkSession", () => {
  const bound: string[] = [];
  const host = {
    check: async (caller: { session: string; principal: string }) => {
      bound.push(`${caller.session} ${caller.principal}`);
      if (caller.session !== CANDIDATE.session) {
        throw new AccessError("The session does not belong to the caller.", "not-bound");
      }
    },
  };
  const draw = readLtiLink(new TextEncoder().encode(examFiles()["lti/draw.xml"]));
  const launch = toolLaunch(CANDIDATE, DRAW, draw, DRAWING);
  const check = checkSession(host, CANDIDATE.principal);

  it("confirms with the session host that the session of the context is the user's, before anything is signed", async () => {
    await check(launch);
    expect(bound.at(-1)).toBe(`${CANDIDATE.session} ${CANDIDATE.principal}`);
  });

  it("lets the AccessError of the session host through as the host's own", async () => {
    await expect(check({ ...launch, context: { id: "another-session" } })).rejects.toBeInstanceOf(AccessError);
  });

  it("refuses a message for another user than the browser's, and an anonymous one, without asking the session host", async () => {
    const before = bound.length;
    await expect(check({ ...launch, user: { subject: "someone-else" } })).rejects.toBeInstanceOf(AccessError);
    await expect(check({ ...launch, user: {} })).rejects.toBeInstanceOf(AccessError);
    expect(bound).toHaveLength(before);
  });

  it("passes on a failure of the session host that is not a refusal", async () => {
    const failing = checkSession(
      {
        check: async () => {
          throw new Error("The store is down.");
        },
      },
      CANDIDATE.principal,
    );
    await expect(failing(launch)).rejects.toThrow("The store is down.");
  });

  it("refuses a launch of an item without a context, with a DataError", async () => {
    const { context: _context, ...withoutContext } = launch;
    await expect(check(withoutContext)).rejects.toThrow(DataError);
  });

  it("asks the session host nothing for a Start Proctoring message, which comes before the session", async () => {
    const before = bound.length;
    const message = proctoringLaunch(
      CANDIDATE,
      { ...DRAWING, targetLinkUri: DRAWING.launchUrl },
      { id: "exam", attemptNumber: 1 },
      "https://player.platform.example/proctoring/start",
    );
    await expect(check(message)).resolves.toBeUndefined();
    await expect(checkSession(host, "someone-else")(message)).rejects.toBeInstanceOf(AccessError);
    expect(bound).toHaveLength(before);
  });
});

describe("checkBrowser", () => {
  it("accepts the launch of the browser's own user, and refuses any other user and an anonymous launch", async () => {
    const check = checkBrowser("candidate-1");
    const launch = { clientId: DRAWING.clientId, deploymentId: DRAWING.deploymentId };
    expect(await check({ ...launch, principal: "candidate-1" })).toBe(true);
    expect(await check({ ...launch, principal: "candidate-2" })).toBe(false);
    expect(await check(launch)).toBe(false);
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
