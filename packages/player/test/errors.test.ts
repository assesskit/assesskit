import { AssesskitError } from "@assesskit/runtime/errors";
import { describe, expect, it } from "vitest";
import { AccessError, LtiError, ServiceError } from "../src/index.js";

describe("AccessError", () => {
  it("carries the reason it was thrown with", () => {
    const error = new AccessError("The session exists.", "session-exists");
    expect(error).toBeInstanceOf(AssesskitError);
    expect(error.name).toBe("AccessError");
    expect(error.reason).toBe("session-exists");
  });
});

describe("LtiError", () => {
  it("carries the reason it was thrown with", () => {
    const error = new LtiError("The nonce was used before.", "nonce-reused");
    expect(error).toBeInstanceOf(AssesskitError);
    expect(error.name).toBe("LtiError");
    expect(error.reason).toBe("nonce-reused");
  });
});

describe("ServiceError", () => {
  it("carries the status and the body of the failed call", () => {
    const error = new ServiceError("The CAT service answered 503.", 503, "unavailable");
    expect(error).toBeInstanceOf(AssesskitError);
    expect(error.name).toBe("ServiceError");
    expect(error.status).toBe(503);
    expect(error.body).toBe("unavailable");
  });
});

describe("the classes are distinct", () => {
  it("lets a host tell the failures apart by class", () => {
    const errors = [new AccessError("b", "r"), new LtiError("c", "r"), new ServiceError("d", 500, "")];
    expect(errors.map((error) => error.constructor.name)).toEqual(["AccessError", "LtiError", "ServiceError"]);
  });
});
