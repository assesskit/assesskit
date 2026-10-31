import { ParseOption, XmlDocument, XmlLibError, type XsdValidator } from "libxml2-wasm";
import { checkArray, checkRecord, checkString, describe } from "../checks.js";
import { DataError, type Issue, ReadError, SecurityError } from "../errors.js";
import { parseXml, type XmlElement } from "../xml/index.js";
import { checkSchemaSet, type SchemaSet, validatorFor } from "./schema-set.js";
import { selectSchema } from "./select-schema.js";

/** A document to validate. */
export interface XmlFile {
  /** The path of the file in its package or directory; issues name the document by it. */
  readonly path: string;
  /** The document as text or bytes. */
  readonly content: string | Uint8Array;
}

/** How libxml2 reads a document: with no network and no external entity (BPIG §6.7 applies to libxml2 too), and with line numbers beyond 65,535. */
const READ_OPTIONS = ParseOption.XML_PARSE_NONET | ParseOption.XML_PARSE_NO_XXE | ParseOption.XML_PARSE_BIG_LINES;
/** How libxml2 reads a string that the runtime encodes as UTF-8, whatever encoding the string declares. */
const TEXT_OPTIONS = READ_OPTIONS | ParseOption.XML_PARSE_IGNORE_ENC;
const ENCODER = new TextEncoder();

/** The severity of a libxml2 diagnostic (`xmlErrorLevel`): 1 is a warning, 2 an error and 3 a fatal error. */
const LIBXML2_WARNING = 1;

/** Turns what libxml2 reports for a document into issues of a schema. */
function issuesOf(error: unknown, code: string, path: string): Issue[] {
  if (!(error instanceof XmlLibError)) throw error;
  return error.details.map((detail) => ({
    severity: detail.level === LIBXML2_WARNING ? "warning" : "error",
    code,
    message: detail.message.trim(),
    location: {
      path,
      ...(detail.line > 0 ? { line: detail.line } : {}),
      ...(detail.col > 0 ? { column: detail.col } : {}),
    },
  }));
}

/** Validates a document that the runtime has parsed against the schema it selected. */
function validateAgainst(validator: XsdValidator, file: XmlFile): Issue[] {
  const { content } = file;
  let document: XmlDocument;
  try {
    document =
      typeof content === "string"
        ? XmlDocument.fromBuffer(ENCODER.encode(content), { option: TEXT_OPTIONS })
        : XmlDocument.fromBuffer(content, { option: READ_OPTIONS });
  } catch (error) {
    return issuesOf(error, "assesskit/node/xml-rejected", file.path);
  }
  try {
    validator.validate(document);
    return [];
  } catch (error) {
    return issuesOf(error, "assesskit/node/xsd-invalid", file.path);
  } finally {
    document.dispose();
  }
}

function validateOne(schemas: SchemaSet, file: XmlFile): Issue[] {
  let root: XmlElement;
  try {
    root = parseXml(file.content, { path: file.path });
  } catch (error) {
    if (error instanceof ReadError) return [...error.issues];
    if (!(error instanceof SecurityError)) throw error;
    return [
      {
        severity: "error",
        code: "assesskit/xml/security",
        message: error.message,
        location: { path: file.path },
      },
    ];
  }
  const schema = selectSchema(root);
  if (schema === undefined) {
    const name = `${root.namespace === "" ? "" : `{${root.namespace}}`}${root.name}`;
    const message = `The root element ${name} is not in a namespace that the runtime has a schema for.`;
    return [
      {
        severity: "error",
        code: "assesskit/node/no-schema",
        message,
        location: { path: file.path },
      },
    ];
  }
  return validateAgainst(validatorFor(schemas, schema), file);
}

/**
 * Validates documents against the official schemas. Each document goes through {@link parseXml} first, so a DOCTYPE, a
 * document over a limit or one that is not well-formed is reported without libxml2 seeing it. The schema is the
 * pinned one that the document's `xsi:schemaLocation` names for its root namespace, otherwise the primary schema of
 * that namespace (ASI 3.0.1, results, usage data, metadata, LOM, manifest, and the manifest extension, curriculum
 * standards, accessibility resource and PNP schemas). The schemas are compiled once per set, not per call.
 *
 * @param schemas - The set from {@link loadSchemaSet}.
 * @param files - The documents.
 * @returns The issues of all documents in the order of the files; none when every document is valid. A schema violation
 * has the code `assesskit/node/xsd-invalid`.
 * @throws `DataError` when an argument has the wrong type or the set is closed.
 */
export async function validateXmlFiles(schemas: SchemaSet, files: readonly XmlFile[]): Promise<readonly Issue[]> {
  checkSchemaSet(schemas);
  checkArray(files, "The files must be an array");
  const issues: Issue[] = [];
  for (const file of files) {
    checkRecord(file, "Each file must be an object");
    checkString(file.path, "The path of a file");
    if (!(typeof file.content === "string" || file.content instanceof Uint8Array)) {
      throw new DataError(
        `The content of the file ${JSON.stringify(file.path)} must be a string or a Uint8Array, found ${describe(file.content)}.`,
      );
    }
    issues.push(...validateOne(schemas, file));
  }
  return issues;
}
