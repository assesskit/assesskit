# xml

`@assesskit/runtime/xml` reads XML 1.0 into an immutable tree, writes a tree back, replaces `xi:include` elements, and gives the
readers of typed documents the checks they share.
It is the only XML parser in the runtime: every module that reads a document starts here. It uses no platform API and runs in any
JavaScript runtime. The reader is [saxes](https://github.com/lddubeau/saxes), a namespace-aware parser that rejects
documents that are not well-formed and reads no DTD.

| Export                                                                                | Purpose                                                                    |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `parseXml(input, options?)`                                                           | Parses text or bytes into an `XmlElement`.                                 |
| `serializeXml(root)`                                                                  | Writes an `XmlElement` as a UTF-8 document.                                |
| `ElementReader`, `ReaderRules`                                                        | Reads an element into a model and reports what the model leaves unread.    |
| `buildElement(namespace, name, attributes?, children?)`                               | Builds an element for a writer.                                            |
| `isXmlLanguage(value)`                                                                | Tells whether a value can be the value of `xml:lang`.                      |
| `resolveIncludes(root, base, resolve, options?)`                                      | Replaces each `xi:include` with the root element of the document it names. |
| `childElements(element)`, `attributeOf(element, name, namespace?)`, `textOf(element)` | The child elements, an attribute and the text of an element.               |
| `readError(code, message, source, location?)`, `locationOf(element, path)`            | Build the `ReadError` of one problem, and the location of an element.      |
| `DEFAULT_XML_LIMITS`, `XmlLimits`                                                     | The limits on size, depth, attributes, nodes and include nesting.          |
| `XML_NAMESPACE`, `XMLNS_NAMESPACE`, `XSI_NAMESPACE`, `XINCLUDE_NAMESPACE`             | Namespace URIs the reader and writer treat specially.                      |
| `XmlElement`, `XmlAttribute`, `XmlNode`, `XmlCharacterData`, `XmlInstruction`         | The tree.                                                                  |

## Example

```ts
import { parseXml, resolveIncludes, serializeXml } from "@assesskit/runtime/xml";

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

A document that declares XML 1.1 is a `ReadError`. So is one that has what the parser lets through and a tree could not
keep or write: a lone surrogate in a string (it is no character, XML 1.0 §2.2), a namespace declaration with white space at
its start or end (the parser strips it from the namespace of the elements but keeps it in the declaration), and a qualified
name whose prefix or local part is not an `NCName`, such as `p:1` (Namespaces in XML 1.0 §3).

## Limits

Every limit is a positive integer, and the defaults are about 1,000 times the largest document of the 1EdTech QTI 3.0
examples for size and node count (32 KiB, 1,126 nodes), 16 times its depth (16) and 20 times its attributes on an element (12).

| Limit             | Default    | Unit       | Applies to                                                            |
| ----------------- | ---------- | ---------- | --------------------------------------------------------------------- |
| `maxBytes`        | 33,554,432 | bytes      | The bytes of a document (UTF-8 for a string).                         |
| `maxDepth`        | 256        | levels     | Nesting of elements; the root is depth 1.                             |
| `maxAttributes`   | 256        | attributes | Attributes on one element, namespace declarations included.           |
| `maxNodes`        | 1,000,000  | nodes      | Elements, text, CDATA sections, comments and processing instructions. |
| `maxIncludeDepth` | 8          | levels     | Nesting of includes (`resolveIncludes`).                              |

A limit that a document exceeds throws a `SecurityError` whose `limit` is the limit's name and `value` its value. The
limits are checked while the tree grows: the reader never builds a tree larger than a limit allows. A limit that is not a
positive integer is a `DataError` whose message begins `The limit maxBytes`, and so on for each name.

`maxDepth` also bounds the recursion of everything that walks a tree: the readers of [asi](asi.md), the writers,
`resolveIncludes` and the interpreter of [processing](processing.md), whose expressions are as deep as the document they were
read from. Node.js with its default stack reads, writes and evaluates trees of 1,000 levels, four times the default; raise
`maxDepth` only with a stack to match.

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

## Mapping a document to a model

`ElementReader` is what [results](results.md), [usage](usage.md) and [pnp](pnp.md) read with. It is positioned on one
element and moves forward through its children; `done()` fails when an attribute, a child or text is left, so that no
part of a document is dropped without notice.

```ts
import { ElementReader } from "@assesskit/runtime/xml";

const rules = { module: "demo", source: "DEMO XSD", namespaces: ["urn:demo"] };
const reader = ElementReader.open('<a xmlns="urn:demo" n="12"><b/></a>', rules, "The demo");
reader.attribute("n", Number); // 12
reader.done(); // ReadError: The element b is not allowed in a at this place. (line 1, column 28)
```

| Member                                              | Purpose                                                                                                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ElementReader.open(input, rules, what, options?)`  | Opens a document: text and bytes through `parseXml` with its `options` (`path` names the document in the issues, `limits`), an element as it is. |
| `attribute(name, parse?)`, `required(name, parse?)` | The value of an attribute in no namespace, converted by `parse`; a `DataError` from `parse` becomes a `ReadError` that names the attribute.      |
| `term(name, terms)`, `requiredTerm(name, terms)`    | An attribute that must be one of some terms.                                                                                                     |
| `language()`, `requiredLanguage()`, `base()`        | `xml:lang`, which must be a language tag, and `xml:base`.                                                                                        |
| `take`, `takeAny`, `require`, `takeAll`             | Consume the next child, a run of children, or the next child that must be there.                                                                 |
| `next()`, `foreign`                                 | Consume the next child whatever it is, and tell an extension: an element outside the namespaces of the rules.                                    |
| `takeForeign()`, `extension()`                      | Consume the extensions, which must be in a namespace of their own.                                                                               |
| `text(parse?)`, `leaf(parse)`                       | The text of an element that has no child elements; `leaf` also finishes the element.                                                             |
| `fail(code, message, source?)`, `attempt(...)`      | Build a `ReadError` at the element; run a conversion and turn its `DataError` into one.                                                          |
| `done()`                                            | Fail on an attribute, child or text that was not read. Namespace declarations and `xsi:` attributes never count.                                 |

`ReaderRules` names the module, whose issue codes are `assesskit/<module>/<name>`, the schema every issue cites, the
namespaces of the schema's elements and, optionally, the path of the document. `termOf(terms)` makes the conversion for `text`
and `attribute` that accepts one of some terms. A reader takes the children in the order of the schema. An issue has the line and column of the element and its path, such as
`assessmentResult/itemResult`.

`buildElement` leaves out an attribute whose value is `undefined`, writes a string child as text and drops an empty one;
a name with the prefix `xml:` or `xsi:` is in that namespace. `isXmlLanguage` accepts the language tags of `xs:language`
and the empty string (XML 1.0 §2.12).

## XInclude

`resolveIncludes(root, base, resolve, options?)` replaces each `xi:include` with the root element of the document its
`href` names, then does the same inside that document. `base` is the path of the document of `root`; `resolve(href, base)` is
the caller's function that returns the parsed root of the document, usually with `parseXml`. The runtime never fetches.

| Rule                                                                                                                                                                                               | Source                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Only `parse="xml"` (the default) is included. `parse="text"` is a `ReadError`.                                                                                                                     | INFO §2.12                           |
| `xpointer` is a `ReadError`.                                                                                                                                                                       | INFO §2.12 (MUST NOT)                |
| `href` is required, not empty, and has no fragment identifier.                                                                                                                                     | XInclude 1.0 §3.1                    |
| An include has at most one `xi:fallback` child and no other element of the XInclude namespace; an `xi:fallback` elsewhere is a `ReadError`.                                                        | XInclude 1.0 §3.1, §3.2              |
| If `resolve` throws, the `xi:fallback` takes the include's place (its content is expanded in turn). Without one, the failure is a `ReadError`. A `SecurityError` from `resolve` always propagates. | XInclude 1.0 §4.4                    |
| An include of a document that is already being included is a `ReadError`. Paths are compared after `.` and `..` segments are resolved against `base`.                                              | XInclude 1.0 §4.2.7                  |
| Includes nest at most `maxIncludeDepth` deep; the result has at most `maxDepth` levels and `maxNodes` nodes.                                                                                       | The runtime limits                   |
| `encoding`, `accept` and `accept-language` are ignored; `xml:base` and `xml:lang` are not added to included roots.                                                                                 | XInclude 1.0 §4.5.5, §4.5.6 allow it |

An include that is the root of the tree must be replaced by exactly one element.

## Reading a tree without mapping it

`childElements`, `attributeOf` and `textOf` read a tree you do not map completely, such as the parts of an element that a
model keeps as XML. `lomGeneral` of [metadata](metadata.md) reads the title and identifiers of a LOM this way. They never
fail: an attribute or a child that is not there is `undefined` or left out. A reader that maps a whole document uses
`ElementReader`.

## Errors

| Code                               | Class       | Meaning                                                                            | Source                                       |
| ---------------------------------- | ----------- | ---------------------------------------------------------------------------------- | -------------------------------------------- |
| `assesskit/xml/not-well-formed`    | `ReadError` | The document is not well-formed, has a lone surrogate or a bad qualified name.     | XML 1.0 §2.1, §2.2, Namespaces in XML 1.0 §3 |
| `assesskit/xml/version`            | `ReadError` | The document declares XML 1.1.                                                     | XML 1.0 §2.8                                 |
| `assesskit/xml/encoding`           | `ReadError` | Bytes in an unsupported, contradicting or invalid encoding.                        | XML 1.0 §4.3.3                               |
| `assesskit/xml/namespace`          | `ReadError` | A namespace declaration with white space at its start or end.                      | Namespaces in XML 1.0 §2.2                   |
| `assesskit/xml/xinclude-attribute` | `ReadError` | An include has an `xpointer`, a `parse` other than `xml`, or a bad `href`.         | INFO §2.12, XInclude 1.0 §3.1                |
| `assesskit/xml/xinclude-structure` | `ReadError` | Misplaced or repeated `xi:fallback`, or a root replaced by other than one element. | XInclude 1.0 §3.1, §3.2                      |
| `assesskit/xml/xinclude-cycle`     | `ReadError` | Includes form a loop.                                                              | XInclude 1.0 §4.2.7                          |
| `assesskit/xml/xinclude-resource`  | `ReadError` | The resolver failed and the include has no fallback.                               | XInclude 1.0 §4.4                            |

`ReadError.issues` has one issue with the code, the path, and the line and column where the parser stopped.
