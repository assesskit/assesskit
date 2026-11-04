import { once } from "node:events";
import { closeSync, openSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";
import { createDeflateRaw, deflateRawSync, crc32 as nodeCrc32 } from "node:zlib";
import { createCatRestHandler } from "../packages/player/src/cat-rest/index.ts";
import {
  AssesskitError,
  buildOperatorCall,
  compareMathSteps,
  compileScoring,
  compileXsdRegex,
  createRandom,
  createScoringOperators,
  DEFAULT_ITEM_FORMAT_LIMITS,
  DEFAULT_KEY_LIMITS,
  DEFAULT_OPERATOR_LIMITS,
  DEFAULT_RESULTS_JSON_LIMITS,
  DEFAULT_XML_LIMITS,
  DEFAULT_ZIP_LIMITS,
  OPERATOR_DEFINITIONS,
  parseXml,
  planTest,
  RESULTS_NAMESPACE,
  readAsi,
  readCandidateAction,
  readGift,
  readManifest,
  readModuleResolution,
  readMoodleXml,
  readPackage,
  readResults,
  readResultsJson,
  readUsageData,
  resolveStructure,
  type ScoredResponse,
  SecurityError,
  USAGE_NAMESPACE,
  type Value,
  validateAsi,
} from "../packages/runtime/src/index.ts";
import { readPackageFile } from "../packages/runtime/src/node/package-file.ts";
import { DIRECTORY_BYTES_PER_ENTRY } from "../packages/runtime/src/package/internal.ts";

/** The bytes of one MiB. */
const MIB = 1024 * 1024;

/** The bytes of the end record of an archive without a comment. */
const END_RECORD_BYTES = 22;

/** The default `maxBytes` of an XML document, from which the documents are made, so that a new default changes the readings. */
const XML_BYTES = DEFAULT_XML_LIMITS.maxBytes;

/** The default `maxNodes` of an XML tree. */
const XML_NODES = DEFAULT_XML_LIMITS.maxNodes;

/** The default `maxBodyBytes` of a request to the handler of the CAT binding. */
const BODY_BYTES = 32 * MIB;

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

/** The elements of the item of a GIFT question of the most answers, and of two answers, and of an essay besides its text. */
const GIFT_ANSWER_ELEMENTS = 23 + DEFAULT_ITEM_FORMAT_LIMITS.maxAnswers;
const GIFT_SHORT_ELEMENTS = 25;
const GIFT_ESSAY_ELEMENTS = 12;

/** The questions of each kind whose items hold the most elements that the limit allows. */
const GIFT_ANSWER_QUESTIONS = Math.floor(DEFAULT_ITEM_FORMAT_LIMITS.maxNodes / GIFT_ANSWER_ELEMENTS);
const GIFT_SHORT_QUESTIONS = Math.floor(DEFAULT_ITEM_FORMAT_LIMITS.maxNodes / GIFT_SHORT_ELEMENTS);
/** Essays of the most tags, each `<b>` and `</b>` a tag, the reader refusing a text whose tags would pass the limit. */
const GIFT_TAG_QUESTIONS =
  Math.floor(
    (DEFAULT_ITEM_FORMAT_LIMITS.maxNodes - DEFAULT_ITEM_FORMAT_LIMITS.maxTextTags) /
      (DEFAULT_ITEM_FORMAT_LIMITS.maxTextTags / 2 + GIFT_ESSAY_ELEMENTS),
  ) + 1;

/** A question of Moodle XML of two answers. */
const MOODLE_XML_QUESTION =
  '<question type="multichoice"><name><text>q</text></name><answer fraction="100"><text>a</text></answer><answer fraction="0"><text>b</text></answer></question>';

/** The question of two answers padded with as many empty elements as the limit of nodes leaves each question. */
const MOODLE_XML_PADDED = MOODLE_XML_QUESTION.replace(
  "</question>",
  `${"<x/>".repeat(Math.floor(XML_NODES / GIFT_SHORT_QUESTIONS) - 16)}</question>`,
);

/** The nodes that a document keeps for the elements around its units, out of the nodes it may have. */
const WRAPPER_NODES = 16;

/**
 * The bytes of `opening`, then `unit(0)`, `unit(1)` and so on for as long as the document stays within the limits of bytes and
 * of nodes with the `closing`, in one buffer: for the units that differ, such as the identifiers, which only a count can tell
 * apart.
 *
 * @param nodes - The nodes of one unit.
 * @returns The bytes and the number of units.
 */
function numbered(
  opening: string,
  unit: (index: number) => string,
  closing: string,
  nodes = 1,
): { readonly bytes: Uint8Array; readonly count: number } {
  const bytes = Buffer.allocUnsafe(XML_BYTES);
  let offset = bytes.write(opening, 0);
  const reserved = Buffer.byteLength(closing);
  const most = Math.floor((XML_NODES - WRAPPER_NODES) / nodes);
  let count = 0;
  while (count < most) {
    const next = unit(count);
    if (offset + Buffer.byteLength(next) + reserved > XML_BYTES) break;
    offset += bytes.write(next, offset);
    count += 1;
  }
  offset += bytes.write(closing, offset);
  return { bytes: bytes.subarray(0, offset), count };
}

const ASI = 'xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0"';
const ITEM = `<qti-assessment-item ${ASI} identifier="i" title="t" adaptive="false" time-dependent="false">`;
const CP = 'xmlns="http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1"';

/**
 * A manifest with as many resources as the limits hold, as bytes: a resource of the fewest bytes, the two attributes that it
 * must have, is the heaviest in memory for the bytes it takes.
 */
const manifestOf = () =>
  numbered(
    `<manifest ${CP} identifier="m"><metadata><schema>QTI Package</schema><schemaversion>3.0.0</schemaversion></metadata><organizations/><resources>`,
    (index) => `<resource identifier="r${index.toString(36)}" type="imsqti_item_xmlv3p0"/>`,
    "</resources></manifest>",
  );

/** The manifest of a package with no resource, as bytes. */
const EMPTY_MANIFEST = Buffer.from(
  `<manifest ${CP} identifier="m"><metadata><schema>QTI Package</schema><schemaversion>3.0.0</schemaversion></metadata><organizations/><resources/></manifest>`,
);

/** The attributes that a paragraph of an item takes, in the order that {@link crowdedParagraph} adds them. */
const PARAGRAPH_ATTRIBUTES = [' id="i"', ' class="c"', ' label="l"', ' dir="ltr"', ' xml:lang="en"'];

/**
 * The paragraph with the most attributes of which the most nodes still fit in the limit of bytes: the cost of an attribute in
 * memory is far above its bytes, so a document of paragraphs with attributes is heavier than one without.
 */
function crowdedParagraph(): string {
  let paragraph = "<p";
  for (const attribute of PARAGRAPH_ATTRIBUTES) {
    if ((paragraph.length + attribute.length + 2) * XML_NODES > XML_BYTES) break;
    paragraph += attribute;
  }
  return `${paragraph}/>`;
}

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

/**
 * The bytes of a path that fill a record of the central directory to the bytes that an entry may take: the path and its 6 digits, the
 * 46 bytes of the record and no extra field or comment.
 */
const DIRECTORY_PATH_BYTES = DIRECTORY_BYTES_PER_ENTRY - 46 - 6;

/** The manifest of a package with no resource, as the first entry of an archive. */
const MANIFEST_ENTRY: Entry = {
  name: "imsmanifest.xml",
  stored: EMPTY_MANIFEST,
  method: 0,
  size: EMPTY_MANIFEST.length,
  crc: nodeCrc32(EMPTY_MANIFEST),
};

/**
 * A file of `size` bytes, deflated at a ratio that the limit of ratios allows, without the file in memory: each MiB is zeros but for one
 * byte in 128, which differs from one MiB to the next, and deflated it is about 1/50 of the size.
 */
async function deflatedFile(size: number): Promise<Pick<Entry, "stored" | "crc">> {
  const piece = Buffer.alloc(MIB);
  for (let at = 0; at < MIB; at += 128) piece[at] = (at * 2_654_435_761) >>> 24;
  const deflate = createDeflateRaw({ level: 1 });
  const chunks: Buffer[] = [];
  deflate.on("data", (chunk: Buffer) => chunks.push(chunk));
  const ended = once(deflate, "end");
  let crc = 0;
  for (let done = 0; done < size; done += MIB) {
    piece[(done / MIB) % 128] = done >>> 20;
    crc = nodeCrc32(piece, crc);
    if (!deflate.write(piece)) await once(deflate, "drain");
  }
  deflate.end();
  await ended;
  return { stored: Buffer.concat(chunks), crc };
}

/**
 * Writes an archive that {@link archiveOf} made to a file in the directory of the bundle, which the run that made it removes (the
 * process of a reading may end without a chance to remove its own files), with `gap` bytes between its entries and its central
 * directory that the file system does not store, so that the file is as long as a package may be and takes the disk of a small one.
 *
 * @returns The path of the file.
 */
function zipFile(zip: Uint8Array, gap: number): string {
  const directory = process.env.PEAK_MEMORY_DIRECTORY;
  if (directory === undefined)
    throw new Error("A reading of a ZIP file runs through peak-memory.ts, which gives it a directory.");
  const path = join(directory, `package-${process.pid}.zip`);
  const bytes = Buffer.from(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = bytes.length - END_RECORD_BYTES;
  const at = bytes.readUInt32LE(end + 16);
  bytes.writeUInt32LE(at + gap, end + 16);
  const file = openSync(path, "w");
  try {
    writeSync(file, bytes, 0, at, 0);
    writeSync(file, bytes, at, bytes.length - at, at + gap);
  } finally {
    closeSync(file);
  }
  return path;
}

/** Reads the package in a ZIP file and its file named `file`, if it has one, and removes the file. */
async function readZipFile(path: string): Promise<string> {
  try {
    const pkg = await readPackageFile(path);
    return `${pkg.paths.length} files, ${pkg.file("file")?.length ?? 0} bytes`;
  } finally {
    rmSync(path, { force: true });
  }
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

/** An item with a printed variable of an undeclared variable at every node that the limits hold. */
const validateInput = (): Uint8Array =>
  repeated(
    `${ITEM}<qti-item-body><p>`,
    '<qti-printed-variable identifier="X"/>',
    Math.min(Math.floor((XML_BYTES - 1_000) / 38), XML_NODES - WRAPPER_NODES),
    "</p></qti-item-body></qti-assessment-item>",
  );

/** The readings, by name: the readers of documents, packages, actions and states, and the bodies of the player. */
export const READINGS = {
  /** A document of the most nodes, the limit, in the tree of the XML reader. */
  xmlNodes: {
    input: () => repeated("<a>", "<b/>", XML_NODES - 1, "</a>"),
    read: (xml: Uint8Array) => `${parseXml(xml).children.length} children`,
  },
  /** A document of eight times the limit of nodes, which stops the tree at the limit. */
  xmlOverNodes: {
    input: () => repeated("<a>", "<b/>", 8 * XML_NODES, "</a>"),
    read: (xml: Uint8Array) => refusal(() => parseXml(xml, { limits: { maxBytes: 64 * MIB } })),
  },
  /** A document of the most bytes whose elements have the most attributes an element may have, 256. */
  xmlAttributes: {
    input: () => {
      const attributes = Array.from({ length: 256 }, (_, index) => ` a${index}=""`).join("");
      const unit = `<e${attributes}/>`;
      return repeated("<a>", unit, Math.floor((XML_BYTES - 7) / unit.length), "</a>");
    },
    read: (xml: Uint8Array) => `${parseXml(xml).children.length} elements`,
  },
  /** A document of one text node of the most bytes. */
  xmlText: {
    input: () => repeated("<a>", "x", XML_BYTES - 7, "</a>"),
    read: (xml: Uint8Array) => `${parseXml(xml).children.length} node`,
  },
  /** An item of the most nodes in the model of the reader of items. */
  itemNodes: {
    input: () => repeated(`${ITEM}<qti-item-body>`, "<p/>", XML_NODES - 2, "</qti-item-body></qti-assessment-item>"),
    read: (xml: Uint8Array) => readAsi(xml).kind,
  },
  /** An item of the most nodes whose elements carry as many attributes as the limit of bytes lets them. */
  itemAttributes: {
    input: () =>
      repeated(`${ITEM}<qti-item-body>`, crowdedParagraph(), XML_NODES - 2, "</qti-item-body></qti-assessment-item>"),
    read: (xml: Uint8Array) => readAsi(xml).kind,
  },
  /** An item whose one choice interaction has as many choices as the limits hold. */
  itemChoices: {
    input: () =>
      numbered(
        `${ITEM}<qti-item-body><qti-choice-interaction response-identifier="R" max-choices="1">`,
        (index) => `<qti-simple-choice identifier="c${index}"/>`,
        "</qti-choice-interaction></qti-item-body></qti-assessment-item>",
      ).bytes,
    read: (xml: Uint8Array) => readAsi(xml).kind,
  },
  /** A test whose one section has as many item references as the limits hold. */
  testReferences: {
    input: () =>
      numbered(
        `<qti-assessment-test ${ASI} identifier="t" title="t"><qti-test-part identifier="p" navigation-mode="linear" submission-mode="individual"><qti-assessment-section identifier="s" title="s" visible="true">`,
        (index) => `<qti-assessment-item-ref identifier="i${index}" href="i${index}.xml"/>`,
        "</qti-assessment-section></qti-test-part></qti-assessment-test>",
      ).bytes,
    read: (xml: Uint8Array) => readAsi(xml).kind,
  },
  /** A manifest with as many resources as the limits hold. */
  manifestResources: {
    input: () => manifestOf().bytes,
    read: (xml: Uint8Array) => `${readManifest(xml).resources.length} resources`,
  },
  /** A results report with as many item results as the limits hold. */
  resultsItems: {
    input: () =>
      numbered(
        `<assessmentResult xmlns="${RESULTS_NAMESPACE}"><context/>`,
        (index) =>
          `<itemResult identifier="q${index}" datestamp="2020-08-25T18:19:20" sessionStatus="final"><outcomeVariable identifier="SCORE" cardinality="single" baseType="float"><value>1</value></outcomeVariable></itemResult>`,
        "</assessmentResult>",
        4,
      ).bytes,
    read: (xml: Uint8Array) => `${readResults(xml).itemResults.length} item results`,
  },
  /**
   * The JSON of a result, parsed, of the most size that its limit allows, in its heaviest form for its size: one variable
   * with as many values as fit, each of 8 units (an object, the name `value`, a string and its length). The forms that were
   * tried are the values, the item results with an outcome, the item results with a response and an outcome, and bare item
   * results; the values take about twice the memory of the others for their size.
   */
  resultsJson: {
    input: () => {
      const values = Math.floor((DEFAULT_RESULTS_JSON_LIMITS.maxResultSize - 200) / 8);
      return {
        context: { sessionIdentifiers: [] },
        itemResult: [
          {
            identifier: "q",
            datestamp: "2020-08-25T18:19:20",
            sessionStatus: "final",
            outcomeVariables: [
              {
                identifier: "SCORE",
                cardinality: "multiple",
                baseType: "integer",
                value: Array.from({ length: values }, () => ({ value: "1" })),
              },
            ],
          },
        ],
      };
    },
    read: (json: unknown) => {
      const variable = readResultsJson(json).itemResults[0]?.variables[0];
      const value = variable?.kind === "outcome" ? variable.value : null;
      return `${value !== null && "values" in value ? value.values.length : 0} values`;
    },
  },
  /** Usage data with as many statistics as the limits hold. */
  usageStatistics: {
    input: () =>
      numbered(
        `<usageData xmlns="${USAGE_NAMESPACE}">`,
        (index) =>
          `<ordinaryStatistic name="AIS" context="http://example.com/c" caseCount="${index}"><targetObject identifier="i${index}"/><value>0.87</value></ordinaryStatistic>`,
        "</usageData>",
        4,
      ).bytes,
    read: (xml: Uint8Array) => `${readUsageData(xml).statistics.length} statistics`,
  },
  /** An item with a printed variable of an undeclared variable at every node that the limits hold, whose findings stop at 1,000. */
  validateFindings: {
    input: () => validateInput(),
    read: (xml: Uint8Array) => {
      const issues = validateAsi(readAsi(xml));
      return `${issues.length} issues, the last ${issues.at(-1)?.rule}`;
    },
  },
  /**
   * An archive with a file of the most bytes an entry may hold, deflated at a ratio that the limit allows, which `file` inflates.
   * The bytes of the file are outside the heap, so the case bounds the resident memory that the reading raises.
   */
  packageEntry: {
    input: async () => {
      const size = DEFAULT_ZIP_LIMITS.maxEntryBytes;
      const { stored, crc } = await deflatedFile(size);
      return archiveOf(
        2,
        (index) => (index === 0 ? MANIFEST_ENTRY : { name: "file", stored, method: 8, size, crc }),
        stored.length + 1_000,
      );
    },
    read: (zip: Uint8Array) => `${readPackage(zip).file("file")?.length} bytes`,
  },
  /** An archive of 100,000 entries, the limit, of which the reader reads the directory and the manifest. */
  packageEntries: {
    input: () => {
      const empty = Buffer.alloc(0);
      return archiveOf(
        100_000,
        (index) => (index === 0 ? MANIFEST_ENTRY : { name: `f${index}`, stored: empty, method: 0, size: 0, crc: 0 }),
        100_000 * 100,
      );
    },
    read: (zip: Uint8Array) => `${readPackage(zip).paths.length} files`,
  },
  /**
   * A package at the limits, in a ZIP file: 100,000 entries, one of them a file of the most bytes an entry may hold, deflated at the
   * ratio the limit allows, and a hole in the file up to the most bytes that a file may have. `readPackageFile` reads the end of
   * the file, the central directory and the file that it opens, and not the hole.
   */
  packageFile: {
    input: async () => {
      const size = DEFAULT_ZIP_LIMITS.maxEntryBytes;
      const { stored, crc } = await deflatedFile(size);
      const empty = Buffer.alloc(0);
      const zip = archiveOf(
        100_000,
        (index) =>
          index === 0
            ? MANIFEST_ENTRY
            : index === 1
              ? { name: "file", stored, method: 8, size, crc }
              : { name: `f${index}`, stored: empty, method: 0, size: 0, crc: 0 },
        stored.length + 100_000 * 100,
      );
      return zipFile(zip, DEFAULT_ZIP_LIMITS.maxTotalBytes - zip.length - MIB);
    },
    read: readZipFile,
  },
  /**
   * A ZIP file whose central directory is the longest that its 100,000 entries allow, with the paths that fill it, which `readPackageFile`
   * keeps as the entries it lists.
   */
  packageDirectory: {
    input: () => {
      const empty = Buffer.alloc(0);
      const path = (index: number): string => `${"x".repeat(DIRECTORY_PATH_BYTES)}${String(index).padStart(6, "0")}`;
      const zip = archiveOf(
        100_000,
        (index) => (index === 0 ? MANIFEST_ENTRY : { name: path(index), stored: empty, method: 0, size: 0, crc: 0 }),
        100_000 * 2 * (80 + DIRECTORY_PATH_BYTES),
      );
      return zipFile(zip, 0);
    },
    read: readZipFile,
  },
  /** An archive whose manifest of as many resources as the limits hold is deflated, the ratio allowed. */
  packageManifest: {
    input: () => {
      const { bytes } = manifestOf();
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
  /** A body of 32 MiB of 2,000,000 tokens, over the limit of tokens, which is refused before it is parsed. */
  catBodyTokens: {
    input: () => Buffer.from(emptyObjects(2_000_000, BODY_BYTES)),
    read: (body: Uint8Array) => catStatus(body),
  },
  /** A body of the CAT REST binding of 32 MiB and a million tokens of empty objects, which the schema of the binding refuses. */
  catBody: {
    input: () => Buffer.from(emptyObjects(1_000_000, BODY_BYTES)),
    read: (body: Uint8Array) => catStatus(body),
  },
  /**
   * `expression-equivalent` on a key and a response of `maxInputLength` characters each, sums of 1,000 terms, which the
   * comparator evaluates at 24 points.
   */
  operatorExpression: {
    input: () => "x+".repeat(DEFAULT_OPERATOR_LIMITS.maxInputLength / 2 - 1).concat("x"),
    read: (sum: string) =>
      scoreWith(
        "expression-equivalent",
        { operator: "expression-equivalent", key: { kind: "expression", expression: sum } },
        [{ cardinality: "single", baseType: "string", value: sum }],
      ),
  },
  /**
   * `text-equivalent` on a key of as many answers as a key holds, each a pattern that every word matches, and a response of
   * `maxInputLength` characters of one-letter words: a matching of 1,000 answers to 1,000 words.
   */
  operatorText: {
    input: () => "a ".repeat(DEFAULT_OPERATOR_LIMITS.maxInputLength / 2),
    read: (words: string) =>
      scoreWith(
        "text-equivalent",
        {
          operator: "text-equivalent",
          key: {
            kind: "text",
            answers: Array.from({ length: DEFAULT_KEY_LIMITS.entries }, () => ({ texts: [], patterns: [".*"] })),
            count: DEFAULT_KEY_LIMITS.entries,
            scheme: "words",
          },
        },
        [{ cardinality: "single", baseType: "string", value: words }],
      ),
  },
  /** `hotspot-matching` on as many areas as a key holds and as many points, each in every area: 10^6 hit tests and edges. */
  operatorHotspot: {
    input: () => Array.from({ length: DEFAULT_KEY_LIMITS.entries }, () => [50, 50] as const),
    read: (points: readonly (readonly [number, number])[]) =>
      scoreWith(
        "hotspot-matching",
        {
          operator: "hotspot-matching",
          key: {
            kind: "areas",
            scheme: "keyed",
            areas: Array.from({ length: DEFAULT_KEY_LIMITS.entries }, (_, index) => ({
              id: `a${index}`,
              shape: "rect" as const,
              coords: [0, 0, 100, 100],
            })),
          },
        },
        [{ cardinality: "multiple", baseType: "point", values: points }],
      ),
  },
  /** `compareMathSteps` on 200 lines, its default `maxSteps`, of `maxInputLength` characters each. */
  /**
   * `compileScoring` on as many responses as the limits of keys allow, each an order of as many choices as a key holds,
   * scored per position: the scheme that writes the most rules for an entry, a condition for each choice.
   */
  compileKeys: {
    input: (): ScoredResponse[] =>
      Array.from({ length: DEFAULT_KEY_LIMITS.responses }, (_, at) => ({
        identifier: `R${at}`,
        key: {
          kind: "order",
          order: Array.from({ length: DEFAULT_KEY_LIMITS.entries }, (_, choice) => `C${choice}`),
          scheme: "per-position",
        },
      })),
    read: (responses: readonly ScoredResponse[]) =>
      `${compileScoring(responses).responseProcessing.rules.length} rules`,
  },
  /** A GIFT file of questions of the most answers, whose items hold the most elements, the limit. */
  giftAnswers: {
    input: () =>
      repeated("", `q{=a${" ~a".repeat(DEFAULT_ITEM_FORMAT_LIMITS.maxAnswers - 1)}}\n\n`, GIFT_ANSWER_QUESTIONS, ""),
    read: (gift: Uint8Array) => `${readGift(gift).items.length} items`,
  },
  /** A GIFT file of questions of two answers, whose items hold the most elements, the limit. */
  giftQuestions: {
    input: () => repeated("", "q{=a ~a}\n\n", GIFT_SHORT_QUESTIONS, ""),
    read: (gift: Uint8Array) => `${readGift(gift).items.length} items`,
  },
  /** A GIFT file of twice the questions of two answers that the limit of elements holds, which stops at the limit. */
  giftOverNodes: {
    input: () => repeated("", "q{=a ~a}\n\n", 2 * GIFT_SHORT_QUESTIONS, ""),
    read: (gift: Uint8Array) => refusal(() => readGift(gift)),
  },
  /** A GIFT file of essays whose HTML holds the most tags of a text, as many as the limit of elements holds. */
  giftTags: {
    input: () =>
      repeated(
        "",
        `[html]${"<b>x</b>".repeat(DEFAULT_ITEM_FORMAT_LIMITS.maxTextTags / 2)}{}\n\n`,
        GIFT_TAG_QUESTIONS,
        "",
      ),
    read: (gift: Uint8Array) => `${readGift(gift).items.length} items`,
  },
  /** A Moodle XML file of questions of two answers, whose items hold the most elements, the limit. */
  moodleXmlQuestions: {
    input: () => repeated("<quiz>", MOODLE_XML_QUESTION, GIFT_SHORT_QUESTIONS, "</quiz>"),
    read: (xml: Uint8Array) => `${readMoodleXml(xml).items.length} items`,
  },
  /**
   * A Moodle XML file of questions of two answers, each padded with elements that the reader passes over, to the most nodes
   * of the XML reader's tree and the most elements of the items together.
   */
  moodleXmlNodes: {
    input: () => repeated("<quiz>", MOODLE_XML_PADDED, GIFT_SHORT_QUESTIONS, "</quiz>"),
    read: (xml: Uint8Array) => `${readMoodleXml(xml).items.length} items`,
  },
  mathSteps: {
    input: () =>
      Array.from({ length: 200 }, () => "x+".repeat(DEFAULT_OPERATOR_LIMITS.maxInputLength / 2 - 1).concat("x")),
    read: (steps: readonly string[]) =>
      `${compareMathSteps(steps).filter((check) => check.equivalent === true).length} equivalent`,
  },
} satisfies Readonly<Record<string, Reading>>;

/** Scores operands with an operator, on the call that `buildOperatorCall` writes, and says the result. */
function scoreWith(
  name: keyof typeof OPERATOR_DEFINITIONS,
  call: Parameters<typeof buildOperatorCall>[0],
  operands: readonly Value[],
): string {
  const operator = createScoringOperators().get(OPERATOR_DEFINITIONS[name]);
  return JSON.stringify(operator?.(operands, buildOperatorCall(call, "RESPONSE")) ?? null);
}

/** The name of a reading. */
export type ReadingName = keyof typeof READINGS;
