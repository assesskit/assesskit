import { DataError } from "@assesskit/runtime/errors";
import { attributeOf, parseXml } from "@assesskit/runtime/xml";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { EN_MESSAGES } from "../src/index.js";
import { ID_MESSAGES } from "../src/messages/id/index.js";
import { type Lexicon, parseLexicon } from "../src/player/speech/index.js";
import {
  applyDataSsml,
  checkSpeechRequest,
  checkSpeechSettings,
  type Pronounced,
  plainText,
  pronounce,
  readDataSsml,
  speakDocument,
  ssmlElement,
  xmlSafe,
} from "../src/player/speech/internal.js";

/** Parses JSON text, so that a test passes input as JavaScript or JSON delivers it. */
const json = (text: string): unknown => JSON.parse(text);

const PLS = 'xmlns="http://www.w3.org/2005/01/pronunciation-lexicon" version="1.0"';

/** A PLS document with the given lexemes, in the form of the examples of PLS 1.0. */
const lexicon = (lexemes: string, attributes = 'alphabet="ipa" xml:lang="en-US"'): string =>
  `<?xml version="1.0" encoding="UTF-8"?><lexicon ${PLS} ${attributes}>${lexemes}</lexicon>`;

/** The markup between the `speak` tags of an SSML document. */
const inner = (ssml: string): string => ssml.replace(/^[\s\S]*?<speak[^>]*>/u, "").replace(/<\/speak>\s*$/u, "");

/** The text of the pieces that `pronounce` returns, which is the input again. */
const joined = (pieces: readonly (string | Pronounced)[]): string =>
  pieces.map((piece) => (typeof piece === "string" ? piece : piece.text)).join("");

describe("data-ssml", () => {
  const read = (value: string) => readDataSsml(value);

  it("reads the five functions of data-ssml with the values of its examples", () => {
    expect(read('{"say-as":{"interpret-as":"characters"}}')?.get("say-as")).toEqual({ "interpret-as": "characters" });
    expect(read('{"phoneme":{"alphabet":"ipa","ph":"ˈrɛdɪŋ"}}')?.get("phoneme")).toEqual({
      alphabet: "ipa",
      ph: "ˈrɛdɪŋ",
    });
    expect(read('{"sub":{"alias":"messenger RNA"}}')?.get("sub")).toEqual({ alias: "messenger RNA" });
    expect(read('{"break":{"time":"250ms"}}')?.get("break")).toEqual({ time: "250ms" });
    expect(read('{"prosody":{"rate":"slow"}}')?.get("prosody")).toEqual({ rate: "slow" });
  });

  it("reads emphasis, which the example of the best practices guide uses", () => {
    expect(read('{"emphasis":{"level":"strong"}}')?.get("emphasis")).toEqual({ level: "strong" });
  });

  it("reads the break strengths, the alphabets and the rates that data-ssml and SSML 1.1 list", () => {
    for (const strength of ["none", "x-weak", "weak", "medium", "strong", "x-strong"]) {
      expect(read(`{"break":{"strength":"${strength}"}}`), strength).toBeDefined();
    }
    expect(read('{"phoneme":{"ph":"a","alphabet":"x-sampa","type":"ruby"}}')).toBeDefined();
    for (const rate of ["x-slow", "slow", "medium", "fast", "x-fast", "default", "150%", "+20%", "-10%", "50.5%"]) {
      expect(read(`{"prosody":{"rate":"${rate}"}}`), rate).toBeDefined();
    }
  });

  it("gives no effect to a value that data-ssml does not define", () => {
    const invalid = [
      "not json",
      "[]",
      "null",
      "3",
      "{}",
      '{"voice":{"name":"x"}}',
      '{"sub":{"alias":"a","extra":"b"}}',
      '{"sub":{}}',
      '{"sub":{"alias":3}}',
      '{"say-as":{"interpret-as":"currency"}}',
      '{"say-as":{}}',
      '{"phoneme":{"ph":"a","alphabet":"sampa"}}',
      '{"phoneme":{"alphabet":"ipa"}}',
      '{"break":{"strength":"huge"}}',
      '{"prosody":{"rate":"quick"}}',
      '{"prosody":{}}',
      '{"emphasis":{"level":"loud"}}',
      '{"sub":"alias"}',
      '{"sub":{"alias":"a"},"voice":{}}',
    ];
    for (const value of invalid) expect(read(value), value).toBeUndefined();
  });

  it("reads the same value in every serialization of data-ssml", () => {
    const serializations = [
      '<p data-ssml=\'{"sub":{"alias":"x"}}\'/>',
      '<p data-ssml="{&quot;sub&quot;:{&quot;alias&quot;:&quot;x&quot;}}"/>',
      '<p data-ssml="{&#x00022;sub&#x00022;:{&#x00022;alias&#x00022;:&#x00022;x&#x00022;}}"/>',
      '<p data-ssml="{&#34;sub&#34;:{&#34;alias&#34;:&#34;x&#34;}}"/>',
    ];
    const values = serializations.map((xml) => attributeOf(parseXml(xml), "data-ssml") ?? "");
    expect(new Set(values).size).toBe(1);
    expect(read(values[0] ?? "")?.get("sub")).toEqual({ alias: "x" });
  });

  it("wraps the content in the functions, from the outermost prosody to the innermost sub, with a break first", () => {
    const data = read('{"sub":{"alias":"Froyd"},"prosody":{"rate":"slow"},"break":{"time":"2s"}}');
    expect(data).toBeDefined();
    const ssml = speakDocument(
      data === undefined ? [] : applyDataSsml(data, "Freud", [{ kind: "text", value: "Freud" }]),
      "en",
    );
    expect(inner(ssml)).toBe('<break time="2s"/><prosody rate="slow"><sub alias="Froyd">Freud</sub></prosody>');
  });

  it("gives a text function the text of the element, and the others its content", () => {
    const nested = read('{"emphasis":{"level":"strong"}}');
    const content = [ssmlElement("sub", { alias: "a" }, ["b"])];
    const ssml = speakDocument(nested === undefined ? [] : applyDataSsml(nested, "b", content), "en");
    expect(inner(ssml)).toBe('<emphasis level="strong"><sub alias="a">b</sub></emphasis>');
  });
});

describe("parseLexicon", () => {
  it("reads the lexicon of PLS 1.0: the language, the phonemes and the default alphabet", () => {
    const parsed = parseLexicon(lexicon("<lexeme><grapheme>tomato</grapheme><phoneme>təmei̥ɾou̥</phoneme></lexeme>"));
    expect(parsed.language).toBe("en-US");
    expect(parsed.entries.get("tomato")).toEqual({ kind: "phoneme", alphabet: "ipa", ph: "təmei̥ɾou̥" });
  });

  it("reads an alias and the alphabet of a phoneme that differs from the default", () => {
    const parsed = parseLexicon(
      lexicon(
        '<lexeme><grapheme>W3C</grapheme><alias>World Wide Web Consortium</alias></lexeme><lexeme><grapheme>x</grapheme><phoneme alphabet="x-sampa">eks</phoneme></lexeme>',
      ),
    );
    expect(parsed.entries.get("W3C")).toEqual({ kind: "alias", alias: "World Wide Web Consortium" });
    expect(parsed.entries.get("x")).toEqual({ kind: "phoneme", alphabet: "x-sampa", ph: "eks" });
  });

  it("gives every grapheme of a lexeme its pronunciation", () => {
    const parsed = parseLexicon(
      lexicon(
        "<lexeme><grapheme>nihongo</grapheme><grapheme>日本語</grapheme><grapheme>にほんご</grapheme><phoneme>ɲihoŋo</phoneme></lexeme>",
        'alphabet="ipa" xml:lang="ja"',
      ),
    );
    for (const grapheme of ["nihongo", "日本語", "にほんご"]) {
      expect(parsed.entries.get(grapheme), grapheme).toEqual({ kind: "phoneme", alphabet: "ipa", ph: "ɲihoŋo" });
    }
  });

  it("takes the first pronunciation with prefer true, else the first", () => {
    const first = parseLexicon(
      lexicon("<lexeme><grapheme>a</grapheme><phoneme>one</phoneme><phoneme>two</phoneme></lexeme>"),
    );
    expect(first.entries.get("a")).toMatchObject({ ph: "one" });
    const preferred = parseLexicon(
      lexicon(
        '<lexeme><grapheme>a</grapheme><phoneme>one</phoneme><phoneme prefer="true">two</phoneme><alias prefer="true">three</alias></lexeme>',
      ),
    );
    expect(preferred.entries.get("a")).toMatchObject({ ph: "two" });
  });

  it("collects the pronunciations of a grapheme in several lexemes in document order", () => {
    const parsed = parseLexicon(
      lexicon(
        '<lexeme><grapheme>a</grapheme><phoneme>one</phoneme></lexeme><lexeme><grapheme>a</grapheme><phoneme prefer="true">two</phoneme></lexeme>',
      ),
    );
    expect(parsed.entries.get("a")).toMatchObject({ ph: "two" });
  });

  it("leaves out a lexeme with a role, because the player knows no part of speech", () => {
    const parsed = parseLexicon(
      lexicon(
        '<lexeme role="ex:noun"><grapheme>file</grapheme><phoneme>faɪl</phoneme></lexeme><lexeme><grapheme>eu</grapheme><alias>Europe</alias></lexeme>',
      ),
    );
    expect(parsed.entries.has("file")).toBe(false);
    expect(parsed.entries.has("eu")).toBe(true);
  });

  it("reduces white space in a grapheme to a space (PLS 1.0 Appendix C)", () => {
    const parsed = parseLexicon(lexicon("<lexeme><grapheme>New\n   York</grapheme><alias>Nyu Yok</alias></lexeme>"));
    expect(parsed.entries.get("New York")).toEqual({ kind: "alias", alias: "Nyu Yok" });
  });

  it("reads bytes as well as text", () => {
    const bytes = new TextEncoder().encode(lexicon("<lexeme><grapheme>a</grapheme><alias>b</alias></lexeme>"));
    expect(parseLexicon(bytes).entries.get("a")).toEqual({ kind: "alias", alias: "b" });
  });

  it("refuses a document that is not a PLS 1.0 lexicon with an alphabet and a language", () => {
    expect(() => parseLexicon("<lexicon/>")).toThrow(DataError);
    expect(() => parseLexicon(lexicon("").replace(`${PLS}`, PLS.replace("1.0", "2.0")))).toThrow(DataError);
    expect(() => parseLexicon(lexicon("", 'xml:lang="en"'))).toThrow(/alphabet/u);
    expect(() => parseLexicon(lexicon("", 'alphabet="ipa"'))).toThrow(/xml:lang/u);
    expect(() => parseLexicon(JSON.parse("3"))).toThrow(DataError);
  });
});

describe("pronounce", () => {
  const entries = (...pairs: readonly (readonly [string, string])[]): Lexicon => ({
    language: "en-US",
    entries: new Map(pairs.map(([grapheme, alias]) => [grapheme, { kind: "alias" as const, alias }])),
  });

  it("splits a text where an entry matches, and leaves the rest as it is", () => {
    const pieces = pronounce("Read the W3C spec.", "en", [entries(["W3C", "World Wide Web Consortium"])]);
    expect(pieces).toEqual([
      "Read the ",
      { text: "W3C", pronunciation: { kind: "alias", alias: "World Wide Web Consortium" } },
      " spec.",
    ]);
  });

  it("matches whole tokens, not the start of a word (PLS 1.0 Appendix C: do does not match done)", () => {
    expect(pronounce("It is done", "en", [entries(["do", "doo"])])).toEqual(["It is done"]);
  });

  it("prefers the longest sequence of tokens (PLS 1.0 Appendix C: they'll over they)", () => {
    const pieces = pronounce("they'll go", "en", [entries(["they", "x"], ["they'll", "y"])]);
    expect(pieces[0]).toMatchObject({ text: "they'll" });
    expect(pieces[0]).toMatchObject({ pronunciation: { alias: "y" } });
  });

  it("matches the characters exactly: case and accents count (PLS 1.0 Appendix C)", () => {
    const lexicons = [entries(["Lima", "a"], ["cure", "b"], ["vitæ", "c"])];
    expect(pronounce("lima", "en", lexicons)).toEqual(["lima"]);
    expect(pronounce("curé", "en", lexicons)).toEqual(["curé"]);
    expect(pronounce("vitae", "en", lexicons)).toEqual(["vitae"]);
    expect(pronounce("Lima", "en", lexicons)[0]).toMatchObject({ text: "Lima" });
  });

  it("matches a phrase of tokens, whatever the white space between them was (PLS 1.0 Appendix C)", () => {
    const pieces = pronounce("in New York today", "en", [entries(["New York", "nyu york"])]);
    expect(pieces).toEqual([
      "in ",
      { text: "New York", pronunciation: { kind: "alias", alias: "nyu york" } },
      " today",
    ]);
  });

  it("lets an entry leave out the punctuation around a word", () => {
    const pieces = pronounce("(W3C), then", "en", [entries(["W3C", "x"])]);
    expect(pieces).toEqual(["(", { text: "W3C", pronunciation: { kind: "alias", alias: "x" } }, "), then"]);
  });

  it("matches an entry that has punctuation in it as it is written", () => {
    const pieces = pronounce("the U.S.A. team", "en", [entries(["U.S.A.", "usa"])]);
    expect(pieces[1]).toMatchObject({ text: "U.S.A." });
  });

  it("looks in the lexicons in order and uses the first that has the words", () => {
    const pieces = pronounce("a", "en", [entries(["a", "first"]), entries(["a", "second"])]);
    expect(pieces[0]).toMatchObject({ pronunciation: { alias: "first" } });
  });

  it("uses only the lexicons of the language of the text, by the primary subtag", () => {
    const indonesian: Lexicon = { language: "id", entries: new Map([["a", { kind: "alias", alias: "x" }]]) };
    expect(pronounce("a", "id-ID", [indonesian])[0]).toMatchObject({ text: "a" });
    expect(pronounce("a", "en", [indonesian])).toEqual(["a"]);
  });

  it("returns the text when there is no lexicon, or the text is empty", () => {
    expect(pronounce("a b", "en", [])).toEqual(["a b"]);
    expect(pronounce("", "en", [entries(["a", "b"])])).toEqual([]);
  });
});

describe("ssml", () => {
  it("writes a speak element of SSML 1.1 with the language and the paragraphs", () => {
    const ssml = speakDocument([ssmlElement("p", {}, ["Hello"])], "en-US");
    expect(ssml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>\s*<speak /u);
    expect(ssml).toContain('xmlns="http://www.w3.org/2001/10/synthesis"');
    expect(ssml).toContain('version="1.1"');
    expect(ssml).toContain('xml:lang="en-US"');
    expect(inner(ssml)).toBe("<p>Hello</p>");
  });

  it("escapes text and attribute values", () => {
    const ssml = speakDocument([ssmlElement("sub", { alias: 'a "b" <c>' }, ["x & y"])], "en");
    expect(inner(ssml)).toBe('<sub alias="a &quot;b&quot; &lt;c&gt;">x &amp; y</sub>');
  });

  it("leaves out the characters that XML 1.0 does not allow", () => {
    expect(xmlSafe("a\u0000b\u0008c\ud800d\u{1f600}\u000e")).toBe("abcd\u{1f600}");
    expect(inner(speakDocument([ssmlElement("sub", { alias: "a\u0001b" }, ["c\u0002d"])], "en"))).toBe(
      '<sub alias="ab">cd</sub>',
    );
  });

  it("says the alias of a sub, a space for a break, and nothing for a mark", () => {
    const nodes = [
      ssmlElement("p", {}, [
        "Read ",
        ssmlElement("sub", { alias: "World Wide Web" }, ["WWW"]),
        ssmlElement("break", { time: "250ms" }, []),
        ssmlElement("mark", { name: "m" }, []),
        " now.",
      ]),
    ];
    expect(plainText(nodes)).toBe("Read World Wide Web now.");
  });

  it("says the fallback of an audio element, the text of a phoneme, and a line for each paragraph", () => {
    const nodes = [
      ssmlElement("p", {}, [ssmlElement("audio", { src: "https://a.example/x.mp3" }, ["Beep."])]),
      ssmlElement("p", {}, [ssmlElement("phoneme", { ph: "x", alphabet: "ipa" }, ["Reading"])]),
    ];
    expect(plainText(nodes)).toBe("Beep.\nReading");
  });
});

describe("checkSpeechSettings", () => {
  it("accepts the settings of a spoken support as the runtime reads them, and an empty object", () => {
    expect(() =>
      checkSpeechSettings({
        readingType: "computer-read-aloud",
        restrictionTypes: ["directions-only", "ext:iowa-reading"],
        speechRate: 240,
        pitch: 0.5,
        volume: 1,
        linkIndication: "different-voice",
        typingEcho: "characters-and-words",
      }),
    ).not.toThrow();
    expect(() => checkSpeechSettings({})).not.toThrow();
  });

  it("refuses a value outside the vocabulary or the range of PNP", () => {
    const wrong = [
      { readingType: "tts" },
      { restrictionTypes: "directions-only" },
      { restrictionTypes: ["everything"] },
      { speechRate: 0 },
      { speechRate: 1.5 },
      { pitch: 1.5 },
      { volume: -0.1 },
      { linkIndication: "beep" },
      { typingEcho: "letters" },
      { readingType: null },
    ];
    for (const settings of wrong)
      expect(() => checkSpeechSettings(settings), JSON.stringify(settings)).toThrow(DataError);
  });

  it("refuses settings that are not an object", () => {
    for (const settings of [json("null"), json("3"), json('"x"'), json("[]")]) {
      expect(() => checkSpeechSettings(settings)).toThrow(DataError);
    }
  });
});

describe("checkSpeechRequest", () => {
  const request = { ssml: "<speak/>", text: "Hello", lang: "en" };

  it("accepts a request with or without the rate, the pitch and the volume", () => {
    expect(() => checkSpeechRequest(request)).not.toThrow();
    expect(() => checkSpeechRequest({ ...request, rate: 180, pitch: 0.5, volume: 1 })).not.toThrow();
  });

  it("refuses a request that lacks a field or has a field of another type or range", () => {
    const wrong = [
      json("null"),
      { ...request, ssml: 3 },
      { ...request, text: json("null") },
      { ...request, lang: "" },
      { ...request, rate: 0 },
      { ...request, pitch: 2 },
      { ...request, volume: "loud" },
    ];
    for (const value of wrong) expect(() => checkSpeechRequest(value), JSON.stringify(value)).toThrow(DataError);
  });
});

describe("messages", () => {
  it("has the word for a link and the word for a space in English and Indonesian", () => {
    expect([EN_MESSAGES.speechLink, EN_MESSAGES.typingSpace]).toEqual(["link", "space"]);
    expect([ID_MESSAGES.speechLink, ID_MESSAGES.typingSpace]).toEqual(["tautan", "spasi"]);
  });
});

describe("properties", () => {
  it("pronounce returns pieces whose text is the text it was given", () => {
    const words = fc.array(fc.stringMatching(/^[a-zA-Z.'()]{1,6}$/u), { minLength: 0, maxLength: 8 });
    fc.assert(
      fc.property(words, words, (text, graphemes) => {
        const lexicons: Lexicon[] = [
          { language: "en", entries: new Map(graphemes.map((grapheme) => [grapheme, { kind: "alias", alias: "x" }])) },
        ];
        const source = text.join(" ");
        expect(joined(pronounce(source, "en", lexicons))).toBe(source);
      }),
    );
  });

  it("readDataSsml never throws, whatever the string is", () => {
    fc.assert(fc.property(fc.string(), (value) => void readDataSsml(value)));
    fc.assert(fc.property(fc.json(), (value) => void readDataSsml(value)));
  });

  it("xmlSafe leaves a string that XML 1.0 allows as it is, and removes what it does not", () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        const safe = xmlSafe(value);
        expect(xmlSafe(safe)).toBe(safe);
        expect(speakDocument([{ kind: "text", value: safe }], "en")).toBeTypeOf("string");
      }),
    );
  });
});
