import { describe, expect, it } from "vitest";
import { DataError, type Issue, OlahError, ProcessingError, ReadError, SecurityError } from "../src/index.js";

const issue: Issue = {
  severity: "error",
  code: "olah/xml/not-well-formed",
  message: "The document is not well-formed: the element qti-item-body is not closed.",
  source: "BIND §5.2",
  location: { path: "items/choice.xml", line: 12, column: 3, element: "qti-assessment-item/qti-item-body" },
};

describe("OlahError", () => {
  it("is an Error with its own name", () => {
    const error = new OlahError("failed");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("OlahError");
    expect(error.message).toBe("failed");
  });
});

describe("DataError", () => {
  it("is an OlahError", () => {
    const error = new DataError("A seed must be a safe integer, found 1.5.");
    expect(error).toBeInstanceOf(OlahError);
    expect(error.name).toBe("DataError");
  });
});

describe("ReadError", () => {
  it("carries the issues it was thrown with", () => {
    const error = new ReadError("The document cannot be read.", [issue]);
    expect(error).toBeInstanceOf(OlahError);
    expect(error.name).toBe("ReadError");
    expect(error.issues).toEqual([issue]);
  });
});

describe("SecurityError", () => {
  it("names the limit and its value", () => {
    const error = new SecurityError("The document is larger than 1000 bytes.", "maxBytes", 1000);
    expect(error).toBeInstanceOf(OlahError);
    expect(error.name).toBe("SecurityError");
    expect(error.limit).toBe("maxBytes");
    expect(error.value).toBe(1000);
  });
});

describe("ProcessingError", () => {
  it("carries the source and the identifier", () => {
    const error = new ProcessingError('The variable "SCORE" is not declared.', "INFO §2.2.2", "SCORE");
    expect(error).toBeInstanceOf(OlahError);
    expect(error.name).toBe("ProcessingError");
    expect(error.source).toBe("INFO §2.2.2");
    expect(error.identifier).toBe("SCORE");
  });

  it("has no identifier when none is given", () => {
    expect(new ProcessingError("Unknown template.", "INFO §4.6.1").identifier).toBeUndefined();
  });
});
