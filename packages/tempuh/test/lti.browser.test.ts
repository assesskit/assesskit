// biome-ignore-all lint/style/useNamingConvention: the names of LTI messages are snake_case.
import { afterEach, describe, expect, it } from "vitest";
import {
  createJwksCache,
  type HttpResponse,
  type LoginRecord,
  type LtiLaunchOptions,
  type LtiStore,
  ltiLaunch,
  ltiLogin,
  type PlatformRegistration,
} from "../src/lti/index.js";
import { waitFor } from "./wait.js";

/**
 * The pages of the client-side storage path run in the engines of the player. The test page plays the platform: it
 * keeps the storage of LTI Client Side OIDC 0.1 §4.1 for the origin of the tool, and the tool's page runs in a frame of it.
 */

const origin = location.origin;
const PLATFORM = "https://lms.example.edu";
const pair = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  false,
  ["sign"],
);
const registration: PlatformRegistration = {
  issuer: PLATFORM,
  clientId: "client-1",
  deploymentIds: ["deployment-1"],
  authenticationUrl: `${PLATFORM}/auth`,
  jwksUrl: "https://lms.example.edu/jwks",
  accessTokenUrl: "https://lms.example.edu/token",
  redirectUri: "https://tool.example.com/lti/launch",
  keyId: "tool-1",
  signingKey: pair.privateKey,
};
const clock = { now: () => 1_700_000_000_000 };

/** A store in memory. */
function memoryStore(): LtiStore & { readonly records: Map<string, LoginRecord> } {
  const records = new Map<string, LoginRecord>();
  return {
    records,
    put: async (state, record) => {
      records.set(state, record);
    },
    get: async (state) => records.get(state),
    delete: async (state) => records.delete(state),
  };
}

/** The tool: its registration, a store, and a cache whose key set is never fetched. */
function tool(): { options: LtiLaunchOptions; store: ReturnType<typeof memoryStore> } {
  const store = memoryStore();
  const jwks = createJwksCache({ fetch: () => Promise.reject(new Error("The pages do not fetch.")) });
  return { store, options: { registration: async () => registration, clock, store, jwks } };
}

const storages: PlatformStorage[] = [];

/** The platform's side of the storage: answers `lti.put_data` and `lti.get_data` as LTI Client Side OIDC 0.1 §4.1 does. */
class PlatformStorage {
  readonly buckets = new Map<string, Map<string, string>>();
  private readonly held: (() => void)[] = [];
  private holding = true;
  private readonly fail: boolean;
  private readonly noise: boolean;

  private readonly stop: () => void;

  constructor(listener: Window, options: { fail?: boolean; noise?: boolean } = {}) {
    this.fail = options.fail ?? false;
    this.noise = options.noise ?? false;
    const handle = (event: MessageEvent): void => this.handle(event);
    listener.addEventListener("message", handle);
    this.stop = () => listener.removeEventListener("message", handle);
    storages.push(this);
  }

  /** Stops answering. */
  dispose(): void {
    this.stop();
  }

  /** Returns what the platform stores for the tool under a key. */
  get(key: string): string | undefined {
    return this.buckets.get(origin)?.get(key);
  }

  /** Stores a value for the tool, as the page of the login did. */
  put(key: string, value: string): void {
    this.buckets.set(origin, (this.buckets.get(origin) ?? new Map()).set(key, value));
  }

  /** Lets the answers go: they wait until the test has attached its listeners to the frame. */
  release(): void {
    this.holding = false;
    for (const answer of this.held.splice(0)) answer();
  }

  private handle(event: MessageEvent): void {
    const data: unknown = event.data;
    if (typeof data !== "object" || data === null || !("subject" in data) || !("message_id" in data)) return;
    const { subject, message_id: messageId } = data;
    const key = "key" in data && typeof data.key === "string" ? data.key : "";
    if (subject !== "lti.put_data" && subject !== "lti.get_data") return;
    if (subject === "lti.put_data" && "value" in data && typeof data.value === "string") this.put(key, data.value);
    const value = this.get(key);
    const response = this.fail
      ? { subject: `${subject}.response`, message_id: messageId, error: { code: "failed", message: "Refused." } }
      : subject === "lti.get_data" && value === undefined
        ? {
            subject: "lti.get_data.response",
            message_id: messageId,
            error: { code: "key_not_found", message: "There is no value stored for this key" },
          }
        : { subject: `${subject}.response`, message_id: messageId, key, value };
    const target = { targetOrigin: event.origin };
    const reply = (): void => {
      if (this.noise) event.source?.postMessage({ subject: `${subject}.response`, message_id: "not-sent" }, target);
      event.source?.postMessage(response, target);
    };
    if (this.holding) this.held.push(reply);
    else reply();
  }
}

const frames: HTMLIFrameElement[] = [];
afterEach(() => {
  for (const frame of frames.splice(0)) frame.remove();
  for (const storage of storages.splice(0)) storage.dispose();
});

// The page navigates to the authentication request. The test sends it to a document of its own, so that every engine
// loads it and lets the test read where the frame went; the query of the request becomes the fragment.
const AUTHENTICATION_DOCUMENT = URL.createObjectURL(new Blob(["<title>authentication</title>"], { type: "text/html" }));

/**
 * Loads a page of the tool in a frame, with its CSP as a meta element (a header does not reach `srcdoc`). The platform's
 * origin in the page is the origin of the test page, which is served over http: the page then talks to the test page.
 */
async function load(response: HttpResponse, name = ""): Promise<HTMLIFrameElement> {
  const policy = response.headers["content-security-policy"] ?? "";
  const frame = document.createElement("iframe");
  frame.name = name;
  const meta = `<head>\n<meta http-equiv="Content-Security-Policy" content="${policy}">`;
  frame.srcdoc = response.body
    .replace("<head>", meta)
    .replaceAll(`${PLATFORM}/auth?`, `${AUTHENTICATION_DOCUMENT}#`)
    .replaceAll(PLATFORM, origin);
  frames.push(frame);
  const loaded = new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
  document.body.append(frame);
  await loaded;
  return frame;
}

/** The storage frame of a platform, a child of the test page with a name. */
async function storageFrame(name: string): Promise<Window> {
  const frame = document.createElement("iframe");
  frame.name = name;
  frame.srcdoc = "<!doctype html><title>storage</title>";
  frames.push(frame);
  const loaded = new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
  document.body.append(frame);
  await loaded;
  if (!frame.contentWindow) throw new Error("The storage frame has no window.");
  return frame.contentWindow;
}

/** Starts a login with a storage target and returns the page, with the `state` and `nonce` the tool made. */
async function login(
  storageTarget: string,
  ctx = tool(),
): Promise<{ page: HttpResponse; state: string; nonce: string; ctx: ReturnType<typeof tool> }> {
  const initiation = new URLSearchParams([
    ["iss", registration.issuer],
    ["login_hint", "24400320"],
    ["target_link_uri", "https://tool.example.com/lti/t"],
    ["lti_storage_target", storageTarget],
  ]);
  const page = await ltiLogin(
    { method: "GET", url: `https://tool.example.com/lti/login?${initiation}`, headers: {}, body: "" },
    ctx.options,
  );
  const [[state = "", record] = []] = [...ctx.store.records];
  return { page, state, nonce: record?.nonce ?? "", ctx };
}

describe("the page that stores state and nonce", () => {
  it("[T121] stores both in the platform's parent frame and then redirects to the authentication request", async () => {
    const storage = new PlatformStorage(window);
    const { page, state, nonce } = await login("_parent");
    const frame = await load(page);
    storage.release();
    await waitFor(() => expect(frame.contentWindow?.location.href).toContain(AUTHENTICATION_DOCUMENT));
    expect(storage.get(`state_${state}`)).toBe(state);
    expect(storage.get(`nonce_${nonce}`)).toBe(nonce);
    const request = new URLSearchParams(new URL(frame.contentWindow?.location.href ?? "").hash.slice(1));
    expect(request.get("state")).toBe(state);
    expect(request.get("nonce")).toBe(nonce);
    expect(request.get("response_mode")).toBe("form_post");
  });

  it("[T121] stores both in a frame of the platform that has the given name", async () => {
    const storage = new PlatformStorage(await storageFrame("lti-storage"));
    const { page, state, nonce } = await login("lti-storage");
    const frame = await load(page);
    storage.release();
    await waitFor(() => expect(frame.contentWindow?.location.href).toContain(AUTHENTICATION_DOCUMENT));
    expect(storage.get(`state_${state}`)).toBe(state);
    expect(storage.get(`nonce_${nonce}`)).toBe(nonce);
  });

  it("[T121] ignores an answer that is not to its message", async () => {
    const storage = new PlatformStorage(window, { noise: true });
    const { page } = await login("_parent");
    const frame = await load(page);
    storage.release();
    await waitFor(() => expect(frame.contentWindow?.location.href).toContain(AUTHENTICATION_DOCUMENT));
  });

  it("[T121] tells the user and stays when the platform answers with an error", async () => {
    const storage = new PlatformStorage(window, { fail: true });
    const { page } = await login("_parent");
    const frame = await load(page);
    storage.release();
    await waitFor(() => expect(frame.contentDocument?.getElementById("failure")?.hidden).toBe(false));
    expect(frame.contentWindow?.location.href).toBe("about:srcdoc");
  });

  it("[T121] tells the user at once when the platform has no frame of the given name", async () => {
    const { page } = await login("no-such-frame");
    const frame = await load(page);
    expect(frame.contentDocument?.getElementById("failure")?.hidden).toBe(false);
  });
});

describe("the verification page", () => {
  /** Logs in and returns the verification page that the launch answers the platform's post with. */
  async function verification(target: string): Promise<{ page: HttpResponse; state: string; nonce: string }> {
    const { state, nonce, ctx } = await login(target);
    const body = new URLSearchParams([
      ["id_token", "header.payload.signature"],
      ["state", state],
    ]).toString();
    const page = await ltiLaunch(
      {
        method: "POST",
        url: registration.redirectUri,
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      },
      ctx.options,
    );
    if (!("status" in page)) throw new Error("The launch answered with a launch, not a page.");
    return { page, state, nonce };
  }

  /** Listens in the frame for the submit that the page ends with, and holds the form it would post. */
  function submission(frame: HTMLIFrameElement): { submitted: () => FormData | undefined } {
    let form: FormData | undefined;
    frame.contentDocument?.addEventListener("submit", (event) => {
      event.preventDefault();
      const element = frame.contentDocument?.querySelector("form");
      if (element) form = new FormData(element);
    });
    return { submitted: () => form };
  }

  it("[T121] fetches state and nonce from the platform and posts them with the token", async () => {
    const storage = new PlatformStorage(window);
    const { page, state, nonce } = await verification("_parent");
    storage.put(`state_${state}`, state);
    storage.put(`nonce_${nonce}`, nonce);
    const frame = await load(page);
    const { submitted } = submission(frame);
    storage.release();
    await waitFor(() => expect(submitted()).toBeDefined());
    expect(Object.fromEntries(submitted() ?? [])).toEqual({
      id_token: "header.payload.signature",
      state,
      stored_state: state,
      stored_nonce: nonce,
    });
    expect(frame.contentDocument?.querySelector("form")?.getAttribute("action")).toBe(registration.redirectUri);
  });

  it("[T121] posts nothing and tells the user when the platform does not hold the values", async () => {
    const storage = new PlatformStorage(window);
    const { page } = await verification("_parent");
    const frame = await load(page);
    const { submitted } = submission(frame);
    storage.release();
    await waitFor(() => expect(frame.contentDocument?.getElementById("failure")?.hidden).toBe(false));
    expect(submitted()).toBeUndefined();
  });

  it("[T121] posts nothing when the platform has no frame of the given name", async () => {
    const { page } = await verification("no-such-frame");
    const frame = await load(page);
    const { submitted } = submission(frame);
    expect(frame.contentDocument?.getElementById("failure")?.hidden).toBe(false);
    expect(submitted()).toBeUndefined();
  });
});
