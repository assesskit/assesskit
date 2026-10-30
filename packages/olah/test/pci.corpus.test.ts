import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkPortableInteraction,
  moduleConfigurationPaths,
  type PortableCustomInteraction,
  parseModuleResolution,
  pciProperties,
  resolvePciModules,
} from "../src/index.js";
import { EXAMPLES, exampleItems } from "./corpus-items.js";

const PACKAGING = join(EXAMPLES, "packaging");
const items = exampleItems();

/** The portable custom interactions of the example at a path. */
function interactionsOf(path: string): PortableCustomInteraction[] {
  const example = items.find((candidate) => candidate.path === path);
  if (example === undefined) throw new Error(`${path} is no example item.`);
  return (example.item.body?.children ?? []).flatMap((node) => [
    ...(node.kind === "portable-custom-interaction" ? [node] : []),
    ...(node.kind === "div" ? node.children.filter((child) => child.kind === "portable-custom-interaction") : []),
  ]);
}

function resolutionFile(path: string): string {
  return readFileSync(join(PACKAGING, path), "utf8");
}

describe("the portable custom interactions of the 1EdTech examples", () => {
  it("[J4][C] read the module resolution file of a package: the timeout and the paths that the JSON says", () => {
    const text = resolutionFile("pci/src/modules/module_resolution.js");
    const parsed = parseModuleResolution(text);
    const json: { waitSeconds: number; paths: Record<string, string> } = JSON.parse(text);
    expect(parsed.waitSeconds).toBe(60);
    expect([...parsed.paths]).toEqual(Object.entries(json.paths));
    expect(parsed.paths.get("jquery")).toBe("https://code.jquery.com/jquery-2.2.2.min");
    expect(parsed.paths.get("tap")).toBe("modules/tap");
    const fallback = parseModuleResolution(resolutionFile("pci/src/modules/hmh_co_com_fallback.json"));
    expect([...fallback.paths.keys()]).toEqual(["jquery", "eve", "raphael"]);
  });

  it("[J5][J6][C] have the configuration files the interaction names, and none when it names none", () => {
    for (const path of ["packaging/pci/src/fractions1.xml", "packaging/pci/src/fractions_deps.xml"]) {
      for (const interaction of interactionsOf(path)) {
        expect(moduleConfigurationPaths(interaction)).toEqual({
          primary: "modules/module_resolution.js",
          fallback: "modules/fallback_module_resolution.js",
        });
      }
    }
  });

  it("[J6][C] locate the modules that qti-interaction-module names, with the primary path and the fallback of the item", () => {
    const [first, second] = interactionsOf("packaging/pci/src/fractions1.xml");
    expect(first && resolvePciModules(first, {})).toEqual([
      { id: "shading", primary: "modules/shadingXX.js", fallback: "modules/shading.js", packageRelative: true },
    ]);
    expect(second && resolvePciModules(second, {})).toEqual([
      { id: "shading", primary: "modules/shadingYY.js", fallback: "modules/shading.js", packageRelative: true },
    ]);
  });

  it("[J6][C] load a library from the web first when the item says so, and the others from the package", () => {
    const [interaction] = interactionsOf("packaging/pci/src/fractions_deps.xml");
    const modules = interaction && resolvePciModules(interaction, {});
    expect(modules?.map(({ id, primary, packageRelative }) => [id, primary, packageRelative])).toEqual([
      ["jquery", "https://code.jquery.com/jquery-2.2.3.min", false],
      ["eve", "modules/lib/eve.js", true],
      ["raphael", "modules/lib/raphael.js", true],
      ["shadingD", "modules/shading_deps.js", true],
    ]);
  });

  it("[J6][C] load the module of the module attribute from the package configuration", () => {
    const [interaction] = interactionsOf("packaging/pci/src/measuring_ph.xml");
    const primary = parseModuleResolution(resolutionFile("pci/src/modules/module_resolution.js"));
    expect(interaction?.module).toBe("tap");
    const modules = interaction && resolvePciModules(interaction, { primary });
    expect(modules?.[0]).toEqual({ id: "tap", primary: "modules/tap", packageRelative: true });
    expect(modules?.map(({ id }) => id)).toContain("jquery");
    expect(interaction && checkPortableInteraction(interaction, { primary }).map(({ code }) => code)).toEqual([
      "olah/pci/type-identifier",
    ]);
  });

  it("[J6][N][C] have no module for a module the configuration lacks: measuring_ph names tap, which no configuration locates", () => {
    for (const interaction of interactionsOf("packaging/pci/src/fractions1.xml")) {
      expect(checkPortableInteraction(interaction, {})).toEqual([]);
    }
    const [interaction] = interactionsOf("packaging/pci/src/measuring_ph.xml");
    expect(interaction && checkPortableInteraction(interaction, {}).map(({ code }) => code)).toEqual([
      "olah/pci/module-not-configured",
      "olah/pci/type-identifier",
    ]);
  });

  it("[J7][C] have a Federated Content URN as type identifier, but for the two tap-to-reveal examples, which write dashes", () => {
    const warned = items.flatMap(({ path }) =>
      interactionsOf(path).flatMap((interaction) =>
        checkPortableInteraction(interaction, {}).some(({ code }) => code === "olah/pci/type-identifier") ? [path] : [],
      ),
    );
    expect(warned).toEqual(["packaging/pci-simple/src/measuring_ph.xml", "packaging/pci/src/measuring_ph.xml"]);
  });

  it("[J8][C] pass the data- attributes as properties named like element.dataset", () => {
    const [interaction] = interactionsOf("packaging/pci/src/measuring_ph.xml");
    expect([...(interaction ? pciProperties(interaction) : [])]).toEqual([
      ["toggle", "true"],
      ["tapMessage", "Tap to reveal the color of the solution"],
    ]);
    const [shading] = interactionsOf("packaging/pci/src/fractions1.xml");
    const properties = shading ? pciProperties(shading) : new Map<string, string>();
    expect(properties.get("controls")).toBe("none");
    expect(properties.get("selected_color")).toBe("red");
    expect(properties.get("dimension1_initial")).toBe("3");
    expect(properties.size).toBe(10);
  });
});
