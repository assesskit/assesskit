import { expect, test } from "vitest";
import { DEFAULT_ITEM_FORMAT_LIMITS, readGift, writeGift } from "../src/index.js";
import { BENCH_OPTIONS, BUDGETS, expectWithin } from "./budgets.js";
import { buildWrittenItems, GIFT_EDGES, WRITE_OPTIONS } from "./item-formats-cases.js";

// The readers take files once, on import, and the writers run each item's response processing on the responses that matter;
// no library reads GIFT as Moodle does or writes it from QTI items, so the budgets hold the time alone.

/** Essays of the most tags of a text, each `<b>` and `</b>` a tag, as many as the limit of elements holds. */
const TAGS = `[html]${"<b>x</b>".repeat(DEFAULT_ITEM_FORMAT_LIMITS.maxTextTags / 2)}{}\n\n`.repeat(47);

test("reads the edge cases of GIFT within its budget", async ({ annotate, bench }) => {
  expect(readGift(GIFT_EDGES).items).toHaveLength(18);
  const result = await bench("read GIFT", () => readGift(GIFT_EDGES)).run(BENCH_OPTIONS);
  await expectWithin(annotate, "read GIFT", result, BUDGETS.giftRead);
});

test("writes the items of the written cases as GIFT within its budget", async ({ annotate, bench }) => {
  const items = buildWrittenItems();
  expect(writeGift(items, WRITE_OPTIONS).losses).toHaveLength(12);
  const result = await bench("write GIFT", () => writeGift(items, WRITE_OPTIONS)).run(BENCH_OPTIONS);
  await expectWithin(annotate, "write GIFT", result, BUDGETS.giftWrite);
});

test("reads essays of the most tags of a text, to the limit of elements, within its budget", async ({
  annotate,
  bench,
}) => {
  expect(readGift(TAGS).items).toHaveLength(47);
  const result = await bench("read GIFT tags", () => readGift(TAGS)).run(BENCH_OPTIONS);
  await expectWithin(annotate, "read GIFT tags", result, BUDGETS.giftTags);
});
