import { single } from "@luthfanwakan/olah/values";
import { afterEach, describe, expect, inject, it } from "vitest";
import { commands } from "vitest/browser";
import { createRemoteSession, type Transport } from "../src/client/index.js";
import { AccessError, DataError, ServiceError } from "../src/index.js";
import { mountDelivery } from "../src/player/index.js";
import type { SessionClient, ViewEnvelope } from "../src/protocol/index.js";
import { PLAYER_CSS } from "./css-fixture.js";
import { waitFor } from "./wait.js";

const origin = inject("exam");
const player = new CSSStyleSheet();
player.replaceSync(PLAYER_CSS);
const SECOND = 1000;
const HOUR = 3600 * SECOND;

/** A session identifier that no other test or browser uses, since the three engines share the server. */
const fresh = (): string => `e2e-${crypto.randomUUID()}`;

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

/** A candidate of the exam server: what a host's page does with `fetch`, and the status of each answer. */
function candidate(session: string, principal = "alice", exam = "plain") {
  const headers = (more: Record<string, string> = {}): Record<string, string> => ({
    "content-type": "application/json",
    "x-session": session,
    "x-principal": principal,
    "x-exam": exam,
    ...more,
  });
  const post = (path: string, body: unknown = {}, more: Record<string, string> = {}): Promise<Response> =>
    fetch(`${origin}/exam/${path}`, { method: "POST", headers: headers(more), body: JSON.stringify(body) });
  /** Maps the status of the server to the errors that the client tells apart. */
  const read = async (response: Response): Promise<unknown> => {
    const body: unknown = await response.json();
    const message = (body as { message?: string }).message ?? "The host refused.";
    if (response.status === 403) throw new AccessError(message, "not-bound");
    if (response.status === 400) throw new DataError(message);
    if (!response.ok) throw new ServiceError(message, response.status, message);
    return body;
  };
  const transport =
    (more: () => Record<string, string> = () => ({})): Transport =>
    async (envelope) =>
      (await read(await post("handle", envelope, more()))) as ViewEnvelope;
  return { post, read, headers, transport };
}

type Candidate = ReturnType<typeof candidate>;

const start = async (who: Candidate): Promise<ViewEnvelope> =>
  (await who.read(await who.post("start", { seed: 1 }))) as ViewEnvelope;
const Q1 = { ref: "q1", instance: 1 };
const move = (envelope: number, to: unknown): { seq: number; action: unknown } => ({
  seq: envelope,
  action: { type: "move", to },
});

describe("exam mode over HTTP", () => {
  it("[T67] gives 403 to a request for the session of another candidate, and to a second start", async () => {
    const session = fresh();
    const alice = candidate(session, "alice");
    const bob = candidate(session, "bob");
    await start(alice);
    expect((await bob.post("handle", move(1, "next"))).status).toBe(403);
    expect((await bob.post("view")).status).toBe(403);
    expect((await bob.post("start", { seed: 1 })).status).toBe(403);
    expect((await alice.post("start", { seed: 1 })).status).toBe(403);
    const answered = (await alice.read(await alice.post("handle", move(1, "next")))) as ViewEnvelope;
    expect(answered.seq).toBe(1);
    expect((await candidate(`nobody-${session}`, "alice").post("handle", move(1, "next"))).status).toBe(403);
  });

  it("[T67] refuses suspend from the candidate with 400, and lets the proctor suspend", async () => {
    const session = fresh();
    const alice = candidate(session);
    const first = await start(alice);
    expect(JSON.stringify(first.view)).not.toContain('"suspend"');
    const refused = await alice.post("handle", { seq: 1, action: { type: "suspend" } });
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { message: string }).message).toContain('may not send the action "suspend"');
    expect(await (await alice.post("proctor", { type: "suspend" })).json()).toEqual({ ok: true });
    const during = (await alice.read(
      await alice.post("handle", { seq: 1, action: { type: "move", to: "next" } }),
    )) as ViewEnvelope;
    expect(during.refusal?.code).toBe("suspended");
    const reloaded = (await alice.read(await alice.post("view"))) as ViewEnvelope;
    expect((reloaded.view as { status: string }).status).toBe("suspended");
    expect((await alice.post("proctor", { type: "resume" })).ok).toBe(true);
  });

  it("[T67] saves again when a competing write comes first, and fails with 409 when three retries do not suffice", async () => {
    const session = fresh();
    const alice = candidate(session);
    await start(alice);
    await alice.post("conflicts?times=3");
    const retried = await alice.post("handle", move(1, "next"));
    expect(retried.status).toBe(200);
    await alice.post("conflicts?times=4");
    const failed = await alice.post("handle", move(2, "next"));
    expect(failed.status).toBe(409);
    expect(((await failed.json()) as { name: string }).name).toBe("ServiceError");
    const again = await alice.post("handle", move(2, "next"));
    expect(again.status).toBe(200);
  });

  it("[T66] schedules the time-out, applies it when the job fires, and refuses the answer that comes after", async () => {
    const session = fresh();
    const alice = candidate(session, "alice", "timed");
    const before = Date.now();
    await start(alice);
    const jobs = (await (await fetch(`${origin}/exam/jobs`, { headers: alice.headers() })).json()) as [
      string,
      number,
    ][];
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.[1]).toBeGreaterThanOrEqual(before + 600 * SECOND);
    expect(jobs[0]?.[1]).toBeLessThan(Date.now() + 600 * SECOND + SECOND);
    const late = { "x-offset": String(601 * SECOND) };
    expect(await (await alice.post("time", {}, late)).json()).toEqual({ ok: true });
    const answer = {
      type: "set-responses",
      item: Q1,
      responses: [
        ["RESPONSE", { cardinality: "single", baseType: "identifier", value: { base: { identifier: "A" } } }],
      ],
    };
    const reply = (await alice.read(await alice.post("handle", { seq: 1, action: answer }, late))) as ViewEnvelope;
    expect(reply.refusal?.code).toBe("time-over");
  });

  it("[T73] serves the files of a prefix with the headers of the gate, and refuses what is not allowed", async () => {
    const session = fresh();
    const alice = candidate(session);
    const first = await start(alice);
    const base = first.assets["items/q1/"] ?? "";
    expect(base.startsWith(`${origin}/g/`)).toBe(true);
    const image = await fetch(`${base}items/q1/images/map.png`);
    expect(image.status).toBe(200);
    expect(image.headers.get("referrer-policy")).toBe("no-referrer");
    expect(image.headers.get("x-content-type-options")).toBe("nosniff");
    expect(image.headers.get("content-type")).toBe("image/png");
    const status = async (url: string, headers: Record<string, string> = {}): Promise<number> =>
      (await fetch(url, { headers })).status;
    expect(await status(`${base}items/q2/item.xml`)).toBe(403);
    expect(await status(`${base}imsmanifest.xml`)).toBe(403);
    expect(await status(`${base}items/q1/../../imsmanifest.xml`)).toBe(403);
    expect(await status(`${base}items/q1/item.xml`)).toBe(404);
    expect(await status(`${base}items/q1/notes.xml`)).toBe(404);
    expect(await status(`${base}items/q1/none.png`)).toBe(404);
    const token = base.split("/")[4] ?? "";
    const [payload = "", mac = ""] = token.split(".");
    expect(
      await status(`${origin}/g/${payload}.${mac.startsWith("A") ? "B" : "A"}${mac.slice(1)}/items/q1/images/map.png`),
    ).toBe(403);
    expect(await status(`${base}items/q1/images/map.png`, { "x-offset": String(HOUR + SECOND) })).toBe(403);
    const forgery = btoa(
      JSON.stringify({ use: "asset", session: "other", prefix: "", exp: Date.now() + HOUR }),
    ).replaceAll("=", "");
    expect(await status(`${origin}/g/${forgery}.${mac}/items/q1/images/map.png`)).toBe(403);
  });

  it("[T72] stores an upload through the host, and plays it back with a token that expires after five minutes", async () => {
    const session = fresh();
    const alice = candidate(session);
    await start(alice);
    const uploaded = await fetch(`${origin}/exam/upload`, {
      method: "POST",
      headers: alice.headers({ "content-type": "application/octet-stream", "x-mime": "audio/wav" }),
      body: new Uint8Array([82, 73, 70, 70]),
    });
    const file = (await uploaded.json()) as { reference: string; mimeType: string };
    expect(file.mimeType).toBe("audio/wav");
    const { url } = (await (await alice.post("file-url", file)).json()) as { url: string };
    const played = await fetch(url);
    expect(played.status).toBe(200);
    expect(played.headers.get("content-security-policy")).toBe("sandbox");
    expect(played.headers.get("content-type")).toBe("audio/wav");
    expect([...new Uint8Array(await played.arrayBuffer())]).toEqual([82, 73, 70, 70]);
    expect((await fetch(url, { headers: { "x-offset": String(301 * SECOND) } })).status).toBe(403);
  });
});

/** Mounts the player over the exam server, as a host's page does. */
async function mountExam(session: string, principal = "alice") {
  const who = candidate(session, principal);
  const initial = await start(who);
  const client: SessionClient = createRemoteSession(who.transport(), initial);
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  mountDelivery(host, {
    client,
    files: {
      upload: async () => ({ reference: "f", mimeType: "x" }),
      read: async () => new Uint8Array(),
      url: () => "",
    },
    // The exam server is the asset origin of the gate, and the static files of the frame come from another here.
    origins: [origin],
    staticUrl: `${inject("fixtures").asset}/static/`,
    stylesheet: player,
    fetch: (url, init) => fetch(url, init),
  });
  return { who, client, ui: host.shadowRoot as ShadowRoot, host };
}

describe("the player over the exam server", () => {
  it("[T73] loads a module with a relative dependency and a stylesheet with a relative url() under their prefixes", async () => {
    const messages: { probe: string; color: string; image: string; state: string | null }[] = [];
    const listen = (event: MessageEvent): void => {
      if ((event.data as { probe?: string } | null)?.probe === "instance") messages.push(event.data);
    };
    window.addEventListener("message", listen);
    try {
      const { client, ui } = await mountExam(fresh());
      await client.dispatch({ type: "move", to: { ref: "q3", instance: 1 } });
      await waitFor(() => expect(messages).toHaveLength(1), { timeout: 20_000 });
      expect(messages[0]?.color).toBe("rgb(18, 52, 86)");
      expect(messages[0]?.image).toContain("/items/q3/images/dot.svg");
      expect(messages[0]?.image).toContain(`${origin}/g/`);
      expect(ui.querySelector(".tempuh-heading")?.textContent).toBe("Item q3");
    } finally {
      window.removeEventListener("message", listen);
    }
  });

  it("[T67] stores what a portable custom interaction gives, with its state, and restores it for another page", async () => {
    const session = fresh();
    const { client, who } = await mountExam(session);
    await client.dispatch({ type: "move", to: { ref: "q3", instance: 1 } });
    await waitFor(async () => commands.clickInFrame("Press the button", "#press"), { timeout: 20_000 });
    await waitFor(() => expect(client.view.current?.responses.get("PCI")).toEqual(single("integer", 1)), {
      timeout: 15_000,
    });
    expect(client.view.current?.pci.get("PCI")?.state).toBe('{"count":1}');
    const view = (await who.read(await who.post("view"))) as ViewEnvelope;
    const second = createRemoteSession(who.transport(), view);
    expect(second.view.current?.responses.get("PCI")).toEqual(single("integer", 1));
    expect(second.view.current?.pci.get("PCI")?.state).toBe('{"count":1}');
    second.close();
  });

  it("[T61] shows the break that the proctor made, in a candidate's page that was open before it", async () => {
    const session = fresh();
    const { who, ui } = await mountExam(session);
    await waitFor(() => expect(ui.querySelector(".tempuh-heading")?.textContent).toBe("Item q1"));
    await who.post("proctor", { type: "suspend" });
    const skip = [...ui.querySelectorAll("button")].find((button) => button.textContent === "Skip question");
    skip?.click();
    await waitFor(() =>
      expect(ui.querySelector(".tempuh-status")?.textContent).toBe(
        "The test is paused, so this action is not possible.",
      ),
    );
    expect(ui.querySelector(".tempuh-notice")?.textContent).toContain("The test is paused");
    expect([...ui.querySelectorAll(".tempuh-actions button")]).toEqual([]);
  });
});
