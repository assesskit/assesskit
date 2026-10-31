import { type PortableCustomInteraction, readAsi } from "@assesskit/runtime/asi";
import type { ModuleResolution, PciModuleConfiguration } from "@assesskit/runtime/pci";
import type { ValueDeclaration } from "@assesskit/runtime/values";
import { afterEach, beforeEach, expect, inject } from "vitest";
import { EN_MESSAGES } from "../src/messages/index.js";
import {
  mountPciFrame,
  type PciEvent,
  type PciFiles,
  type PciFrame,
  type PciFrameOptions,
} from "../src/player/index.js";
import { waitFor } from "./wait.js";

/** The origins of the servers of the global setup. */
export const { asset, other, stranger } = inject("fixtures");

/** The buttons of `simple.js`: `press` counts and `done` asks for the solution. */
export const PRESS = '<button id="press">Press</button><button id="done">Done</button><span class="dot"></span>';

/** The attributes of an interaction whose module is `simple.js`. */
export const SIMPLE = 'module="simple" custom-interaction-type-identifier="urn:test:simple"';

/** The declaration of a response variable of one integer. */
export const INTEGER: ValueDeclaration = { cardinality: "single", baseType: "integer" };

/** A probe message: what code inside a frame reports to the test, which the player ignores. */
export type Probe = Readonly<Record<string, unknown>> & { readonly probe: string };

/** A frame that a test mounted, with what it did. */
export interface Mounted {
  readonly frame: PciFrame;
  /** The events of the player, in order. */
  readonly events: PciEvent[];
  /** What the code in the frame reported. */
  readonly probes: Probe[];
  readonly container: HTMLElement;
  /** Stops collecting probes. */
  readonly stop: () => void;
}

const mounted: Mounted[] = [];

let token = "";

// The browsers of a run share the servers, so a test names its paths with a token of its own.
beforeEach(() => {
  token = crypto.randomUUID();
});

/** The token of the running test. */
export const tokenOf = (): string => token;

/** The base URL of the package of the running test: `/g/<token>/` on the asset origin. */
const gate = (): string => `${asset}/g/${token}/`;

/** Gives the URL of a path in the package of the running test. */
export const assets = (path: string): string => `${gate()}${path}`;

const NS = 'xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0"';

/** Reads a `qti-portable-custom-interaction` with the given attributes and content. */
export function interactionOf(attributes: string, children = "<qti-interaction-markup/>"): PortableCustomInteraction {
  const document = readAsi(
    `<qti-assessment-item ${NS} identifier="item" title="Item" time-dependent="false"><qti-item-body><qti-portable-custom-interaction response-identifier="RESPONSE" ${attributes}>${children}</qti-portable-custom-interaction></qti-item-body></qti-assessment-item>`,
  );
  const [node] = document.kind === "item" ? (document.item.body?.children ?? []) : [];
  if (node?.kind !== "portable-custom-interaction") throw new Error("The test reads a portable custom interaction.");
  return node;
}

/** A module resolution file with the given paths. */
export const resolution = (paths: Readonly<Record<string, string>>, waitSeconds = 7): ModuleResolution => ({
  waitSeconds,
  paths: new Map(Object.entries(paths)),
});

/** A host whose files are the ones given, by reference, and that keeps what is uploaded. */
export function memoryFiles(stored: ReadonlyMap<string, Uint8Array> = new Map()) {
  const uploads: { readonly bytes: Uint8Array; readonly mimeType: string; readonly fileName: string | undefined }[] =
    [];
  const files: PciFiles = {
    read: async ({ reference }) => stored.get(reference) ?? new Uint8Array(),
    upload: async (blob, mimeType, fileName) => {
      uploads.push({ bytes: new Uint8Array(await blob.arrayBuffer()), mimeType, fileName });
      return { reference: `uploaded-${uploads.length}`, mimeType, ...(fileName === undefined ? {} : { fileName }) };
    },
  };
  return { files, uploads };
}

/** Mounts the interaction of `simple.js` in a frame, with the options replaced by the given ones. */
export function mount(overrides: Partial<PciFrameOptions> = {}): Mounted {
  const events: PciEvent[] = [];
  const probes: Probe[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const configuration: PciModuleConfiguration = { primary: resolution({ simple: "modules/simple" }) };
  const frame = mountPciFrame(container, {
    staticUrl: `${asset}/static/`,
    messages: EN_MESSAGES,
    language: "en",
    interaction: interactionOf(SIMPLE),
    configuration,
    assets,
    prompt: "Press the button.",
    markup: `<qti-interaction-markup>${PRESS}</qti-interaction-markup>`,
    stylesheets: [`${gate()}styles/item.css`],
    status: "interacting",
    response: { value: null, declaration: INTEGER },
    files: memoryFiles().files,
    onEvent: (event) => events.push(event),
    ...overrides,
  });
  const collect = (event: MessageEvent): void => {
    const { data } = event;
    if (event.source === frame.element.contentWindow && typeof data === "object" && data !== null && "probe" in data) {
      probes.push(data);
    }
  };
  window.addEventListener("message", collect);
  const result = { frame, events, probes, container, stop: () => window.removeEventListener("message", collect) };
  mounted.push(result);
  return result;
}

afterEach(async () => {
  for (const { frame, container, stop } of mounted.splice(0)) {
    await frame.destroy();
    stop();
    container.remove();
  }
});

/** Returns the first event of a type. */
export const eventOf = <T extends PciEvent["type"]>(events: readonly PciEvent[], type: T) =>
  events.find((event): event is Extract<PciEvent, { type: T }> => event.type === type);

/** Returns the first probe of a name. */
export const probeOf = (probes: readonly Probe[], name: string) => probes.find(({ probe }) => probe === name);

/** Waits until the interaction of the frame is ready. */
export const ready = ({ events }: Mounted) => waitFor(() => expect(eventOf(events, "ready")).toBeDefined());

/** Returns every path that a fixture server was asked for. */
export async function requests(origin: string): Promise<string[]> {
  return (await fetch(`${origin}/__hits`, { cache: "no-store" })).json();
}

/** Returns the paths below the token of the test that a fixture server was asked for, without the token. */
export async function hits(origin: string): Promise<string[]> {
  const prefix = new RegExp(`/${token}(?=/)`, "u");
  return (await requests(origin)).filter((path) => prefix.test(path)).map((path) => path.replace(prefix, ""));
}
