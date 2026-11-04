import { describe, expect, it } from "vitest";
import { AssesskitError, DataError, type Issue, ProcessingError, ReadError, SecurityError } from "../src/index.js";

const issue: Issue = {
  severity: "error",
  rule: "assesskit/xml/not-well-formed",
  message: "The document is not well-formed: the element qti-item-body is not closed.",
  location: { path: "items/choice.xml", line: 12, column: 3, element: "qti-assessment-item/qti-item-body" },
};

const cause = new SyntaxError("Unexpected end of JSON input");

describe("AssesskitError", () => {
  it("is an Error with its own name", () => {
    const error = new AssesskitError("failed");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("AssesskitError");
    expect(error.message).toBe("failed");
  });

  it("carries the error it reports as its cause", () => {
    expect(new AssesskitError("failed", { cause }).cause).toBe(cause);
  });
});

describe("DataError", () => {
  it("is an AssesskitError", () => {
    const error = new DataError("A seed must be a safe integer, found 1.5.");
    expect(error).toBeInstanceOf(AssesskitError);
    expect(error.name).toBe("DataError");
  });

  it("carries the error it reports as its cause", () => {
    expect(new DataError("The state is not JSON.", { cause }).cause).toBe(cause);
  });
});

describe("ReadError", () => {
  it("carries the issues it was thrown with", () => {
    const error = new ReadError("The document cannot be read.", [issue]);
    expect(error).toBeInstanceOf(AssesskitError);
    expect(error.name).toBe("ReadError");
    expect(error.issues).toEqual([issue]);
  });

  it("carries the error it reports as its cause, and has none unless given one", () => {
    expect(new ReadError("The document cannot be read.", [issue], { cause }).cause).toBe(cause);
    expect("cause" in new ReadError("The document cannot be read.", [issue])).toBe(false);
  });
});

describe("SecurityError", () => {
  it("names the limit and its maximum", () => {
    const error = new SecurityError("The document is larger than 1000 bytes.", "maxBytes", 1000);
    expect(error).toBeInstanceOf(AssesskitError);
    expect(error.name).toBe("SecurityError");
    expect(error.limit).toBe("maxBytes");
    expect(error.maximum).toBe(1000);
  });

  it("carries the error it reports as its cause", () => {
    expect(new SecurityError("The document is larger than 1000 bytes.", "maxBytes", 1000, { cause }).cause).toBe(cause);
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

  it("carries the error it reports as its cause", () => {
    expect(new ProcessingError("The custom operator threw.", "op", { cause }).cause).toBe(cause);
  });
});
