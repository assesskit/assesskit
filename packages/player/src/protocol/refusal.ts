import type { Schema } from "@assesskit/runtime/checks";
import type { Refusal } from "@assesskit/runtime/delivery";
import { REFUSAL_REASONS } from "@assesskit/runtime/delivery/wire";
import * as v from "valibot";

/** The schema of a refusal. */
export const refusalSchema: Schema<Refusal> = v.strictObject({
  reason: v.picklist(REFUSAL_REASONS),
  message: v.string(),
});
