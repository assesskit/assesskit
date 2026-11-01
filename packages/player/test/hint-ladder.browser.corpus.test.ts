import { afterEach, describe, expect, it } from "vitest";
import { commands } from "vitest/browser";
import {
  choose,
  hintsShown,
  press,
  processed,
  removeHintPages,
  SECOND,
  shown,
  startHints,
  wireFloat,
  wireIdentifier,
} from "./hint-fixture.js";
import { waitFor } from "./wait.js";

afterEach(removeHintPages);

const files = await commands.corpusFiles();
const hint = files.find(({ path }) => path.endsWith("packaging/items/hint.xml"));
if (hint === undefined) throw new Error("The examples have no packaging/items/hint.xml.");

describe("the hint example of the 1EdTech examples in the player", () => {
  it("shows its hint after the request, and scores the next attempt, with the outcomes of each attempt in its events", async () => {
    const hints = await startHints(hint.text);
    await shown(hints);
    hints.clock.advance(3 * SECOND);
    await press(hints, "Show Hint");
    await waitFor(() => expect(hintsShown(hints)).toHaveLength(1));
    expect(hintsShown(hints)[0]).toContain("Tony lives in the United Kingdom");
    await press(hints, "Try again");
    await choose(hints, "Vicente Fox");
    hints.clock.advance(5 * SECOND);
    await press(hints, "Submit answer");
    await waitFor(() => expect(processed(hints)).toHaveLength(2));
    expect(processed(hints).map(({ attempt, duration }) => [attempt, duration])).toEqual([
      [1, 3_000],
      [2, 8_000],
    ]);
    expect(processed(hints).map(({ outcomes }) => [outcomes?.FEEDBACK, outcomes?.SCORE])).toEqual([
      [wireIdentifier("HINT"), wireFloat(0)],
      [wireIdentifier("NOHINT"), wireFloat(1)],
    ]);
    expect(hintsShown(hints)).toEqual([]);
  });
});
