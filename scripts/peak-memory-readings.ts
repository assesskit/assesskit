import { deflateRawSync, crc32 as nodeCrc32 } from "node:zlib";
import { createCatRestHandler } from "../packages/player/src/cat-rest/index.ts";
import {
  AssesskitError,
  compileXsdRegex,
  createRandom,
  parseXml,
  planTest,
  RESULTS_NAMESPACE,
  readAsi,
  readCandidateAction,
  readManifest,
  readModuleResolution,
  readPackage,
  readResults,
  readUsageData,
  resolveStructure,
  SecurityError,
  USAGE_NAMESPACE,
  validateAsi,
} from "../packages/runtime/src/index.ts";

/** The bytes of one MiB. */
const MIB = 1024 * 1024;

/** The default `maxBytes` of an XML document and `maxBodyBytes` of a request. */
const XML_BYTES = 32 * MIB;

/**
 * A reading of untrusted input on its worst input within the limits: what it reads, made before the reading, and the reading,
 * which says what it returned or what it threw. A large input is made in bytes outside the heap, so that it adds nothing to it.
 */
export interface Reading {
  readonly input: () => unknown;
  readonly read: (input: never) => Promise<string> | string;
}

/** What a reading threw: the limit of a `SecurityError`, or the class and the sentence of another error of the package. */
function thrown(error: unknown): string {
  if (error instanceof SecurityError) return `SecurityError ${error.limit}`;
  if (error instanceof AssesskitError) return `${error.name}: ${error.message}`;
  throw error;
}

/** Runs a reading that is to throw, and says what it threw. */
async function refusal(read: () => unknown): Promise<string> {
  try {
    await read();
  } catch (error) {
    return thrown(error);
  }
  return "no error";
}

/**
 * The bytes of `opening`, then `unit` `count` times, then `closing`, in one buffer filled in place, so that the heap holds no
 * string of the document.
 */
function repeated(opening: string, unit: string, count: number, closing: string): Uint8Array {
  const open = Buffer.byteLength(opening);
  const each = Buffer.byteLength(unit);
  const bytes = Buffer.allocUnsafe(open + each * count + Buffer.byteLength(closing));
  bytes.write(opening, 0);
  bytes.fill(unit, open, open + each * count);
  bytes.write(closing, open + each * count);
  return bytes;
}

/**
 * The bytes of `opening`, then `unit(0)`, `unit(1)` and so on for as long as the document stays within `limit` bytes with the
 * `closing`, in one buffer: for the units that differ, such as the identifiers, which only a count can tell apart.
 *
 * @returns The bytes and the number of units.
 */
function numbered(
  opening: string,
  unit: (index: number) => string,
  closing: string,
  limit = XML_BYTES,
): { readonly bytes: Uint8Array; readonly count: number } {
  const bytes = Buffer.allocUnsafe(limit);
  let offset = bytes.write(opening, 0);
  const reserved = Buffer.byteLength(closing);
  let count = 0;
  for (;;) {
    const next = unit(count);
    if (offset + Buffer.byteLength(next) + reserved > limit) break;
    offset += bytes.write(next, offset);
    count += 1;
  }
  offset += bytes.write(closing, offset);
  return { bytes: bytes.subarray(0, offset), count };
}

const ASI = 'xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0"';
const ITEM = `<qti-assessment-item ${ASI} identifier="i" title="t" adaptive="false" time-dependent="false">`;
const CP = 'xmlns="http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1"';

/** A manifest of resources `numbered` makes, as bytes. */
const manifestOf = (resources: number, within = XML_BYTES) =>
  numbered(
    `<manifest ${CP} identifier="m"><metadata><schema>QTI Package</schema><schemaversion>3.0.0</schemaversion></metadata><organizations/><resources>`,
    (index) =>
      `<resource identifier="r${index}" type="imsqti_item_xmlv3p0" href="r${index}.xml"><file href="r${index}.xml"/></resource>`,
    "</resources></manifest>",
    Math.min(within, resources * 120),
  );

/** An entry of the archive that {@link archiveOf} writes: the bytes as stored, and what the headers declare of them. */
interface Entry {
  readonly name: string;
  /** The bytes as stored: the file itself when `method` is 0, its deflated form when it is 8. */
  readonly stored: Uint8Array;
  readonly method: 0 | 8;
  /** The bytes of the file, which the headers declare, with the CRC-32 of the file. */
  readonly size: number;
  readonly crc: number;
}

/**
 * An archive of `count` entries, written in place into one buffer (local headers, the data, the central directory and the end
 * record), so that the heap holds no object for an entry. The count of the end record wraps at 16 bits, as an archive of
 * more entries is written, and the directory holds them all.
 */
function archiveOf(count: number, entryAt: (index: number) => Entry, size: number): Uint8Array {
  const buffer = Buffer.allocUnsafe(size);
  const offsets = new Uint32Array(count);
  let offset = 0;
  for (let index = 0; index < count; index++) {
    const { name, stored, method, size: length, crc } = entryAt(index);
    offsets[index] = offset;
    buffer.writeUInt32LE(0x04034b50, offset);
    buffer.writeUInt16LE(20, offset + 4);
    buffer.writeUInt16LE(0, offset + 6);
    buffer.writeUInt16LE(method, offset + 8);
    buffer.writeUInt32LE(0, offset + 10);
    buffer.writeUInt32LE(crc, offset + 14);
    buffer.writeUInt32LE(stored.length, offset + 18);
    buffer.writeUInt32LE(length, offset + 22);
    buffer.writeUInt16LE(Buffer.byteLength(name), offset + 26);
    buffer.writeUInt16LE(0, offset + 28);
    offset += 30 + buffer.write(name, offset + 30);
    buffer.set(stored, offset);
    offset += stored.length;
  }
  const directory = offset;
  for (let index = 0; index < count; index++) {
    const { name, stored, method, size: length, crc } = entryAt(index);
    buffer.writeUInt32LE(0x02014b50, offset);
    buffer.writeUInt16LE(20, offset + 4);
    buffer.writeUInt16LE(20, offset + 6);
    buffer.writeUInt16LE(0, offset + 8);
    buffer.writeUInt16LE(method, offset + 10);
    buffer.writeUInt32LE(0, offset + 12);
    buffer.writeUInt32LE(crc, offset + 16);
    buffer.writeUInt32LE(stored.length, offset + 20);
    buffer.writeUInt32LE(length, offset + 24);
    buffer.writeUInt16LE(Buffer.byteLength(name), offset + 28);
    buffer.fill(0, offset + 30, offset + 42);
    buffer.writeUInt32LE(offsets[index] ?? 0, offset + 42);
    offset += 46 + buffer.write(name, offset + 46);
  }
  buffer.writeUInt32LE(0x06054b50, offset);
  buffer.writeUInt32LE(0, offset + 4);
  buffer.writeUInt16LE(count % 65_536, offset + 8);
  buffer.writeUInt16LE(count % 65_536, offset + 10);
  buffer.writeUInt32LE(offset - directory, offset + 12);
  buffer.writeUInt32LE(directory, offset + 16);
  buffer.writeUInt16LE(0, offset + 20);
  return buffer.subarray(0, offset + 22);
}

/** The text of a body of JSON with `tokens` tokens of empty objects, padded with white space to `bytes` bytes. */
function emptyObjects(tokens: number, bytes: number): string {
  const objects = Math.floor((tokens - 1) / 3);
  const gap = Math.floor((bytes - 2 - 3 * objects) / objects);
  return `[${`{},${" ".repeat(gap - 1)}`.repeat(objects - 1)}{}]`;
}

/** A `support-settings` action whose font list has `names` empty names. */
const settingsOf = (names: number) => ({
  type: "support-settings",
  settings: {
    name: "text-appearance",
    replaceAccessModes: [],
    fontFace: { fontNames: new Array<string>(names).fill("") },
  },
});

/** The status that the handler of the CAT binding answers to a body, which it reads whole before it parses it. */
async function catStatus(body: Uint8Array): Promise<string> {
  const unused = () => Promise.reject(new Error("The port is not called."));
  const handle = createCatRestHandler(
    {
      createSection: unused,
      getSection: unused,
      createSession: unused,
      submitResults: unused,
      endSession: unused,
      endSection: unused,
    },
    { authorize: () => true },
  );
  const response = await handle(
    new Request("https://engine.example/ims/cat/v1p0/sections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }),
  );
  return `status ${response.status}`;
}

/** An item with a printed variable of an undeclared variable at every node that 32 MiB hold. */
const validateInput = (): Uint8Array =>
  repeated(
    `${ITEM}<qti-item-body><p>`,
    '<qti-printed-variable identifier="X"/>',
    Math.floor((XML_BYTES - 1_000) / 38),
    "</p></qti-item-body></qti-assessment-item>",
  );

/** The readings, by name: the readers of documents, packages, actions and states, and the bodies of the player. */
export const READINGS = {
  /** A document of 1,000,000 nodes, the limit, in the tree of the XML reader. */
  xmlNodes: {
    input: () => repeated("<a>", "<b/>", 999_998, "</a>"),
    read: (xml: Uint8Array) => `${parseXml(xml).children.length} children`,
  },
  /** A document of 8,000,000 nodes, over the limit of nodes, which stops the tree at 1,000,000. */
  xmlOverNodes: {
    input: () => repeated("<a>", "<b/>", 8_000_000, "</a>"),
    read: (xml: Uint8Array) => refusal(() => parseXml(xml, { limits: { maxBytes: 64 * MIB } })),
  },
  /** A document of 32 MiB whose elements have the most attributes an element may have, 256. */
  xmlAttributes: {
    input: () => {
      const attributes = Array.from({ length: 256 }, (_, index) => ` a${index}=""`).join("");
      const unit = `<e${attributes}/>`;
      return repeated("<a>", unit, Math.floor((XML_BYTES - 7) / unit.length), "</a>");
    },
    read: (xml: Uint8Array) => `${parseXml(xml).children.length} elements`,
  },
  /** A document of one text node of 32 MiB, the limit. */
  xmlText: {
    input: () => repeated("<a>", "x", XML_BYTES - 7, "</a>"),
    read: (xml: Uint8Array) => `${parseXml(xml).children.length} node`,
  },
  /** An item of 1,000,000 nodes in the model of the reader of items. */
  itemNodes: {
    input: () => repeated(`${ITEM}<qti-item-body>`, "<p/>", 999_997, "</qti-item-body></qti-assessment-item>"),
    read: (xml: Uint8Array) => readAsi(xml).kind,
  },
  /** An item whose one choice interaction has as many choices as 32 MiB hold. */
  itemChoices: {
    input: () =>
      numbered(
        `${ITEM}<qti-item-body><qti-choice-interaction response-identifier="R" max-choices="1">`,
        (index) => `<qti-simple-choice identifier="c${index}"/>`,
        "</qti-choice-interaction></qti-item-body></qti-assessment-item>",
      ).bytes,
    read: (xml: Uint8Array) => readAsi(xml).kind,
  },
  /** A test whose one section has as many item references as 32 MiB hold. */
  testReferences: {
    input: () =>
      numbered(
        `<qti-assessment-test ${ASI} identifier="t" title="t"><qti-test-part identifier="p" navigation-mode="linear" submission-mode="individual"><qti-assessment-section identifier="s" title="s" visible="true">`,
        (index) => `<qti-assessment-item-ref identifier="i${index}" href="i${index}.xml"/>`,
        "</qti-assessment-section></qti-test-part></qti-assessment-test>",
      ).bytes,
    read: (xml: Uint8Array) => readAsi(xml).kind,
  },
  /** A manifest with as many resources as 32 MiB hold. */
  manifestResources: {
    input: () => manifestOf(1_000_000).bytes,
    read: (xml: Uint8Array) => `${readManifest(xml).resources.length} resources`,
  },
  /** A results report with as many item results as 32 MiB hold. */
  resultsItems: {
    input: () =>
      numbered(
        `<assessmentResult xmlns="${RESULTS_NAMESPACE}"><context/>`,
        (index) =>
          `<itemResult identifier="q${index}" datestamp="2020-08-25T18:19:20" sessionStatus="final"><outcomeVariable identifier="SCORE" cardinality="single" baseType="float"><value>1</value></outcomeVariable></itemResult>`,
        "</assessmentResult>",
      ).bytes,
    read: (xml: Uint8Array) => `${readResults(xml).itemResults.length} item results`,
  },
  /** Usage data with as many statistics as 32 MiB hold. */
  usageStatistics: {
    input: () =>
      numbered(
        `<usageData xmlns="${USAGE_NAMESPACE}">`,
        (index) =>
          `<ordinaryStatistic name="AIS" context="http://example.com/c" caseCount="${index}"><targetObject identifier="i${index}"/><value>0.87</value></ordinaryStatistic>`,
        "</usageData>",
      ).bytes,
    read: (xml: Uint8Array) => `${readUsageData(xml).statistics.length} statistics`,
  },
  /** An item with a printed variable of an undeclared variable at every one of its 1,000,000 nodes, whose findings stop at 1,000. */
  validateFindings: {
    input: () => validateInput(),
    read: (xml: Uint8Array) => {
      const issues = validateAsi(readAsi(xml));
      return `${issues.length} issues, the last ${issues.at(-1)?.rule}`;
    },
  },
  /** An archive of 100,000 entries, the limit, of which the reader reads the directory and the manifest. */
  packageEntries: {
    input: () => {
      const manifest = Buffer.from(
        `<manifest ${CP} identifier="m"><metadata><schema>QTI Package</schema><schemaversion>3.0.0</schemaversion></metadata><organizations/><resources/></manifest>`,
      );
      const empty = Buffer.alloc(0);
      return archiveOf(
        100_000,
        (index) =>
          index === 0
            ? { name: "imsmanifest.xml", stored: manifest, method: 0, size: manifest.length, crc: nodeCrc32(manifest) }
            : { name: `f${index}`, stored: empty, method: 0, size: 0, crc: 0 },
        100_000 * 100,
      );
    },
    read: (zip: Uint8Array) => `${readPackage(zip).paths.length} files`,
  },
  /** An archive whose manifest of as many resources as 32 MiB hold is deflated, the ratio allowed. */
  packageManifest: {
    input: () => {
      const { bytes } = manifestOf(1_000_000);
      const stored = deflateRawSync(bytes);
      return archiveOf(
        1,
        () => ({ name: "imsmanifest.xml", stored, method: 8, size: bytes.length, crc: nodeCrc32(bytes) }),
        stored.length + 1_000,
      );
    },
    read: (zip: Uint8Array) => `${readPackage(zip).manifest.resources.length} resources`,
  },
  /** A section that selects with replacement as many items as a plan holds, 10,000 nodes. */
  planNodes: {
    input: () =>
      readAsi(
        `<qti-assessment-test ${ASI} identifier="t" title="t"><qti-test-part identifier="p" navigation-mode="linear" submission-mode="individual"><qti-assessment-section identifier="s" title="s" visible="true"><qti-selection select="9999" with-replacement="true"/><qti-assessment-item-ref identifier="i" href="i.xml"/></qti-assessment-section></qti-test-part></qti-assessment-test>`,
      ),
    read: (document: ReturnType<typeof readAsi>) => {
      if (document.kind !== "test") throw new Error("The reading needs a test.");
      const structure = resolveStructure(document.test, "t.xml", {
        sections: () => {
          throw new Error("The test has no section reference.");
        },
      });
      return `${planTest(structure, { random: createRandom(1) }).parts[0]?.children[0]?.children.length} items`;
    },
  },
  /** A `set-responses` action of the most entries 4,194,304 nodes hold, each with a value of its own. */
  actionEntries: {
    input: () => ({
      type: "set-responses",
      item: { ref: "q", instance: 1 },
      responses: Array.from({ length: 419_000 }, (_, index) => [`r${index}`, null]),
    }),
    read: (json: unknown) => readCandidateAction(json).type,
  },
  /** A `set-responses` action of one response with the most integers 4,194,304 nodes hold. */
  actionValues: {
    input: () => ({
      type: "set-responses",
      item: { ref: "q", instance: 1 },
      responses: [
        [
          "R",
          {
            cardinality: "multiple",
            baseType: "integer",
            value: { list: { integer: Array.from({ length: 4_194_000 }, (_, index) => index % 9) } },
          },
        ],
      ],
    }),
    read: (json: unknown) => readCandidateAction(json).type,
  },
  /** A `support-settings` action of 1,000,000 font names, over the limit of a list, which is refused before the profile is built. */
  settingsList: {
    input: () => settingsOf(1_000_000),
    read: (json: unknown) => refusal(() => readCandidateAction(json)),
  },
  /** The same action read without the limit of a list, which builds an element of the profile for each name. */
  settingsListUnlimited: {
    input: () => settingsOf(1_000_000),
    read: (json: unknown) => readCandidateAction(json, { limits: { maxSettingListLength: 1_000_000 } }).type,
  },
  /** A pattern of the most states, 100,000, matched against a text of a million characters. */
  patternStates: {
    input: () => ({ pattern: "[ab]{99990}", text: "ab".repeat(49_995) }),
    read: ({ pattern, text }: { pattern: string; text: string }) => `${compileXsdRegex(pattern).matches(text)}`,
  },
  /** A module resolution file of 65,536 characters, the limit. */
  moduleResolution: {
    input: () =>
      JSON.stringify({
        waitSeconds: 7,
        paths: Object.fromEntries(Array.from({ length: 2_000 }, (_, i) => [`m${i}`, `p/${i}`])),
      }).padEnd(65_536, " "),
    read: (text: string) => `${readModuleResolution(text).paths.size} paths`,
  },
  /** A body of 32 MiB of 2,000,000 tokens, over the limit, which is refused before it is parsed. */
  catBodyTokens: {
    input: () => Buffer.from(emptyObjects(2_000_000, XML_BYTES)),
    read: (body: Uint8Array) => catStatus(body),
  },
  /** A body of the CAT REST binding of 32 MiB and a million tokens of empty objects, which the schema of the binding refuses. */
  catBody: {
    input: () => Buffer.from(emptyObjects(1_000_000, XML_BYTES)),
    read: (body: Uint8Array) => catStatus(body),
  },
} satisfies Readonly<Record<string, Reading>>;

/** The name of a reading. */
export type ReadingName = keyof typeof READINGS;
