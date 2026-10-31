import { descendantNodes, type PortableCustomInteraction, readAsi } from "@luthfanwakan/olah/asi";
import { moduleConfigurationPaths, type PciModuleConfiguration, parseModuleResolution } from "@luthfanwakan/olah/pci";
import { single, type ValueDeclaration } from "@luthfanwakan/olah/values";
import { describe, expect, it } from "vitest";
import { commands } from "vitest/browser";
import { asset, eventOf, hits, type Mounted, mount, ready, tokenOf } from "./pci-fixture.js";
import { waitFor } from "./wait.js";

/** The 1EdTech example packages that the global setup serves, by name. */
type Example = "pci-simple" | "pci";

const url = (example: Example, path: string): string => `${asset}/c/${tokenOf()}/${example}/${path}`;

/** Fetches a file of an example package, or returns `undefined` when it has none. */
async function text(example: Example, path: string): Promise<string | undefined> {
  const response = await fetch(url(example, path));
  return response.ok ? response.text() : undefined;
}

/** What `mount` needs of one `qti-portable-custom-interaction` of an example item, read from the package as a player would. */
async function loadInteraction(example: Example, item: string, index: number) {
  const source = await text(example, item);
  if (source === undefined) throw new Error(`The corpus has no ${item}: run pnpm corpus first.`);
  const document = readAsi(source);
  if (document.kind !== "item") throw new Error(`${item} is no item.`);
  const interaction = descendantNodes(document.item)
    .filter((node): node is PortableCustomInteraction => node.kind === "portable-custom-interaction")
    .at(index);
  if (interaction === undefined) throw new Error(`${item} has no interaction ${index}.`);
  const files = moduleConfigurationPaths(interaction);
  const [primary, fallback] = await Promise.all([text(example, files.primary), text(example, files.fallback)]);
  const configuration: PciModuleConfiguration = {
    ...(primary === undefined ? {} : { primary: parseModuleResolution(primary) }),
    ...(fallback === undefined ? {} : { fallback: parseModuleResolution(fallback) }),
  };
  // The markup as it stands in the item, with the URLs of its files resolved against the package.
  const markup =
    [...source.matchAll(/<qti-interaction-markup>([\s\S]*?)<\/qti-interaction-markup>/gu)][index]?.[1] ?? "";
  const resolved = markup.replace(/\bsrc="([^"]+)"/gu, (_, path: string) => `src="${url(example, path)}"`);
  return {
    interaction,
    configuration,
    assets: (path: string) => url(example, path),
    markup: `<qti-interaction-markup>${resolved}</qti-interaction-markup>`,
  };
}

/** Mounts an interaction of an example, and waits until it is ready. */
async function mountExample(
  loaded: Awaited<ReturnType<typeof loadInteraction>>,
  declaration: ValueDeclaration,
): Promise<Mounted> {
  await commands.watchConsole();
  const result = mount({ ...loaded, prompt: null, stylesheets: [], response: { value: null, declaration } });
  await ready(result);
  return result;
}

/**
 * The errors that the page logged, less the ones that are meant: the refusal of the frame's own probe, a script from a
 * `data:` URL that the policy must refuse; the 404 for the default fallback configuration, which `loadInteraction` asks
 * for and an example may lack; and the 404s for paths that an example gets wrong on purpose.
 */
async function errorsExcept(...paths: string[]): Promise<readonly string[]> {
  const meant = ["data:text/javascript,0", "fallback_module_resolution.js", ...paths];
  return (await commands.consoleErrors()).filter((error) => !meant.some((part) => error.includes(part)));
}

describe("the PCI examples of 1EdTech", () => {
  it("[T49] runs the pci-simple example: it renders, takes a tap, and logs no error", async () => {
    const loaded = await loadInteraction("pci-simple", "measuring_ph.xml", 0);
    const result = await mountExample(loaded, { cardinality: "single", baseType: "integer" });
    expect(await hits(asset)).toContain("/c/pci-simple/modules/tap.js");

    await commands.clickInFrame("Interactive question", "button.hmh-tap-image >> nth=0");
    // tap.js fires no change event; the player reads its response and state when the frame goes.
    await result.frame.destroy();
    const completed = eventOf(result.events, "completed");
    expect(completed?.response).toEqual(single("integer", 1));
    expect(JSON.parse(completed?.state ?? "null")).toMatchObject({ numReveals: 1 });
    expect(await errorsExcept()).toEqual([]);
  });

  it("[T49] runs the second fractions interaction, whose first path is wrong on purpose: the fallback loads, and it logs no other error", async () => {
    const loaded = await loadInteraction("pci", "fractions1.xml", 1);
    const result = await mountExample(loaded, { cardinality: "single", baseType: "identifier" });
    const paths = await hits(asset);
    expect(paths).toContain("/c/pci/modules/shadingYY.js");
    expect(paths).toContain("/c/pci/modules/shading.js");
    expect(paths.indexOf("/c/pci/modules/shading.js")).toBeGreaterThan(paths.indexOf("/c/pci/modules/shadingYY.js"));

    await commands.clickInFrame("Interactive question", "button.colMore");
    await waitFor(() => expect(result.frame.element.getBoundingClientRect().height).toBeGreaterThan(48));
    expect(await errorsExcept("shadingYY.js")).toEqual([]);
  });
});
