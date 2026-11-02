import { DataError } from "@assesskit/runtime/errors";
import { describe, expect, it } from "vitest";
import messagesGuide from "../../../docs/player/messages.md?raw";
import { EN_MESSAGES, type Messages, selectMessages } from "../src/index.js";
import { ID_MESSAGES } from "../src/messages/id/index.js";
import { fuzzJson } from "./fuzz.js";
import { runGuideSamples } from "./guide-samples.js";

/** Passes catalogs to `selectMessages` as JSON delivers them, which TypeScript does not check. */
const select = (language: string, catalogs: unknown = {}): Messages =>
  selectMessages(language, JSON.parse(JSON.stringify(catalogs)));

/** The catalog of Indonesian, which a host imports from its module and gives to `selectMessages`. */
const INDONESIAN = { id: ID_MESSAGES };

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

  it("names each function the same way everywhere: no two messages of a catalog have the same text", () => {
    for (const catalog of [EN_MESSAGES, ID_MESSAGES]) {
      const texts = Object.values(catalog).map((text) => text.toLowerCase());
      expect(new Set(texts).size).toBe(texts.length);
    }
  });
});

describe("selectMessages", () => {
  it("gives the English messages for English, and for a language that the host gives no catalog for", () => {
    expect(select("en")).toEqual(EN_MESSAGES);
    expect(select("id")).toEqual(EN_MESSAGES);
  });

  it("chooses the catalog that the host gives for the language of the interface", () => {
    expect(select("en", INDONESIAN)).toEqual(EN_MESSAGES);
    expect(select("id", INDONESIAN)).toEqual(ID_MESSAGES);
    expect(select("id", INDONESIAN).interactiveQuestion).toBe("Soal interaktif");
  });

  it("chooses by the language of a tag with a region or a script, and ignores case", () => {
    expect(select("id-ID", INDONESIAN)).toEqual(ID_MESSAGES);
    expect(select("ID", INDONESIAN)).toEqual(ID_MESSAGES);
    expect(select("en-GB", INDONESIAN)).toEqual(EN_MESSAGES);
    expect(select("id-Latn-ID", INDONESIAN)).toEqual(ID_MESSAGES);
  });

  it("gives English for a language without a catalog, and for the empty tag", () => {
    expect(select("jv", INDONESIAN)).toEqual(EN_MESSAGES);
    expect(select("", INDONESIAN)).toEqual(EN_MESSAGES);
  });

  it("replaces messages of the catalog of a language by those of a catalog for the same language", () => {
    const messages = select("id", { id: { ...ID_MESSAGES, toolRule: "Mistar" } });
    expect(messages.toolRule).toBe("Mistar");
    expect(messages.toolProtractor).toBe(ID_MESSAGES.toolProtractor);
  });

  it("completes a language that has only some messages from English", () => {
    const messages = select("jv", { jv: { toolRule: "Penggaris Jawa" } });
    expect(messages.toolRule).toBe("Penggaris Jawa");
    expect(messages.toolProtractor).toBe(EN_MESSAGES.toolProtractor);
  });

  it("prefers the catalog of the whole tag to that of its language", () => {
    const catalogs = { id: ID_MESSAGES, "id-ID": { toolRule: "Penggaris kelas" } };
    expect(select("id-ID", catalogs).toolRule).toBe("Penggaris kelas");
    expect(select("id-ID", catalogs).toolProtractor).toBe(ID_MESSAGES.toolProtractor);
    expect(select("id", catalogs).toolRule).toBe("Penggaris");
    expect(select("ID-id", catalogs).toolRule).toBe("Penggaris kelas");
  });

  it("does not change the catalogs it is given", () => {
    select("id", { id: { toolRule: "Mistar" } });
    selectMessages("id", INDONESIAN);
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

  it("rejects catalogs that are not an object of catalogs of strings", () => {
    expect(() => selectMessages("id", JSON.parse("null"))).toThrow(
      new DataError("The catalogs is invalid: expected an object, found null."),
    );
    expect(() => select("id", { id: [] })).toThrow(
      new DataError('The catalogs is invalid: the property "id" is invalid: expected an object, found an array.'),
    );
    expect(() => select("id", { id: { toolRule: 5 } })).toThrow(
      new DataError('The catalogs is invalid: the property "id" at toolRule is invalid: expected a string, found 5.'),
    );
  });

  it("rejects a message key that the catalog does not have", () => {
    expect(() => select("id", { id: { toolRulers: "x" } })).toThrow(
      new DataError('The catalogs is invalid: the property "id" is invalid: unexpected property "toolRulers".'),
    );
  });

  it("checks the catalogs of every language, not only the chosen one", () => {
    expect(() => select("en", { jv: { toolRule: 5 } })).toThrow(DataError);
  });

  it("reads or refuses arbitrary JSON catalogs with a DataError, and nothing else", () => {
    fuzzJson(
      (catalogs) => selectMessages("id", catalogs as Record<string, Partial<Messages>>),
      [{}, { id: { toolRule: "Penggaris" }, "id-ID": {} }],
    );
  });
});

describe("the guide", () => {
  it("shows the results that its samples give", async () => {
    expect(
      await runGuideSamples(messagesGuide, {
        "@assesskit/player": await import("../src/index.js"),
        "@assesskit/player/messages/id": await import("../src/messages/id/index.js"),
      }),
    ).toBeGreaterThan(0);
  });
});
