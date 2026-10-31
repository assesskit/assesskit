import { describe, expect, inject, it } from "vitest";
import clientGuide from "../../../docs/player/client.md?raw";
import contentGuide from "../../../docs/player/content.md?raw";
import deliveryGuide from "../../../docs/player/delivery.md?raw";
import interactionsGuide from "../../../docs/player/interactions.md?raw";
import mathGuide from "../../../docs/player/math.md?raw";
import pciGuide from "../../../docs/player/pci.md?raw";
import speechGuide from "../../../docs/player/speech.md?raw";
import stylingGuide from "../../../docs/player/styling.md?raw";
import supportsGuide from "../../../docs/player/supports.md?raw";
import toolsGuide from "../../../docs/player/tools.md?raw";
import { PLAYER_CSS } from "./css-fixture.js";
import { runGuideSamples } from "./guide-samples.js";

/** The modules that the samples of the guides import, by address. */
async function modules(): Promise<Record<string, object>> {
  return {
    "@assesskit/player": await import("../src/index.js"),
    "@assesskit/player/client": await import("../src/client/index.js"),
    "@assesskit/player/player": await import("../src/player/index.js"),
    "@assesskit/player/player.css?inline": { default: PLAYER_CSS },
    "@assesskit/runtime/asi": await import("@assesskit/runtime/asi"),
    "@assesskit/runtime/delivery": await import("@assesskit/runtime/delivery"),
    "@assesskit/runtime/interactions": await import("@assesskit/runtime/interactions"),
    "@assesskit/runtime/pci": await import("@assesskit/runtime/pci"),
    "@assesskit/runtime/values": await import("@assesskit/runtime/values"),
  };
}

/** The URL of MathJax in the sample of the guide to mathematics, and where the browser tests serve it. */
const MATHJAX_EXAMPLE = "https://assets.example/mathjax/mml-chtml.js";
const MATHJAX = `${inject("fixtures").asset}/mathjax/${crypto.randomUUID()}/mml-chtml.js`;

describe("the guides", () => {
  it("shows the results that the guide to the client gives", async () => {
    expect(await runGuideSamples(clientGuide, await modules())).toBeGreaterThan(0);
  });

  it("shows the results that the guide to content gives", async () => {
    expect(await runGuideSamples(contentGuide, await modules())).toBeGreaterThan(0);
  });
  it("shows the results that the guide to delivery gives", async () => {
    expect(await runGuideSamples(deliveryGuide, await modules())).toBeGreaterThan(0);
  });

  it("shows the results that the guide to interactions gives", async () => {
    expect(await runGuideSamples(interactionsGuide, await modules())).toBeGreaterThan(0);
  });

  it("shows the results that the guide to math gives", async () => {
    expect(await runGuideSamples(mathGuide.replaceAll(MATHJAX_EXAMPLE, MATHJAX), await modules())).toBeGreaterThan(0);
  });

  it("shows the results that the guide to pci gives", async () => {
    expect(await runGuideSamples(pciGuide, await modules())).toBeGreaterThan(0);
  });

  it("shows the results that the guide to speech gives", async () => {
    expect(await runGuideSamples(speechGuide, await modules())).toBeGreaterThan(0);
  });

  it("shows the results that the guide to styling gives", async () => {
    expect(await runGuideSamples(stylingGuide, await modules())).toBeGreaterThan(0);
  });

  it("shows the results that the guide to supports gives", async () => {
    expect(await runGuideSamples(supportsGuide, await modules())).toBeGreaterThan(0);
  });

  it("shows the results that the guide to tools gives", async () => {
    expect(await runGuideSamples(toolsGuide, await modules())).toBeGreaterThan(0);
  });
});
