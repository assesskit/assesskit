import { ASI_NAMESPACE, readAsi } from "@assesskit/runtime/asi";
import type { CandidateView } from "@assesskit/runtime/delivery";
import { readPnp } from "@assesskit/runtime/pnp";
import { buildSingle } from "@assesskit/runtime/values";
import { afterEach, describe, expect, inject, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { createRemoteSession, type Transport } from "../src/client/index.js";
import { createLocalSession } from "../src/client/local/index.js";
import { ID_MESSAGES } from "../src/messages/id/index.js";
import type { Messages } from "../src/messages/index.js";
import { type ItemMountOptions, mountItem } from "../src/player/index.js";
import { deepActiveElement, HOST_SHADOW_RULE } from "../src/player/internal.js";
import type { SessionClient } from "../src/protocol/index.js";
import { PLAYER_CSS } from "./css-fixture.js";
import { examHost, fakeClock, pciFiles } from "./exam-fixture.js";
import { NO_RECORDING } from "./files-fixture.js";
import { boxOf, clicksDuring } from "./layout-fixture.js";
import { axeViolations } from "./renderer-fixture.js";
import { waitFor } from "./wait.js";

const PNP_NAMESPACE = "http://www.imsglobal.org/xsd/qti/qtiv3p0/imsafa3p0pnp_v1p0";
const player = new CSSStyleSheet();
player.replaceSync(PLAYER_CSS);

const page = document.createElement("main");
document.body.append(page);
const hosts: HTMLElement[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const host of hosts.splice(0)) host.remove();
});

/** An item of a lesson: a choice with one correct answer, and a modal feedback for it. */
const lessonItem = (id: string, extra = ""): string => `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="${ASI_NAMESPACE}" identifier="${id}" title="Lesson ${id}" adaptive="false" time-dependent="false">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier">
    <qti-correct-response><qti-value>B</qti-value></qti-correct-response>
  </qti-response-declaration>
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"><qti-default-value><qti-value>0</qti-value></qti-default-value></qti-outcome-declaration>
  <qti-outcome-declaration identifier="FEEDBACK" cardinality="single" base-type="identifier"/>
  <qti-item-body>
    <p>Look at the numbers of ${id}.</p>
    <qti-choice-interaction response-identifier="RESPONSE" shuffle="false" max-choices="1">
      <qti-prompt>Which is larger?</qti-prompt>
      <qti-simple-choice identifier="A">3</qti-simple-choice>
      <qti-simple-choice identifier="B">7</qti-simple-choice>
    </qti-choice-interaction>
  </qti-item-body>
  <qti-response-processing>
    <qti-response-condition>
      <qti-response-if>
        <qti-match><qti-variable identifier="RESPONSE"/><qti-correct identifier="RESPONSE"/></qti-match>
        <qti-set-outcome-value identifier="SCORE"><qti-base-value base-type="float">1</qti-base-value></qti-set-outcome-value>
        <qti-set-outcome-value identifier="FEEDBACK"><qti-base-value base-type="identifier">right</qti-base-value></qti-set-outcome-value>
      </qti-response-if>
    </qti-response-condition>
  </qti-response-processing>
  <qti-modal-feedback outcome-identifier="FEEDBACK" identifier="right" show-hide="show">
    <qti-content-body><p>Well done, 7 is larger.</p></qti-content-body>
  </qti-modal-feedback>
  ${extra}
</qti-assessment-item>`;

const files = {
  upload: async () => ({ reference: "f", mimeType: "image/png" }),
  read: async () => new Uint8Array(),
  url: () => "",
  ...NO_RECORDING,
};
const fetcher = async () => ({ ok: false, status: 404, text: async () => "" });

/** A session client with its own `dispatch`: the view and the documents stay the other's, live. */
const withDispatch = (client: SessionClient, dispatch: SessionClient["dispatch"]): SessionClient =>
  Object.create(client, { dispatch: { value: dispatch } });

/** What a test mounts for one item of a lesson. */
interface Embed {
  readonly host: HTMLElement;
  readonly ui: ShadowRoot;
  readonly client: SessionClient;
  readonly mounted: ReturnType<typeof mountItem>;
}

const clock = fakeClock();

/** Mounts an item of the lesson page, on a session of its own, as a lesson mounts each of its items. */
async function embed(
  id: string,
  options: {
    readonly extra?: string;
    readonly profile?: string;
    readonly wrap?: (client: SessionClient) => SessionClient;
    readonly language?: string;
    /** The catalogs of the languages the host shows, by tag. */
    readonly messages?: Readonly<Record<string, Partial<Messages>>>;
  } = {},
): Promise<Embed> {
  const parsed = readAsi(lessonItem(id, options.extra));
  if (parsed.kind !== "item") throw new Error("The fixture is not an item.");
  const pnp = options.profile === undefined ? undefined : readPnp(options.profile);
  if (pnp !== undefined && !("supports" in pnp)) throw new Error("The fixture profile must be one profile.");
  const saved = new Map<string, string>();
  const client = await createLocalSession({
    definition: { kind: "item", item: parsed.item, base: `items/${id}.xml` },
    store: {
      load: async (session) => saved.get(session),
      save: async (session, { state }) => void saved.set(session, state),
    },
    session: id,
    seed: 1,
    assets: (path) => `https://assets.example/${path}`,
    clock,
    ...(pnp === undefined ? {} : { start: { pnp } }),
  });
  const host = document.createElement("div");
  page.append(host);
  hosts.push(host);
  const shown = options.wrap === undefined ? client : options.wrap(client);
  const mounted = mountItem(host, {
    client: shown,
    files,
    staticUrl: "https://assets.example/static/",
    stylesheet: player,
    fetch: fetcher,
    ...(options.language === undefined ? {} : { language: options.language }),
    ...(options.messages === undefined ? {} : { messages: options.messages }),
  });
  return { host, ui: host.shadowRoot as ShadowRoot, client: shown, mounted };
}

const contentOf = (ui: ShadowRoot): ShadowRoot =>
  (ui.querySelector(".ak-content-host") as HTMLElement).shadowRoot as ShadowRoot;
const choices = (ui: ShadowRoot): HTMLInputElement[] => [
  ...contentOf(ui).querySelectorAll<HTMLInputElement>("qti-choice-interaction input.ak-control"),
];
const statusOf = (ui: ShadowRoot): string => ui.querySelector(".ak-status")?.textContent ?? "";
const dialogOf = (ui: ShadowRoot): HTMLDialogElement | null => contentOf(ui).querySelector("dialog");

/** Waits until the item is on screen with its choices. */
const shown = (s: Embed): Promise<void> => waitFor(() => expect(choices(s.ui)).toHaveLength(2));

/** Sends the actions that answer the item and submit it, as the host's own button would. */
async function submit(s: Embed, identifier: string): Promise<void> {
  const item = s.client.view.current?.key;
  if (item === undefined) throw new Error("The fixture shows an item.");
  await s.client.dispatch({
    type: "set-responses",
    item,
    responses: new Map([["RESPONSE", buildSingle("identifier", identifier)]]),
  });
  await s.client.dispatch({ type: "submit", item });
}

/** A button of the lesson page, which is outside every item. */
function pageButton(label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.textContent = label;
  page.append(button);
  hosts.push(button);
  return button;
}

describe("mountItem", () => {
  it("draws the content and the interactions of the item, and none of the chrome", async () => {
    const s = await embed("l1");
    await shown(s);
    expect(contentOf(s.ui).querySelector(".ak-body")?.textContent).toContain("Look at the numbers of l1.");
    expect(contentOf(s.ui).querySelector("qti-choice-interaction")?.textContent).toContain("Which is larger?");
    for (const chrome of [
      ".ak-heading",
      ".ak-map",
      "nav",
      ".ak-timers",
      ".ak-timer-status",
      ".ak-actions",
      ".ak-comment",
      ".ak-attempts",
      ".ak-notices",
      ".ak-supports",
      ".ak-tools",
      ".ak-lti",
      "button",
    ]) {
      expect(s.ui.querySelector(chrome), chrome).toBeNull();
    }
  });

  it("sends the response that the candidate gives and says that the answers are saved in one status region", async () => {
    const s = await embed("l1");
    await shown(s);
    choices(s.ui)[1]?.click();
    await waitFor(() => expect(statusOf(s.ui)).toBe("Answers saved."));
    expect(s.client.view.current?.responses.get("RESPONSE")).toEqual(buildSingle("identifier", "B"));
    expect(choices(s.ui).map((input) => input.checked)).toEqual([false, true]);
    const regions = s.ui.querySelectorAll("[role='status']");
    expect(regions).toHaveLength(1);
    expect(regions[0]?.getAttribute("aria-live")).toBe("polite");
  });

  it("keeps the room of the status line, so that what follows the item does not move when the answers are saved", async () => {
    const s = await embed("l1");
    const check = pageButton("Check the answer");
    await shown(s);
    const before = boxOf(check);
    choices(s.ui)[1]?.click();
    await waitFor(() => expect(statusOf(s.ui)).toBe("Answers saved."));
    expect(boxOf(check)).toEqual(before);
  });

  it("delivers the click of a button that the answers saved while it was pressed would have moved", async () => {
    const s = await embed("l1");
    const check = pageButton("Check the answer");
    await shown(s);
    const clicks = await clicksDuring(check, async () => {
      choices(s.ui)[1]?.click();
      await waitFor(() => expect(statusOf(s.ui)).toBe("Answers saved."));
    });
    expect(clicks).toBe(1);
  });

  it("says in words why the engine refused, in the status region", async () => {
    const s = await embed("l1", {
      wrap: (client) =>
        withDispatch(client, async () => ({
          view: client.view,
          refusal: { reason: "time-over", message: "The time is over." },
        })),
    });
    const check = pageButton("Check the answer");
    await shown(s);
    const before = boxOf(check);
    choices(s.ui)[0]?.click();
    await waitFor(() => expect(statusOf(s.ui)).toBe("The time for this question is over."));
    expect(boxOf(check)).toEqual(before);
  });

  it("writes the interface in the language of the candidate", async () => {
    const s = await embed("l1", { language: "id", messages: { id: ID_MESSAGES } });
    await shown(s);
    expect(s.ui.querySelector(".ak-item")?.getAttribute("lang")).toBe("id");
    choices(s.ui)[1]?.click();
    await waitFor(() => expect(statusOf(s.ui)).toBe("Jawaban tersimpan."));
  });

  it("disables the interactions of a closed item and keeps it drawn until destroy", async () => {
    const s = await embed("l1");
    await shown(s);
    await submit(s, "A");
    await waitFor(() => expect(choices(s.ui).map((input) => input.disabled)).toEqual([true, true]));
    expect(s.client.view.current?.status).toBe("closed");
    expect(contentOf(s.ui).querySelector(".ak-body")).not.toBeNull();
    s.mounted.destroy();
    expect(s.ui.childElementCount).toBe(0);
  });

  it("applies the supports that are on to the content and draws no panel for the options", async () => {
    const s = await embed("l1", {
      profile: `<access-for-all-pnp xmlns="${PNP_NAMESPACE}">
        <high-contrast/><alternative-text/>
        <activate-as-option-set><alternative-text/></activate-as-option-set>
        <activate-at-initialization-set><high-contrast/></activate-at-initialization-set>
      </access-for-all-pnp>`,
    });
    await shown(s);
    const contentHost = s.ui.querySelector(".ak-content-host") as HTMLElement;
    await waitFor(() => expect(contentHost.getAttribute("data-ak-contrast")).toBe("high"));
    expect(s.ui.querySelector(".ak-supports")).toBeNull();
  });

  it("takes the color theme of the profile, and the one that the host sends for the candidate", async () => {
    const s = await embed("l1", {
      profile: `<access-for-all-pnp xmlns="${PNP_NAMESPACE}">
        <text-appearance><color-theme>black-rose</color-theme></text-appearance>
        <activate-at-initialization-set><text-appearance/></activate-at-initialization-set>
      </access-for-all-pnp>`,
    });
    await shown(s);
    const contentHost = s.ui.querySelector(".ak-content-host") as HTMLElement;
    await waitFor(() => expect(contentHost.getAttribute("data-ak-theme")).toBe("black-rose"));
    await s.client.dispatch({
      type: "support-settings",
      settings: { name: "text-appearance", replaceAccessModes: [], colorTheme: "default" },
    });
    await waitFor(() => expect(contentHost.hasAttribute("data-ak-theme")).toBe(false));
  });

  it("keeps the content and the answers when a view arrives that answers an earlier request", async () => {
    const s = await embed("l1");
    await shown(s);
    choices(s.ui)[1]?.click();
    const current = s.client.view.current;
    if (current === undefined) throw new Error("The fixture shows an item.");
    s.mounted.update({
      ...s.client.view,
      current: { ...current, responses: new Map([["RESPONSE", buildSingle("identifier", "A")]]) },
    });
    await waitFor(() => expect(choices(s.ui)).toHaveLength(2));
    expect(choices(s.ui).map((input) => input.checked)).toEqual([false, true]);
  });

  it("resolves settled when the interactions have handed over what the candidate gave", async () => {
    const s = await embed("l1");
    await shown(s);
    await expect(s.mounted.settled()).resolves.toBeUndefined();
  });

  it("mounts a portable custom interaction in its frame", async () => {
    const setup = await examHost({}, pciFiles(), inject("fixtures").asset);
    const transport: Transport = async (envelope) =>
      JSON.parse(JSON.stringify(await setup.host.handle(ALICE, JSON.parse(JSON.stringify(envelope)))));
    const started = JSON.parse(JSON.stringify(await setup.host.start(ALICE, { seed: 1 })));
    const client = createRemoteSession(transport, started, { clock: setup.clock });
    const host = document.createElement("div");
    page.append(host);
    hosts.push(host);
    mountItem(host, {
      client: Object.create(client, {
        assets: { value: (path: string) => `${inject("fixtures").asset}/g/pci/${path}` },
      }),
      files,
      staticUrl: `${inject("fixtures").asset}/static/`,
      stylesheet: player,
      fetch: async (url) => {
        const bytes = setup.pkg.file(new URL(url).pathname.replace("/g/pci/", ""));
        return {
          ok: bytes !== undefined,
          status: bytes === undefined ? 404 : 200,
          text: async () => new TextDecoder().decode(bytes),
        };
      },
    });
    await client.dispatch({ type: "move", to: { ref: "q3", instance: 1 } });
    const root = host.shadowRoot?.querySelector(".ak-content-host")?.shadowRoot;
    await waitFor(() => expect(root?.querySelector("iframe")).not.toBeNull());
  });
});

const ALICE = { session: "exam-1", principal: "alice" };

describe("the focus of an item in a page", () => {
  it("never moves the focus while the candidate answers, submits and the view changes", async () => {
    const first = await embed("l1");
    const second = await embed("l2");
    await Promise.all([shown(first), shown(second)]);
    const field = document.createElement("input");
    field.setAttribute("aria-label", "Notes of the lesson");
    page.append(field);
    hosts.push(field);
    field.focus();
    choices(first.ui)[0]?.click();
    await waitFor(() => expect(statusOf(first.ui)).toBe("Answers saved."));
    await submit(second, "A");
    await waitFor(() => expect(choices(second.ui).every((input) => input.disabled)).toBe(true));
    expect(document.activeElement).toBe(field);
    expect(deepActiveElement()).toBe(field);
  });

  it("moves the focus into a modal feedback dialog, and back to the control that was focused when the candidate closes it", async () => {
    const s = await embed("l1");
    await shown(s);
    const check = pageButton("Check the answer");
    check.focus();
    await submit(s, "B");
    await waitFor(() => expect(dialogOf(s.ui)?.open).toBe(true));
    const dialog = dialogOf(s.ui) as HTMLDialogElement;
    expect(dialog.querySelector("h3, p")?.textContent).toContain("Well done");
    expect(deepActiveElement()).toBe(dialog.querySelector("h2"));
    (dialog.querySelector("form button") as HTMLButtonElement).click();
    await waitFor(() => expect(dialogOf(s.ui)).toBeNull());
    expect(document.activeElement).toBe(check);
  });

  it("closes the dialog with Escape and returns the focus to the control that was focused", async () => {
    const s = await embed("l1");
    await shown(s);
    const check = pageButton("Check the answer");
    check.focus();
    await submit(s, "B");
    await waitFor(() => expect(dialogOf(s.ui)?.open).toBe(true));
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(dialogOf(s.ui)).toBeNull());
    expect(document.activeElement).toBe(check);
  });

  it("opens no dialog for an answer that has no modal feedback", async () => {
    const s = await embed("l1");
    await shown(s);
    await submit(s, "A");
    await waitFor(() => expect(choices(s.ui).every((input) => input.disabled)).toBe(true));
    expect(dialogOf(s.ui)).toBeNull();
  });
});

describe("the lifecycle of an item in a page", () => {
  it("takes everything away at destroy, a second call does nothing, and the session stays open for the host", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"] });
    const s = await embed("l1");
    await vi.advanceTimersByTimeAsync(0);
    choices(s.ui)[0]?.click();
    s.mounted.destroy();
    s.mounted.destroy();
    expect(s.ui.childElementCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    const answered = await s.client.dispatch({
      type: "set-responses",
      item: s.client.view.current?.key ?? { ref: "l1", instance: 1 },
      responses: new Map([["RESPONSE", buildSingle("identifier", "B")]]),
    });
    expect(answered.refusal).toBeUndefined();
  });

  it("stops following the session after destroy", async () => {
    const s = await embed("l1");
    await shown(s);
    s.mounted.destroy();
    await submit(s, "B");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(s.ui.childElementCount).toBe(0);
  });

  it("refuses an item that is a link to an LTI tool, which needs the login of mountDelivery", async () => {
    const s = await embed("l1");
    const current = s.client.view.current;
    if (current === undefined) throw new Error("The fixture shows an item.");
    const lti: CandidateView = { ...s.client.view, current: { ...current, lti: { title: "Tool", custom: new Map() } } };
    const host = document.createElement("div");
    page.append(host);
    hosts.push(host);
    expect(() =>
      mountItem(host, {
        client: Object.create(s.client, { view: { value: lti } }),
        files,
        staticUrl: "https://assets.example/static/",
        stylesheet: player,
        fetch: fetcher,
      }),
    ).toThrow("The item l1 is a link to an LTI tool");
    expect(host.shadowRoot).toBeNull();
    expect(() => s.mounted.update(lti)).toThrow("Use mountDelivery");
  });

  it("mounts again on the element of an item that was destroyed, as a lesson does that shows another item in it", async () => {
    const s = await embed("l1");
    const options = { client: s.client, files, staticUrl: "https://s.example/", stylesheet: player, fetch: fetcher };
    expect(() => mountItem(s.host, options)).toThrow(HOST_SHADOW_RULE);
    s.mounted.destroy();
    const again = mountItem(s.host, options);
    expect(s.host.shadowRoot).toBe(s.ui);
    await waitFor(() => expect(choices(s.ui).length).toBeGreaterThan(0));
    again.destroy();
  });

  it("needs reserve and fill to record, and asks for neither when the recording is off", async () => {
    const s = await embed("l1");
    const bare = { upload: files.upload, read: files.read, url: files.url };
    const options = { client: s.client, staticUrl: "https://s.example/", stylesheet: player, fetch: fetcher };
    const fresh = (): HTMLElement => {
      const host = document.createElement("div");
      document.body.append(host);
      hosts.push(host);
      return host;
    };
    expect(() => mountItem(fresh(), { ...options, files: bare })).toThrow("The function reserve of the option files");
    expect(() => mountItem(fresh(), { ...options, files: { ...bare, reserve: files.reserve } })).toThrow(
      "The function fill of the option files",
    );
    mountItem(fresh(), { ...options, files: bare, hooks: { record: false } }).destroy();
  });

  it("checks its arguments", async () => {
    const s = await embed("l1");
    const options = { client: s.client, files, staticUrl: "https://s.example/", stylesheet: player, fetch: fetcher };
    const fresh = (): HTMLElement => document.createElement("div");
    const mount = (host: unknown, changes: Record<string, unknown> = {}): unknown =>
      mountItem(host as HTMLElement, { ...options, ...changes });
    expect(() => mount(null)).toThrow("The host must be an element, found null.");
    expect(() => mount(s.host)).toThrow(HOST_SHADOW_RULE);
    expect(() => mount(fresh(), { staticUrl: "https://s.example" })).toThrow('The option staticUrl must end in "/"');
    expect(() => mount(fresh(), { stylesheet: "css" })).toThrow("The option stylesheet must be a CSSStyleSheet");
    expect(() => mount(fresh(), { fetch: null })).toThrow("The option fetch must be a function");
    expect(() => mount(fresh(), { files: { upload: 1 } })).toThrow("The function upload of the option files");
    expect(() => mount(fresh(), { language: "" })).toThrow("The option language must be a non-empty string");
    expect(() => mount(fresh(), { origins: ["ftp://x"] })).toThrow("An origin of the option origins");
    expect(() => mount(fresh(), { hooks: { voice: "robot" } })).toThrow("The hook voice must be an object");
    expect(() => mount(fresh(), { hooks: [] })).toThrow("The option hooks must be an object");
    expect(() => mount(fresh(), { client: {} })).toThrow("The function age of the option client");
    expect(() => mount(fresh(), { chrome: false })).toThrow("The options has the properties");
    for (const only of [{ landmark: "main" }, { headingLevel: 1 }, { resumeCheckMs: 0 }, { marking: true }]) {
      expect(() => mount(fresh(), only)).toThrow("The options has the properties");
    }
    expect(() => mount(fresh(), { hooks: { tools: {} } })).toThrow("The option hooks has the properties");
    expect(() => mount(fresh(), { hooks: { ltiLogin: () => undefined } })).toThrow(
      "The option hooks has the properties",
    );
  });
});

describe("the type of the options", () => {
  it("holds none of the options that only a delivery uses, which the check refuses", () => {
    const named = (options: ItemMountOptions): ItemMountOptions => options;
    const shared = {
      client: {} as SessionClient,
      files,
      staticUrl: "https://s.example/",
      stylesheet: player,
      fetch: fetcher,
    };
    named(shared);
    // @ts-expect-error `landmark` is an option of `mountDelivery`.
    named({ ...shared, landmark: "main" });
    // @ts-expect-error `headingLevel` is an option of `mountDelivery`.
    named({ ...shared, headingLevel: 1 });
    // @ts-expect-error `resumeCheckMs` is an option of `mountDelivery`.
    named({ ...shared, resumeCheckMs: 0 });
  });
});

describe("accessibility of items in a page", () => {
  it("has no violation of WCAG 2.2 A and AA with several items in a page, and with a modal feedback open", async () => {
    const items = await Promise.all([
      embed("l1"),
      embed("l2"),
      embed("l3", { language: "id", messages: { id: ID_MESSAGES } }),
    ]);
    await Promise.all(items.map(shown));
    expect(await axeViolations(page)).toEqual([]);
    const [first] = items;
    if (first === undefined) throw new Error("The page has items.");
    await submit(first, "B");
    await waitFor(() => expect(dialogOf(first.ui)?.open).toBe(true));
    expect(await axeViolations(page)).toEqual([]);
  });
});
