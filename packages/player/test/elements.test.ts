import { readAsi } from "@assesskit/runtime/asi";
import { DataError } from "@assesskit/runtime/errors";
import {
  describeInteractions,
  type InteractionDescriptor,
  type ResponseViolation,
} from "@assesskit/runtime/interactions";
import { container, single } from "@assesskit/runtime/values";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { EN_MESSAGES, ID_MESSAGES } from "../src/index.js";
import {
  Board,
  cardinalityOf,
  instructionText,
  pairsOf,
  readInteractionOptions,
  responseOf,
  stringsOf,
  violationText,
} from "../src/player/elements/internal.js";
import { readMediaSettings } from "../src/player/media/index.js";

/** Reads an item and returns the descriptors of its interactions. */
function descriptorsOf(declarations: string, body: string): readonly InteractionDescriptor[] {
  const document = readAsi(
    `<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="i" title="T" adaptive="false" time-dependent="false">${declarations}<qti-item-body>${body}</qti-item-body></qti-assessment-item>`,
  );
  if (document.kind !== "item") throw new Error("The fixture is not an item.");
  return describeInteractions(document.item);
}

const choose = (attributes: string, cardinality = "multiple"): InteractionDescriptor => {
  const [descriptor] = descriptorsOf(
    `<qti-response-declaration identifier="R" cardinality="${cardinality}" base-type="identifier"/>`,
    `<qti-choice-interaction response-identifier="R" ${attributes}><qti-simple-choice identifier="A">a</qti-simple-choice><qti-simple-choice identifier="B">b</qti-simple-choice></qti-choice-interaction>`,
  );
  if (descriptor === undefined) throw new Error("The fixture has no interaction.");
  return descriptor;
};

describe("values", () => {
  it("takes the cardinality of the declaration, else the first that the interaction accepts", () => {
    expect(cardinalityOf(choose('max-choices="1"', "single"))).toBe("single");
    expect(cardinalityOf(choose('max-choices="1"', "multiple"))).toBe("multiple");
    const { declaration, ...undeclared } = choose('max-choices="1"');
    expect(declaration).toBeDefined();
    expect(cardinalityOf(undeclared)).toBe("single");
  });

  it("gives a single value for one identifier of a single variable, a container otherwise, and NULL for none", () => {
    const one = choose('max-choices="1"', "single");
    expect(responseOf(one, "identifier", ["A"])).toEqual(single("identifier", "A"));
    expect(responseOf(one, "identifier", [])).toBeNull();
    const many = choose('max-choices="0"');
    expect(responseOf(many, "identifier", ["A"])).toEqual(container("multiple", "identifier", ["A"]));
    expect(responseOf(many, "identifier", ["A", "B"], true)).toEqual(container("ordered", "identifier", ["A", "B"]));
  });

  it("reads the strings and the pairs of a value, and none from NULL, a record or other types", () => {
    expect(stringsOf(container("multiple", "identifier", ["A", "B"]))).toEqual(["A", "B"]);
    expect(stringsOf(single("integer", 3))).toEqual([]);
    expect(stringsOf(null)).toEqual([]);
    expect(pairsOf(container("multiple", "directedPair", [["A", "B"]]))).toEqual([["A", "B"]]);
    expect(pairsOf(single("identifier", "A"))).toEqual([]);
  });
});

describe("hints", () => {
  const Reasons: readonly (readonly [ResponseViolation, string])[] = [
    ["binding", EN_MESSAGES.hintInvalid],
    ["unknown-choice", EN_MESSAGES.hintInvalid],
    ["repeated-choice", EN_MESSAGES.hintInvalid],
    ["bounds", EN_MESSAGES.hintInvalid],
    ["step", EN_MESSAGES.hintInvalid],
    ["required", EN_MESSAGES.hintRequired],
    ["match-min", EN_MESSAGES.hintMatchMin],
    ["match-max", EN_MESSAGES.hintMatchMax],
    ["match-group", EN_MESSAGES.hintMatchGroup],
    ["pattern-mask", EN_MESSAGES.hintPatternMask],
  ];

  it("has a text for every rule that a response can break, so that no hint is empty", () => {
    const descriptor = choose('max-choices="3" min-choices="2"');
    const every: readonly ResponseViolation[] = [
      ...Reasons.map(([reason]) => reason),
      "min-choices",
      "max-choices",
      "min-associations",
      "max-associations",
      "min-strings",
      "max-strings",
      "min-plays",
      "max-plays",
      "mime-type",
    ];
    for (const messages of [EN_MESSAGES, ID_MESSAGES]) {
      for (const reason of every) expect(violationText(reason, descriptor, messages).trim(), reason).not.toBe("");
    }
  });

  it("says how to fix a response in words that name the limit", () => {
    const descriptor = choose('max-choices="3" min-choices="2"');
    expect(violationText("min-choices", descriptor, EN_MESSAGES)).toBe("Select at least 2.");
    expect(violationText("max-choices", descriptor, EN_MESSAGES)).toBe("Select at most 3.");
    expect(violationText("max-choices", descriptor, ID_MESSAGES)).toBe("Pilih paling banyak 3.");
    for (const [reason, text] of Reasons) expect(violationText(reason, descriptor, EN_MESSAGES), reason).toBe(text);
  });

  it("prefers the text of the item for the rules that it has a text for", () => {
    const descriptor = choose('max-choices="3" min-choices="2"');
    const custom = { min: "Too few", max: "Too many", pattern: "Wrong form" };
    expect(violationText("min-choices", descriptor, EN_MESSAGES, custom)).toBe("Too few");
    expect(violationText("max-choices", descriptor, EN_MESSAGES, custom)).toBe("Too many");
    expect(violationText("pattern-mask", descriptor, EN_MESSAGES, custom)).toBe("Wrong form");
    expect(violationText("required", descriptor, EN_MESSAGES, custom)).toBe(EN_MESSAGES.hintRequired);
  });

  it("counts the choices that an order puts in places, all of them unless min-choices says otherwise", () => {
    const [order] = descriptorsOf(
      `<qti-response-declaration identifier="R" cardinality="ordered" base-type="identifier"/>`,
      `<qti-order-interaction response-identifier="R"><qti-simple-choice identifier="A">a</qti-simple-choice><qti-simple-choice identifier="B">b</qti-simple-choice><qti-simple-choice identifier="C">c</qti-simple-choice></qti-order-interaction>`,
    );
    if (order === undefined) throw new Error("The fixture has no interaction.");
    expect(violationText("min-choices", order, EN_MESSAGES)).toBe("Place at least 3.");
    expect(violationText("max-choices", order, EN_MESSAGES)).toBe("Place at most 3.");
  });

  it("tells the limits that the candidate cannot guess, and none for a limit of one", () => {
    expect(instructionText(choose('max-choices="3" min-choices="2"'), EN_MESSAGES)).toBe(
      "Select at least 2. Select at most 3.",
    );
    expect(instructionText(choose('max-choices="1" min-choices="1"', "single"), EN_MESSAGES)).toBe("");
    expect(instructionText(choose('max-choices="0"'), EN_MESSAGES)).toBe("");
  });

  it("tells the associations and the texts that an interaction asks for", () => {
    const [associate] = descriptorsOf(
      `<qti-response-declaration identifier="R" cardinality="multiple" base-type="pair"/>`,
      `<qti-associate-interaction response-identifier="R" min-associations="2" max-associations="4"><qti-simple-associable-choice identifier="A" match-max="1">a</qti-simple-associable-choice></qti-associate-interaction>`,
    );
    if (associate === undefined) throw new Error("The fixture has no interaction.");
    expect(instructionText(associate, EN_MESSAGES)).toBe("Make at least 2. Make at most 4.");
    const [text] = descriptorsOf(
      `<qti-response-declaration identifier="R" cardinality="ordered" base-type="string"/>`,
      `<qti-extended-text-interaction response-identifier="R" min-strings="2" max-strings="3"/>`,
    );
    if (text === undefined) throw new Error("The fixture has no interaction.");
    expect(instructionText(text, EN_MESSAGES)).toBe("Enter at least 2. Enter at most 3.");
  });
});

describe("Board", () => {
  const sources = [
    { id: "A", limit: 1 },
    { id: "B", limit: 2 },
    { id: "C", limit: Number.POSITIVE_INFINITY },
  ];
  const places = [
    { id: "p", capacity: 1 },
    { id: "q", capacity: 2 },
    { id: "r", capacity: Number.POSITIVE_INFINITY },
  ];

  it("puts a choice from the pool in a place, and counts the uses that are left", () => {
    const board = new Board(sources, places);
    expect(board.put("A", "p")).toBe(true);
    expect(board.occupants("p")).toEqual(["A"]);
    expect(board.remaining("A")).toBe(0);
    expect(board.put("A", "q")).toBe(false);
    expect(board.put("B", "q")).toBe(true);
    expect(board.put("B", "r")).toBe(true);
    expect(board.remaining("B")).toBe(0);
    expect(board.remaining("C")).toBe(Number.POSITIVE_INFINITY);
  });

  it("moves a choice from one place to another, and replaces the first choice of a place that is full", () => {
    const board = new Board(sources, places);
    board.put("A", "p");
    expect(board.put("A", "q", "p")).toBe(true);
    expect(board.occupants("p")).toEqual([]);
    expect(board.occupants("q")).toEqual(["A"]);
    board.put("C", "p");
    expect(board.put("B", "p")).toBe(true);
    expect(board.occupants("p")).toEqual(["B"]);
    expect(board.remaining("C")).toBe(Number.POSITIVE_INFINITY);
  });

  it("takes a choice out of a place, and refuses what is not there", () => {
    const board = new Board(sources, places);
    board.put("A", "p");
    expect(board.take("A", "p")).toBe(true);
    expect(board.take("A", "p")).toBe(false);
    expect(board.remaining("A")).toBe(1);
  });

  it("leaves out an unknown place, an unknown choice and a move to the place that holds the choice", () => {
    const board = new Board(sources, places);
    board.put("A", "p");
    expect(board.put("A", "nowhere")).toBe(false);
    expect(board.put("Z", "p")).toBe(false);
    expect(board.put("A", "p", "p")).toBe(false);
    expect(board.put("A", "q", "r")).toBe(false);
    expect(board.assignments()).toEqual([["p", "A"]]);
  });

  it("lists the choices by place in the order of the places", () => {
    const board = new Board(sources, places);
    board.put("C", "r");
    board.put("B", "q");
    board.put("A", "p");
    expect(board.assignments()).toEqual([
      ["p", "A"],
      ["q", "B"],
      ["r", "C"],
    ]);
  });

  it("loads assignments and leaves out those past what a place or a choice allows", () => {
    const board = new Board(sources, places);
    board.load([
      ["p", "A"],
      ["p", "C"],
      ["q", "A"],
      ["q", "B"],
      ["zz", "B"],
      ["r", "Z"],
    ]);
    expect(board.assignments()).toEqual([
      ["p", "A"],
      ["q", "B"],
    ]);
    board.load([]);
    expect(board.assignments()).toEqual([]);
  });

  it("never holds more in a place than it takes, nor uses a choice more than its limit, after any moves", () => {
    const moves = fc.array(
      fc.record({
        kind: fc.constantFrom("put", "move", "take"),
        source: fc.constantFrom("A", "B", "C", "Z"),
        place: fc.constantFrom("p", "q", "r", "none"),
        from: fc.constantFrom("p", "q", "r", undefined),
      }),
      { maxLength: 60 },
    );
    fc.assert(
      fc.property(moves, (list) => {
        const board = new Board(sources, places);
        for (const { kind, source, place, from } of list) {
          if (kind === "put") board.put(source, place);
          else if (kind === "move") board.put(source, place, from);
          else board.take(source, place);
        }
        for (const place of places) expect(board.occupants(place.id).length).toBeLessThanOrEqual(place.capacity);
        for (const source of sources) expect(board.remaining(source.id)).toBeGreaterThanOrEqual(0);
        const again = new Board(sources, places);
        again.load(board.assignments());
        expect(again.assignments()).toEqual(board.assignments());
      }),
    );
  });
});

describe("readInteractionOptions", () => {
  const Files = {
    upload: () => Promise.resolve({ reference: "r", mimeType: "image/png" }),
    url: () => "u",
    reserve: () => Promise.resolve({ reference: "r", mimeType: "audio/webm" }),
    fill: () => Promise.resolve(),
  };
  const valid = (extra: object = {}): unknown => ({
    messages: EN_MESSAGES,
    files: Files,
    staticUrl: "https://static.example/player/",
    ...extra,
  });

  it("resolves the worklet below the static URL and defaults the recording to on", () => {
    const settings = readInteractionOptions(valid());
    expect(settings.workletUrl).toBe("https://static.example/player/recorder-worklet.js");
    expect(settings.record).toBe(true);
    expect(settings.customInteraction).toBeUndefined();
  });

  it("gives back the file value that the host stores, and checks it", async () => {
    const settings = readInteractionOptions(valid());
    expect(await settings.files.upload(new Blob(["x"]), "image/png", "a.png")).toEqual({
      reference: "r",
      mimeType: "image/png",
    });
    const bad = readInteractionOptions(valid({ files: { ...Files, upload: () => Promise.resolve("r") } }));
    await expect(bad.files.upload(new Blob(["x"]), "image/png")).rejects.toThrow(
      new DataError('The method upload of the option files must give a file value, found "r".'),
    );
    const noUrl = readInteractionOptions(valid({ files: { ...Files, url: () => 3 } }));
    expect(() => noUrl.files.url({ reference: "r", mimeType: "image/png" })).toThrow(
      new DataError("The URL that the method url of the option files returned must be a string, found 3."),
    );
  });

  it("names a file before its bytes come, checks the file value, and passes the options of the call on", async () => {
    const calls: unknown[][] = [];
    const settings = readInteractionOptions(
      valid({
        files: {
          ...Files,
          reserve: (...args: unknown[]) => {
            calls.push(["reserve", ...args]);
            return Promise.resolve({ reference: "r", mimeType: "audio/webm" });
          },
          fill: (...args: unknown[]) => {
            calls.push(["fill", ...args]);
            return Promise.resolve();
          },
        },
      }),
    );
    const signal = new AbortController().signal;
    expect(await settings.files.reserve?.("audio/webm", "recording.webm", { signal })).toEqual({
      reference: "r",
      mimeType: "audio/webm",
    });
    const bytes = new Blob(["x"]);
    await settings.files.fill?.({ reference: "r", mimeType: "audio/webm" }, bytes, { signal });
    expect(calls).toEqual([
      ["reserve", "audio/webm", "recording.webm", { signal }],
      ["fill", { reference: "r", mimeType: "audio/webm" }, bytes, { signal }],
    ]);
    const bad = readInteractionOptions(valid({ files: { ...Files, reserve: () => Promise.resolve(3) } }));
    await expect(bad.files.reserve?.("audio/webm")).rejects.toThrow(
      new DataError("The method reserve of the option files must give a file value, found 3."),
    );
  });

  it("needs reserve and fill to record, and asks for neither when the recording is off", () => {
    const { upload, url } = Files;
    expect(() => readInteractionOptions(valid({ files: { upload, url } }))).toThrow(
      new DataError(
        "The method reserve of the option files must be a function unless the option record is false, found undefined.",
      ),
    );
    expect(() => readInteractionOptions(valid({ files: { upload, url, reserve: Files.reserve } }))).toThrow(
      /The method fill of the option files/,
    );
    const off = readInteractionOptions(valid({ files: { upload, url }, record: false }));
    expect(off.files.reserve).toBeUndefined();
    expect(off.files.fill).toBeUndefined();
  });

  it("reports an error that a recording can only report to the option onError, else to the page", () => {
    const heard: unknown[] = [];
    const error = new Error("The store is down.");
    readInteractionOptions(valid({ onError: (each: unknown) => heard.push(each) })).report(error);
    expect(heard).toEqual([error]);
    expect(() => readInteractionOptions(valid({ onError: JSON.parse("5") }))).toThrow(
      new DataError("The option onError must be a function, found 5."),
    );
    const raised: unknown[] = [];
    const original = globalThis.reportError;
    globalThis.reportError = (each: unknown) => void raised.push(each);
    try {
      readInteractionOptions(valid()).report(error);
    } finally {
      globalThis.reportError = original;
    }
    expect(raised).toEqual([error]);
  });

  it("checks what the hook of a custom interaction returns", () => {
    const settings = readInteractionOptions(valid({ customInteraction: () => 5 }));
    const mount = settings.customInteraction;
    if (mount === undefined) throw new Error("The settings have no hook.");
    expect(() => mount(JSON.parse("{}"), JSON.parse("{}"), () => undefined, { value: null, disabled: false })).toThrow(
      new DataError("The value that the option customInteraction returned must be a function, found 5."),
    );
  });

  it("rejects options of other types as JavaScript or JSON gives them", () => {
    const parse = (json: string): unknown => JSON.parse(json);
    expect(() => readInteractionOptions(parse("null"))).toThrow(
      new DataError("The options must be an object, found null."),
    );
    expect(() => readInteractionOptions(parse("[]"))).toThrow(
      new DataError("The options must be an object, found an array."),
    );
    expect(() => readInteractionOptions(valid({ messages: parse("5") }))).toThrow(DataError);
    expect(() => readInteractionOptions(valid({ files: parse("null") }))).toThrow(
      new DataError("The option files must be an object, found null."),
    );
    expect(() => readInteractionOptions(valid({ files: { ...Files, upload: 1 } }))).toThrow(
      new DataError("The method upload of the option files must be a function, found 1."),
    );
    expect(() => readInteractionOptions(valid({ record: parse('"yes"') }))).toThrow(
      new DataError('The option record must be a boolean, found "yes".'),
    );
    expect(() => readInteractionOptions(valid({ customInteraction: parse("5") }))).toThrow(
      new DataError("The option customInteraction must be a function, found 5."),
    );
    expect(() => readInteractionOptions(valid({ colour: 1 }))).toThrow(DataError);
  });

  it("requires a static URL that is absolute, http or https, and ends in a slash", () => {
    for (const staticUrl of ["", "static/", "ftp://static.example/", "https://static.example/player", 5, null]) {
      expect(() => readInteractionOptions(valid({ staticUrl })), String(staticUrl)).toThrow(DataError);
    }
    expect(() => readInteractionOptions(valid({ staticUrl: "http://localhost:3000/" }))).not.toThrow();
  });
});

describe("readMediaSettings", () => {
  /** Reads the settings of a media interaction with the given attributes. */
  function settingsOf(attributes: string) {
    const document = readAsi(
      `<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="i" title="T" adaptive="false" time-dependent="false"><qti-response-declaration identifier="R" cardinality="single" base-type="integer"/><qti-item-body><qti-media-interaction response-identifier="R" autostart="false" ${attributes}><audio><source src="a.mp3" type="audio/mpeg"/></audio></qti-media-interaction></qti-item-body></qti-assessment-item>`,
    );
    const node = document.kind === "item" ? document.item.body?.children[0] : undefined;
    if (node?.kind !== "media-interaction") throw new Error("The fixture has no media interaction.");
    return readMediaSettings(node);
  }

  it("reads the pause attributes in the spelling with data- and the spelling without it", () => {
    const withData = settingsOf(
      'data-qti-media-player-pause-delay="2" data-qti-media-player-pause-duration="1.5" data-qti-media-player-pause-count="3"',
    );
    const without = settingsOf(
      'qti-media-player-pause-delay="2" qti-media-player-pause-duration="1.5" qti-media-player-pause-count="3"',
    );
    expect(withData).toEqual({
      controls: new Set(["rewind", "captions", "audioDescription"]),
      pauseDelay: 2,
      pauseDuration: 1.5,
      pauseCount: 3,
    });
    expect(without).toEqual(withData);
  });

  it("ignores a value that is not a number above zero, and rounds a count down", () => {
    const settings = settingsOf(
      'data-qti-media-player-pause-delay="0" qti-media-player-pause-duration="-2" data-qti-media-player-pause-count="2.9"',
    );
    expect(settings).toEqual({ controls: new Set(["rewind", "captions", "audioDescription"]), pauseCount: 2 });
    expect(settingsOf('data-qti-media-player-pause-delay=""')).not.toHaveProperty("pauseDelay");
    expect(settingsOf('data-qti-media-player-pause-delay="soon"')).not.toHaveProperty("pauseDelay");
  });

  it("reads the controls: all for none given or default, those that are named, and none for none", () => {
    const all = new Set(["rewind", "captions", "audioDescription"]);
    expect(settingsOf("").controls).toEqual(all);
    expect(settingsOf('data-qti-media-player-controls="default"').controls).toEqual(all);
    expect(settingsOf('data-qti-media-player-controls="play captions"').controls).toEqual(new Set(["captions"]));
    expect(settingsOf('data-qti-media-player-controls="rewind, audioDescription"').controls).toEqual(
      new Set(["rewind", "audioDescription"]),
    );
    expect(settingsOf('data-qti-media-player-controls="none"').controls).toEqual(new Set());
  });
});
