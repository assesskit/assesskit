import { DataError } from "@assesskit/runtime/errors";
import { describe, expect, it } from "vitest";
import { EN_MESSAGES, ID_MESSAGES, type Messages, selectMessages } from "../src/index.js";
import { fuzzJson } from "./fuzz.js";

/** Passes overrides to `selectMessages` as JSON delivers them, which TypeScript does not check. */
const select = (language: string, overrides: unknown = {}): Messages =>
  selectMessages(language, JSON.parse(JSON.stringify(overrides)));

describe("the catalogs", () => {
  const keys = Object.keys(EN_MESSAGES);

  it("has the same keys in English and Indonesian", () => {
    expect(Object.keys(ID_MESSAGES)).toEqual(keys);
  });

  it("has a message of text in every key, and none of markup", () => {
    for (const catalog of [EN_MESSAGES, ID_MESSAGES]) {
      for (const [key, text] of Object.entries(catalog)) {
        expect(text.trim(), key).not.toBe("");
        expect(text, key).not.toMatch(/[<>&]/);
      }
    }
  });

  it("[SC 3.2.4] gives each function one key: no two messages of a catalog have the same text", () => {
    for (const catalog of [EN_MESSAGES, ID_MESSAGES]) {
      const texts = Object.values(catalog).map((text) => text.toLowerCase());
      expect(new Set(texts).size).toBe(texts.length);
    }
  });
});

describe("selectMessages", () => {
  it("[T97] chooses the catalog of the language of the interface", () => {
    expect(select("en")).toEqual(EN_MESSAGES);
    expect(select("id")).toEqual(ID_MESSAGES);
    expect(select("id").interactiveQuestion).toBe("Soal interaktif");
  });

  it("[T97] chooses by the language of a tag with a region or a script, and ignores case", () => {
    expect(select("id-ID")).toEqual(ID_MESSAGES);
    expect(select("ID")).toEqual(ID_MESSAGES);
    expect(select("en-GB")).toEqual(EN_MESSAGES);
    expect(select("id-Latn-ID")).toEqual(ID_MESSAGES);
  });

  it("[T97] gives English for a language without a catalog, and for the empty tag", () => {
    expect(select("jv")).toEqual(EN_MESSAGES);
    expect(select("")).toEqual(EN_MESSAGES);
  });

  it("replaces messages by the overrides of the language", () => {
    const messages = select("id", { id: { toolRule: "Mistar" } });
    expect(messages.toolRule).toBe("Mistar");
    expect(messages.toolProtractor).toBe(ID_MESSAGES.toolProtractor);
  });

  it("completes a language that has only some messages from English", () => {
    const messages = select("jv", { jv: { toolRule: "Penggaris Jawa" } });
    expect(messages.toolRule).toBe("Penggaris Jawa");
    expect(messages.toolProtractor).toBe(EN_MESSAGES.toolProtractor);
  });

  it("prefers the overrides of the whole tag to those of its language", () => {
    const overrides = { id: { toolRule: "Mistar" }, "id-ID": { toolRule: "Penggaris kelas" } };
    expect(select("id-ID", overrides).toolRule).toBe("Penggaris kelas");
    expect(select("id", overrides).toolRule).toBe("Mistar");
    expect(select("ID-id", overrides).toolRule).toBe("Penggaris kelas");
  });

  it("does not change the shipped catalogs", () => {
    select("id", { id: { toolRule: "Mistar" } });
    expect(ID_MESSAGES.toolRule).toBe("Penggaris");
  });

  it("treats a language named __proto__ as a language without a catalog", () => {
    expect(select("__proto__")).toEqual(EN_MESSAGES);
    expect(selectMessages("__proto__", JSON.parse('{"__proto__":{"toolRule":"x"}}')).toolRule).toBe("x");
  });

  it("rejects a language that is not a string", () => {
    for (const text of ["null", "5", "[]"]) {
      expect(() => selectMessages(JSON.parse(text))).toThrow(/^The language must be a string, found /);
    }
  });

  it("rejects overrides that are not an object of catalogs of strings", () => {
    expect(() => selectMessages("id", JSON.parse("null"))).toThrow(
      new DataError("The overrides is invalid: expected an object, found null."),
    );
    expect(() => select("id", { id: [] })).toThrow(
      new DataError('The overrides is invalid: the property "id" is invalid: expected an object, found an array.'),
    );
    expect(() => select("id", { id: { toolRule: 5 } })).toThrow(
      new DataError('The overrides is invalid: the property "id" at toolRule is invalid: expected a string, found 5.'),
    );
  });

  it("rejects a message key that the catalog does not have", () => {
    expect(() => select("id", { id: { toolRulers: "x" } })).toThrow(
      new DataError('The overrides is invalid: the property "id" is invalid: unexpected property "toolRulers".'),
    );
  });

  it("checks the overrides of every language, not only the chosen one", () => {
    expect(() => select("en", { jv: { toolRule: 5 } })).toThrow(DataError);
  });

  it("reads or refuses arbitrary JSON overrides with a DataError, and nothing else", () => {
    fuzzJson(
      (overrides) => selectMessages("id", overrides as Record<string, Partial<Messages>>),
      [{}, { id: { toolRule: "Penggaris" }, "id-ID": {} }],
    );
  });
});
