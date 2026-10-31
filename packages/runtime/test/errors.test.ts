import { describe, expect, it } from "vitest";
import { AssesskitError, DataError, type Issue, ProcessingError, ReadError, SecurityError } from "../src/index.js";

const issue: Issue = {
  severity: "error",
  code: "assesskit/xml/not-well-formed",
  message: "The document is not well-formed: the element qti-item-body is not closed.",
  location: { path: "items/choice.xml", line: 12, column: 3, element: "qti-assessment-item/qti-item-body" },
};

describe("AssesskitError", () => {
  it("is an Error with its own name", () => {
    const error = new AssesskitError("failed");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("AssesskitError");
    expect(error.message).toBe("failed");
  });
});

describe("DataError", () => {
  it("is an AssesskitError", () => {
    const error = new DataError("A seed must be a safe integer, found 1.5.");
    expect(error).toBeInstanceOf(AssesskitError);
    expect(error.name).toBe("DataError");
  });
});

describe("ReadError", () => {
  it("carries the issues it was thrown with", () => {
    const error = new ReadError("The document cannot be read.", [issue]);
    expect(error).toBeInstanceOf(AssesskitError);
    expect(error.name).toBe("ReadError");
    expect(error.issues).toEqual([issue]);
  });
});

describe("SecurityError", () => {
  it("names the limit and its value", () => {
    const error = new SecurityError("The document is larger than 1000 bytes.", "maxBytes", 1000);
    expect(error).toBeInstanceOf(AssesskitError);
    expect(error.name).toBe("SecurityError");
    expect(error.limit).toBe("maxBytes");
    expect(error.value).toBe(1000);
  });
});

describe("ProcessingError", () => {
  it("carries the identifier", () => {
    const error = new ProcessingError('The variable "SCORE" is not declared.', "SCORE");
    expect(error).toBeInstanceOf(AssesskitError);
    expect(error.name).toBe("ProcessingError");
    expect(error.identifier).toBe("SCORE");
  });

  it("has no identifier when none is given", () => {
    expect(new ProcessingError("Unknown template.").identifier).toBeUndefined();
  });
});
