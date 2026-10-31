import { parseWith } from "@assesskit/runtime/checks";
import { DataError } from "@assesskit/runtime/errors";
import { describe, expect, it } from "vitest";
import { checkHttpsUrl, httpsUrlSchema } from "../src/checks.js";

describe("checkHttpsUrl", () => {
  it("accepts an absolute https URL", () => {
    for (const url of ["https://example.edu", "https://example.edu:8443/path?q=1#f", "HTTPS://EXAMPLE.EDU/"]) {
      expect(() => checkHttpsUrl(url, "The option endpoint")).not.toThrow();
    }
  });

  it("rejects other schemes, relative references and other types", () => {
    for (const url of ["http://example.edu", "ftp://example.edu", "urn:uuid:1", "/path", "example.edu", ""]) {
      expect(() => checkHttpsUrl(url, "The option endpoint"), url).toThrow(
        new DataError(`The option endpoint must be an absolute https URL, found ${JSON.stringify(url)}.`),
      );
    }
    expect(() => checkHttpsUrl(JSON.parse("5"), "The option endpoint")).toThrow(
      "The option endpoint must be a string, found 5.",
    );
  });
});

describe("httpsUrlSchema", () => {
  it("accepts an absolute https URL", () => {
    expect(parseWith(httpsUrlSchema, "https://a.example/b", "The URL")).toBe("https://a.example/b");
  });

  it("refuses other URLs", () => {
    expect(() => parseWith(httpsUrlSchema, "http://a.example", "The URL")).toThrow(
      new DataError('The URL is invalid: expected an absolute https URL, found "http://a.example".'),
    );
  });
});
