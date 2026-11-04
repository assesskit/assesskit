import { AssesskitError } from "@assesskit/runtime/errors";
import { describe, expect, it } from "vitest";
import { AccessError } from "../src/index.js";

describe("AccessError", () => {
  it("carries the reason it was thrown with", () => {
    const error = new AccessError("The session exists.", "session-exists");
    expect(error).toBeInstanceOf(AssesskitError);
    expect(error.name).toBe("AccessError");
    expect(error.reason).toBe("session-exists");
  });

  it("carries the error it reports as its cause", () => {
    const cause = new Error("The store refused the record.");
    expect(new AccessError("The session exists.", "session-exists", { cause }).cause).toBe(cause);
  });
});
