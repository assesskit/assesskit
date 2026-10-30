# xml

`@luthfanwakan/olah/xml` reads XML 1.0 into an immutable tree, writes a tree back, and replaces `xi:include` elements.
It is the only XML parser in olah: every module that reads a document starts here. It uses no platform API and runs in any
JavaScript runtime. The reader is [saxes](https://github.com/lddubeau/saxes), a namespace-aware parser that rejects
documents that are not well-formed and reads no DTD.

| Export                                                                        | Purpose                                                                    |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `parseXml(input, options?)`                                                   | Parses text or bytes into an `XmlElement`.                                 |
| `serializeXml(root)`                                                          | Writes an `XmlElement` as a UTF-8 document.                                |
| `resolveIncludes(root, base, resolve, options?)`                              | Replaces each `xi:include` with the root element of the document it names. |
| `DEFAULT_XML_LIMITS`, `XmlLimits`                                             | The limits on size, depth, attributes, nodes and include nesting.          |
| `XML_NAMESPACE`, `XMLNS_NAMESPACE`, `XINCLUDE_NAMESPACE`                      | Namespace URIs the reader and writer treat specially.                      |
| `XmlElement`, `XmlAttribute`, `XmlNode`, `XmlCharacterData`, `XmlInstruction` | The tree.                                                                  |

## Example

```ts
import { parseXml, resolveIncludes, serializeXml } from "@luthfanwakan/olah/xml";

const NAMESPACE = "http://www.imsglobal.org/xsd/imsqtiasi_v3p0";
const fragments = new Map([
  ["fragments/prompt.xml", `<qti-prompt xmlns="${NAMESPACE}">Which city is the capital?</qti-prompt>`],
]);

const item = parseXml(
  `<qti-assessment-item xmlns="${NAMESPACE}" xmlns:xi="http://www.w3.org/2001/XInclude" identifier="capital">
  <xi:include href="fragments/prompt.xml"/>
</qti-assessment-item>`,
  { path: "items/capital.xml" },
);
item.name; // "qti-assessment-item"
item.namespace; // "http://www.imsglobal.org/xsd/imsqtiasi_v3p0"
[item.line, item.column]; // [1, 1]

const resolved = resolveIncludes(item, "items/capital.xml", (href) => {
  const source = fragments.get(href);
  if (source === undefined) throw new Error(`${href} is not in the package.`);
  return parseXml(source, { path: href });
});
serializeXml(resolved);
// <?xml version="1.0" encoding="UTF-8"?>
// <qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" xmlns:xi="http://www.w3.org/2001/XInclude" identifier="capital">
//   <qti-prompt xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0">Which city is the capital?</qti-prompt>
// </qti-assessment-item>
```

## The tree

| Node                         | Fields                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| element                      | `kind: "element"`, `namespace`, `name` (local), `prefix?`, `attributes`, `children`, `line?`, `column?` |
| attribute                    | `namespace`, `name` (local), `prefix?`, `value`                                                         |
| text, CDATA section, comment | `kind: "text" \| "cdata" \| "comment"`, `value`                                                         |
| processing instruction       | `kind: "instruction"`, `target`, `data`                                                                 |

- A name in no namespace has the namespace `""`. `prefix` is absent when the name has none.
- Namespace declarations are attributes: `xmlns="u"` has the namespace `XMLNS_NAMESPACE`, the name `xmlns` and no prefix;
  `xmlns:p="u"` has the name `p` and the prefix `xmlns`.
- Children and attributes keep document order. Entity and character references are replaced, line ends are normalized to a
  line feed (XML 1.0 §2.11), and attribute values are normalized (§3.3.3). Adjacent text is one node.
- The tree leaves out the XML declaration and whatever precedes and follows the root element.
- `line` and `column` (from 1, columns count characters) locate the start tag of an element that `parseXml` read.

## Reading

`parseXml(input, options?)` takes a string or a `Uint8Array` and these options:

| Option   | Default              | Meaning                                              |
| -------- | -------------------- | ---------------------------------------------------- |
| `path`   | none                 | The path of the document; errors and issues name it. |
| `limits` | `DEFAULT_XML_LIMITS` | Limits that replace the defaults field by field.     |

A string is taken as it is: the encoding it declares is ignored. Bytes are decoded by XML 1.0 §4.3.3 and App. F.1:

| Bytes begin with                     | Encoding                                                                                              |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| a UTF-8 or UTF-16 byte order mark    | The mark's. A declaration that names another family is a `ReadError`.                                 |
| no mark, and `encoding="x"` declared | `x`, when `TextDecoder` supports it; otherwise a `ReadError`. UTF-16 without a mark is a `ReadError`. |
| no mark and no declaration           | UTF-8. Bytes that are not valid UTF-8 are a `ReadError`.                                              |

A document that declares XML 1.1 is a `ReadError`.

## Limits

Every limit is a positive integer, and the defaults are about 1,000 times the largest document of the 1EdTech QTI 3.0
examples for size and node count (32 KiB, 1,126 nodes), 16 times its depth (16) and 20 times its attributes on an element (12).

| Limit             | Default    | Applies to                                                            |
| ----------------- | ---------- | --------------------------------------------------------------------- |
| `maxBytes`        | 33,554,432 | The bytes of a document (UTF-8 for a string).                         |
| `maxDepth`        | 256        | Nesting of elements; the root is depth 1.                             |
| `maxAttributes`   | 256        | Attributes on one element, namespace declarations included.           |
| `maxNodes`        | 1,000,000  | Elements, text, CDATA sections, comments and processing instructions. |
| `maxIncludeDepth` | 8          | Nesting of includes (`resolveIncludes`).                              |

A limit that a document exceeds throws a `SecurityError` whose `limit` is the limit's name and `value` its value. The
limits are checked while the tree grows: the reader never builds a tree larger than a limit allows.

## Security

| Threat                                 | Control                                                                                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| XXE, entity expansion (billion laughs) | Any DOCTYPE throws a `SecurityError` with `limit` `"doctype"` before an entity is declared. Only the five predefined entities and character references exist (BPIG §6.7). |
| Network and file access                | The reader and the writer read nothing. `resolveIncludes` calls only the resolver the caller passes.                                                                      |
| Oversized, deep or wide documents      | The limits above.                                                                                                                                                         |
| Prototype pollution                    | The tree is arrays of objects with fixed fields; a name such as `__proto__` is data.                                                                                      |

## Writing

`serializeXml(root)` writes `<?xml version="1.0" encoding="UTF-8"?>`, a line feed and the element. It adds no white space.

- Text escapes `&`, `<`, `>` and the carriage return. Attribute values also escape the quote, the tab and the line feed.
- A CDATA section that contains `]]>` is split into two sections at that sequence.
- A carriage return in a CDATA section, comment or processing instruction is written as it is, and a parser reads it as a line feed.
- A namespace that the tree uses without declaring it in scope is declared on the element that uses it, including `xmlns=""`
  when an element in no namespace sits inside a default namespace. A tree from `parseXml` already has its declarations.
- It throws `DataError` for a tree that cannot be written as well-formed XML: a character XML 1.0 does not allow, a name that is not
  an NCName, a prefix without a namespace or a namespace without a prefix on an attribute, one prefix for two namespaces on an
  element, a repeated attribute, `--` in a comment, a processing instruction named `xml` or containing `?>`. The message names the element.

## XInclude

`resolveIncludes(root, base, resolve, options?)` replaces each `xi:include` with the root element of the document its
`href` names, then does the same inside that document. `base` is the path of the document of `root`; `resolve(href, base)` is
the caller's function that returns the parsed root of the document, usually with `parseXml`. olah never fetches.

| Rule                                                                                                                                                                                               | Source                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Only `parse="xml"` (the default) is included. `parse="text"` is a `ReadError`.                                                                                                                     | INFO §2.12                           |
| `xpointer` is a `ReadError`.                                                                                                                                                                       | INFO §2.12 (MUST NOT)                |
| `href` is required, not empty, and has no fragment identifier.                                                                                                                                     | XInclude 1.0 §3.1                    |
| An include has at most one `xi:fallback` child and no other element of the XInclude namespace; an `xi:fallback` elsewhere is a `ReadError`.                                                        | XInclude 1.0 §3.1, §3.2              |
| If `resolve` throws, the `xi:fallback` takes the include's place (its content is expanded in turn). Without one, the failure is a `ReadError`. A `SecurityError` from `resolve` always propagates. | XInclude 1.0 §4.4                    |
| An include of a document that is already being included is a `ReadError`. Paths are compared after `.` and `..` segments are resolved against `base`.                                              | XInclude 1.0 §4.2.7                  |
| Includes nest at most `maxIncludeDepth` deep; the result has at most `maxDepth` levels and `maxNodes` nodes.                                                                                       | olah limits                          |
| `encoding`, `accept` and `accept-language` are ignored; `xml:base` and `xml:lang` are not added to included roots.                                                                                 | XInclude 1.0 §4.5.5, §4.5.6 allow it |

An include that is the root of the tree must be replaced by exactly one element.

## Errors

| Code                          | Class       | Meaning                                                                            | Source                        |
| ----------------------------- | ----------- | ---------------------------------------------------------------------------------- | ----------------------------- |
| `olah/xml/not-well-formed`    | `ReadError` | The document is not well-formed.                                                   | XML 1.0 §2.1                  |
| `olah/xml/version`            | `ReadError` | The document declares XML 1.1.                                                     | XML 1.0 §2.8                  |
| `olah/xml/encoding`           | `ReadError` | Bytes in an unsupported, contradicting or invalid encoding.                        | XML 1.0 §4.3.3                |
| `olah/xml/xinclude-attribute` | `ReadError` | An include has an `xpointer`, a `parse` other than `xml`, or a bad `href`.         | INFO §2.12, XInclude 1.0 §3.1 |
| `olah/xml/xinclude-structure` | `ReadError` | Misplaced or repeated `xi:fallback`, or a root replaced by other than one element. | XInclude 1.0 §3.1, §3.2       |
| `olah/xml/xinclude-cycle`     | `ReadError` | Includes form a loop.                                                              | XInclude 1.0 §4.2.7           |
| `olah/xml/xinclude-resource`  | `ReadError` | The resolver failed and the include has no fallback.                               | XInclude 1.0 §4.4             |

`ReadError.issues` has one issue with the code, the path, and the line and column where the parser stopped.
