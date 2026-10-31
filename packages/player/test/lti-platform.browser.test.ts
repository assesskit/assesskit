// biome-ignore-all lint/style/useNamingConvention: the names of LTI messages are snake_case.
import { afterEach, describe, expect, inject, it } from "vitest";
import {
  type HttpResponse,
  ltiPlatformAuthorize,
  ltiPlatformLogin,
  type PlatformAuthorizeOptions,
  type PlatformConfig,
  type PlatformLoginOptions,
  platformEndpoints,
} from "../src/lti/index.js";
import { waitFor } from "./wait.js";

/**
 * The page that posts the id_token runs in the engines of the player. The tool's origin is a fixture server, which the
 * page reaches under its own policy, and which records the path that the form posts to.
 */

const { other, stranger } = inject("fixtures");
const TOOL = "https://tool.example.com";
const link = {
  title: "Drawing tool",
  custom: new Map([["exam", "tryout-1"]]),
  extensions: [],
  secureLaunchUrl: `${TOOL}/lti/tools/drawing`,
};
const pair = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
);
const config: PlatformConfig = {
  issuer: "https://platform.example",
  origin: "https://lti.platform.example",
  playerOrigin: "https://player.platform.example",
  assetOrigin: "https://assets.platform.example",
  keys: pair,
  hintKey: await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]),
};
const clock = { now: () => 1_700_000_000_000 };
const used = new Set<string>();

/** The platform with a tool whose redirect URI has a path of the test's own. */
function platform(path: string): { login: PlatformLoginOptions; authorize: PlatformAuthorizeOptions } {
  const tool = {
    clientId: "tool-client-1",
    deploymentId: "deployment-1",
    loginUrl: `${TOOL}/lti/login`,
    redirectUris: [`${TOOL}${path}`],
    jwksUrl: `${TOOL}/jwks`,
  };
  const login: PlatformLoginOptions = {
    config,
    clock,
    registration: async () => tool,
    check: async () => undefined,
    scoreMaximum: async () => 10,
  };
  const authorize: PlatformAuthorizeOptions = {
    config,
    clock,
    client: async () => tool,
    once: async (id) => {
      if (used.has(id)) return false;
      used.add(id);
      return true;
    },
  };
  return { login, authorize };
}

/** Makes the platform answer the authentication request of a launch with the given `state`. */
async function answer(path: string, state: string): Promise<HttpResponse> {
  const { login, authorize } = platform(path);
  const initiation = new URL(
    await ltiPlatformLogin({ session: "s1", principal: "candidate-7" }, { ref: "q1", instance: 1 }, link, login),
  );
  const parameters = new URLSearchParams([
    ["scope", "openid"],
    ["response_type", "id_token"],
    ["client_id", "tool-client-1"],
    ["redirect_uri", `${TOOL}${path}`],
    ["login_hint", initiation.searchParams.get("login_hint") ?? ""],
    ["state", state],
    ["response_mode", "form_post"],
    ["nonce", "nonce-1"],
    ["prompt", "none"],
    ["lti_message_hint", initiation.searchParams.get("lti_message_hint") ?? ""],
  ]);
  return ltiPlatformAuthorize(
    { method: "GET", url: `${platformEndpoints(config).authorization}?${parameters}`, headers: {}, body: "" },
    authorize,
  );
}

const frames: HTMLIFrameElement[] = [];
afterEach(() => {
  for (const frame of frames.splice(0)) frame.remove();
});

/**
 * Loads the page in a frame under its policy, as a meta element (a header does not reach `srcdoc`; framing is the header's
 * and the player's). The tool's origin is the fixture server's, so that the form posts to a server that records it.
 */
function load(page: HttpResponse): HTMLIFrameElement {
  const policy = (page.headers["content-security-policy"] ?? "")
    .replace(/; frame-ancestors [^;]*/u, "")
    .replaceAll(TOOL, other);
  const frame = document.createElement("iframe");
  frame.srcdoc = page.body
    .replace("<head>", `<head>\n<meta http-equiv="Content-Security-Policy" content="${policy}">`)
    .replaceAll(TOOL, other);
  frames.push(frame);
  document.body.append(frame);
  return frame;
}

/** The paths that a fixture server was asked for. */
async function requests(origin: string): Promise<string[]> {
  return (await fetch(`${origin}/__hits`, { cache: "no-store" })).json();
}

describe("the page that posts the id_token", () => {
  it("posts the form to the redirect URI of the tool by itself, under its policy", async () => {
    const path = `/launch/${crypto.randomUUID()}`;
    load(await answer(path, "state-1"));
    await waitFor(async () => expect(await requests(other)).toContain(path));
  });

  it("writes a hostile state as text in the markup, whatever the engine's parser", async () => {
    const hostile = `"><img src="${stranger}/leak" onerror="alert(1)"><script>alert(2)</script><form action="${stranger}/x">`;
    const path = `/launch/${crypto.randomUUID()}`;
    const page = await answer(path, hostile);
    const document2 = new DOMParser().parseFromString(page.body, "text/html");
    expect(document2.querySelectorAll("form")).toHaveLength(1);
    expect(document2.querySelectorAll("script")).toHaveLength(1);
    expect(document2.querySelectorAll("img")).toHaveLength(0);
    expect(document2.querySelector<HTMLInputElement>("input[name=state]")?.value).toBe(hostile);
    expect(document2.querySelector("form")?.getAttribute("action")).toBe(`${TOOL}${path}`);
    load(page);
    await waitFor(async () => expect(await requests(other)).toContain(path));
    expect(await requests(stranger)).toEqual([]);
  });

  it("writes a redirect URI with a query as text in the markup", async () => {
    const path = `/launch/${crypto.randomUUID()}?a=1&b="2"`;
    const page = await answer(path, "state-2");
    const document2 = new DOMParser().parseFromString(page.body, "text/html");
    expect(document2.querySelector("form")?.getAttribute("action")).toBe(`${TOOL}${path}`);
  });
});
