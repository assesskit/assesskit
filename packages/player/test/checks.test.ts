import { parseWith } from "@assesskit/runtime/checks";
import { DataError } from "@assesskit/runtime/errors";
import { describe, expect, it } from "vitest";
import { httpsUrlSchema } from "../src/checks.js";

describe("httpsUrlSchema", () => {
  it("accepts an absolute https URL", () => {
    expect(parseWith(httpsUrlSchema, "https://a.example/b", "The URL")).toBe("https://a.example/b");
  });

  it("refuses other URLs", () => {
    expect(() => parseWith(httpsUrlSchema, "http://a.example", "The URL")).toThrow(
      new DataError('The URL is invalid: expected an absolute https URL, found "http://a.example".'),
    );
  });

  it("accepts the schemes and hosts of an https URL in any case, and refuses a relative reference and another type", () => {
    for (const url of ["https://example.edu:8443/path?q=1#f", "HTTPS://EXAMPLE.EDU/"]) {
      expect(parseWith(httpsUrlSchema, url, "The URL")).toBe(url);
    }
    for (const url of ["ftp://example.edu", "urn:uuid:1", "/path", "example.edu", ""]) {
      expect(() => parseWith(httpsUrlSchema, url, "The URL"), url).toThrow(DataError);
    }
    expect(() => parseWith(httpsUrlSchema, JSON.parse("5"), "The URL")).toThrow(DataError);
  });
});
