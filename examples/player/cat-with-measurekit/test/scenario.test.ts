import { describe, expect, it } from "vitest";
import { administer, answersEasyItems } from "../scenario.ts";
import { measurekitCatPort } from "../src/measurekit-cat-port.ts";
import { memoryStore } from "../src/memory-store.ts";

describe("the scenario", () => {
  it("presents the three items of the section over the bank and then ends", async () => {
    const port = measurekitCatPort({ sections: memoryStore(), seeds: () => 42 });
    expect(await administer(port, answersEasyItems)).toEqual(["q3", "q5", "q4"]);
  });

  it("presents the same items to a session with the same seed, from another process that shares the store", async () => {
    const sections = memoryStore();
    const first = await administer(measurekitCatPort({ sections, seeds: () => 7 }), answersEasyItems);
    const second = await administer(measurekitCatPort({ sections, seeds: () => 7 }), answersEasyItems);
    expect(second).toEqual(first);
  });
});
