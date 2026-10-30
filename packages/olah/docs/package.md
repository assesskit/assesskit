# package

`@luthfanwakan/olah/package` reads and writes QTI content packages (BIND §8): the manifest, the ZIP archive, the documents
inside, the resolvers that the delivery engine uses, LTI link documents and the dependency closure. It uses no platform
API and runs in any JavaScript runtime. [node](node.md) adds reading from files and directories.

| Export                                           | Purpose                                                                          |
| ------------------------------------------------ | -------------------------------------------------------------------------------- |
| `readPackage(zip, options?)`                     | Reads a ZIP archive into a `QtiPackage`.                                         |
| `openPackage(files, options?)`                   | Builds a `QtiPackage` from any `PackageFiles`: an archive, a directory, a store. |
| `QtiPackage`                                     | `manifest`, `paths`, `file(path)`, `document(path)`, `resolve(base, href)`.      |
| `writePackage(manifest, files)`                  | Writes a manifest and files as a ZIP archive.                                    |
| `readManifest(input, options?)`, `writeManifest` | The manifest, `Manifest`, `Resource`, `ResourceFile` and `Variant`.              |
| `resourcePath(manifest, resource, href?)`        | The path in the package that an href of a resource names.                        |
| `resolveReference(base, href)`                   | `resolve` of a `QtiPackage` without the package.                                 |
| `dependencyClosure(manifest, identifier)`        | A resource with the resources it depends on.                                     |
| `packageResolvers(pkg)`                          | The `Resolvers` of the engine: items with their variants, sections and stimuli.  |
| `readLtiLink(input, options?)`, `LtiLink`        | The `cartridge_basiclti_link` document of an LTI resource.                       |
| `DEFAULT_ZIP_LIMITS`, `ZipLimits`                | The limits on archives and directories.                                          |
| `RESOURCE_TYPES`, `MANIFEST_SCHEMAS`             | The vocabularies of the manifest.                                                |

## Example

```ts
import {
  dependencyClosure,
  packageResolvers,
  readManifest,
  readPackage,
  writePackage,
} from "@luthfanwakan/olah/package";

const manifest = readManifest(`<manifest xmlns="http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1" identifier="demo">
  <metadata><schema>QTI Package</schema><schemaversion>3.0.0</schemaversion></metadata>
  <organizations/>
  <resources>
    <resource identifier="test" type="imsqti_test_xmlv3p0" href="test.xml">
      <file href="test.xml"/><dependency identifierref="capital"/>
    </resource>
    <resource identifier="capital" type="imsqti_item_xmlv3p0" href="items/capital.xml">
      <file href="items/capital.xml"/><file href="media/map.png"/>
    </resource>
  </resources>
</manifest>`);
dependencyClosure(manifest, "test").map(({ identifier }) => identifier); // ["test", "capital"]

const text = new TextEncoder();
const zip = writePackage(
  manifest,
  new Map([
    [
      "test.xml",
      text.encode(
        '<qti-assessment-test xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="t" title="T"/>',
      ),
    ],
    [
      "items/capital.xml",
      text.encode(
        '<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="capital" title="Capital" adaptive="false" time-dependent="false"/>',
      ),
    ],
    ["media/map.png", new Uint8Array([137, 80, 78, 71])],
  ]),
);

const pkg = readPackage(zip);
pkg.paths; // ["imsmanifest.xml", "test.xml", "items/capital.xml", "media/map.png"]
pkg.resolve("items/capital.xml", "../media/map.png"); // "media/map.png"
pkg.resolve("items/capital.xml", "http://example.com/x.png"); // undefined: outside the package
packageResolvers(pkg).items("items/capital.xml", "test.xml").deliverable.kind; // "qti"
```

## The manifest

`readManifest` accepts text, bytes or a parsed root element, and takes the options of `parseXml` (`path`, `limits`). The root must
be `manifest` in `http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1`; the namespace of IMS Content Packaging 1.1 that some
samples use is a `ReadError` (D6). The reader follows the CP schema for the structure and rejects what the model cannot hold:

| Rule                                                                                                                                                                                                     | Code                                               | Source      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ----------- |
| The root is a `manifest` of the content package namespace.                                                                                                                                               | `olah/package/not-a-manifest`                      | CP XSD      |
| `metadata/schema` is one of `MANIFEST_SCHEMAS`, and `schemaversion` is `3.0.0`.                                                                                                                          | `olah/package/invalid-text`                        | BIND §8     |
| A resource `type` is one of the 19 of `RESOURCE_TYPES`. `imslti_xmlv1p1`, which BIND §8.8 lists and the CP schema does not, is read as `imsbasiclti_xmlv1p3`, because 1EdTech's own LTI examples use it. | `olah/package/invalid-attribute`                   | CP XSD      |
| `organizations` is empty or absent: the profile prohibits `cp:organization`, `cp:item` and nested manifests.                                                                                             | `olah/package/organizations`, `unexpected-element` | BIND §8     |
| Identifiers are declared once, among the manifest, the resources and the variants.                                                                                                                       | `olah/package/duplicate-identifier`                | CP XSD (ID) |
| Every `dependency` and `variant` `identifierref` names a resource.                                                                                                                                       | `olah/package/dangling-reference`                  | BIND §8.1   |
| The elements come in the order of the schema, required ones and attributes are there, and nothing is outside the schema.                                                                                 | `olah/package/*`                                   | CP XSD      |

The reader does not check that files exist; the manifest of a package can list a file that the archive lacks (the 1EdTech `pci`
example does), and `file(path)` then returns `undefined`.

The model differs from the XML in three places. `organizations` is not kept, and `writeManifest` always writes it empty.
`schemaversion` is not kept, and is always `3.0.0`. `resourcesBase` holds the `xml:base` of the `resources` element, next to
`base` of the manifest and of each resource. `writeManifest` throws a `DataError` for a manifest that the CP schema would reject:
an identifier that is not an XML name or is declared twice, a vocabulary term outside its list, a resource with no file, a
`dependency` or `variant` that names no resource. It declares the namespaces of QTI metadata, curriculum standards, the DRD and the
manifest extension once, on the root.

## Paths

Every path in a package is relative to the root, uses `/`, and is normalized: no empty or `.` segment, no `..`. `resolve(base, href)`
resolves a reference against the path of the file that holds it (RFC 3986 §5.2 on package paths, B93). A `base` that ends in `/`
stands for a directory, as an `xml:base` does. The query and fragment are dropped, and percent-encoded octets are decoded as UTF-8
(`my%20file.png` names `my file.png`).

| Base          | Reference        | Result        |
| ------------- | ---------------- | ------------- |
| `b/c/d;p`     | `g`, `./g`       | `b/c/g`       |
| `b/c/d;p`     | `../g`           | `b/g`         |
| `b/c/d;p`     | `../../g`        | `g`           |
| `b/c/d;p`     | `g?y#s`          | `b/c/g`       |
| `items/`      | `a.xml`          | `items/a.xml` |
| `items/a.xml` | `../media/x.png` | `media/x.png` |
| `items/`      | `../../x`        | `undefined`   |
| `items/`      | `//host/x`       | `undefined`   |

The result is `undefined` for a reference outside the package: one with a scheme (`http:`, `data:`, `file:`), one that starts with
`/` or `//`, one that leaves the root with `..`, and one with a backslash, a drive letter, a control character (NUL included) or an
invalid percent-encoding in a segment. It does not say whether the file exists.

`resourcePath(manifest, resource, href?)` resolves the `href` of a resource, or the `href` it is given (such as one of its files),
against the `xml:base` of the manifest, of `resources` and of the resource, each against the one before.

## Archives

`readPackage(zip, options?)` takes the bytes of a ZIP archive. It reads the central directory and the manifest, and inflates
a file when `file(path)` asks for it; a package of 10,000 items costs the manifest and the items a session touches. Options:

| Option      | Default              | Meaning                                                        |
| ----------- | -------------------- | -------------------------------------------------------------- |
| `limits`    | `DEFAULT_ZIP_LIMITS` | Limits that replace the defaults, field by field.              |
| `xmlLimits` | `DEFAULT_XML_LIMITS` | XML limits for the manifest and every document of the package. |

The reader supports stored and deflated entries, UTF-8 names, directory entries (left out of `paths`), data descriptors, archive
comments and ZIP64 (the ZIP64 end of central directory record and locator, and the 64-bit values in the extra field). It does not
read archives in several parts, other compression methods, or encrypted entries. `writePackage` writes the classic format only:
it throws a `DataError` for more than 65,534 files or an archive of 4 GiB or more, which `DEFAULT_ZIP_LIMITS` keeps far from
reach. It writes the manifest first, then the files in the order of the map, deflated when that makes them smaller, with one fixed
time stamp, so that equal input gives equal bytes.

### Security checks

| Threat                                | Control                                                                                                                                                                  | Error                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| Zip-slip, absolute paths              | An entry name that is absolute, leaves the root with `..`, or has a backslash, a drive letter or a control character rejects the archive. A directory entry too.         | `SecurityError`, `limit` `"path"`           |
| Two names for one file                | Two entries with the same normalized name (`a.xml` and `./a.xml`) reject the archive.                                                                                    | `SecurityError`, `limit` `"duplicate-path"` |
| Symbolic links                        | An entry made on Unix or OS X (host 3 or 19) whose mode is a symbolic link rejects the archive.                                                                          | `SecurityError`, `limit` `"symlink"`        |
| Encrypted entries                     | General purpose bit 0, 6 or 13 rejects the archive.                                                                                                                      | `SecurityError`, `limit` `"encrypted"`      |
| Too many entries                      | The count in the end record is checked against `maxEntries` before the directory is read.                                                                                | `SecurityError`, `limit` `"maxEntries"`     |
| Large entries and archives, zip bombs | Declared sizes in the central directory are checked against `maxEntryBytes`, `maxTotalBytes` and `maxRatio`; an entry of at most 102,400 bytes is exempt from the ratio. | `SecurityError`, `limit` the limit's name   |
| Headers that lie                      | While an entry inflates, the output is counted in 8 KiB steps of input and stops at the size the header declares.                                                        | `SecurityError`, `limit` `"declaredBytes"`  |
| Corrupt or mismatched data            | Each entry's local header must name the file the central directory names; the size and CRC-32 must match; truncation is detected.                                        | `ReadError`, code `olah/package/zip`        |

`file(path)` returns a copy of the bytes. `ZipLimits`:

| Limit           | Default       | Unit    | Applies to                                                                                 |
| --------------- | ------------- | ------- | ------------------------------------------------------------------------------------------ |
| `maxEntries`    | 100,000       | entries | Entries of an archive, directories included; files and directories of a package directory. |
| `maxEntryBytes` | 536,870,912   | bytes   | The uncompressed bytes of one file.                                                        |
| `maxTotalBytes` | 2,147,483,648 | bytes   | The uncompressed bytes of all files.                                                       |
| `maxRatio`      | 250           | ratio   | Uncompressed over compressed size of an entry above 102,400 bytes.                         |

The largest package of the 1EdTech QTI 3.0 examples has 99 entries, an entry of 5.0 MiB and 11.0 MB uncompressed; its largest ratio
is 27.9, on a 7.5 KB entry, and 3.6 on the entries above 102,400 bytes. The defaults are about 1,000, 100, 200 and 9 times those.

## Documents

`pkg.document(path)` parses the file at the path once and keeps the result. It resolves `xi:include` elements with `resolveIncludes`:
a target is read from the package only; a target outside it is a `SecurityError` (`limit` `"path"`) that no `xi:fallback`
hides; a missing target uses its fallback or is a `ReadError`. A file that several includes name is read and parsed once for
the document, or fails once, so that a document cannot make the reader repeat the work of a large file. Then it reads the tree
with `readAsi` of [asi](asi.md). The manifest and the documents use the `xmlLimits`.

## Resolvers

`packageResolvers(pkg)` returns the three functions that the delivery engine takes. Each takes the `href` as written and the path of
the document that holds it.

| Function               | Resolves to                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------- |
| `items(href, base)`    | A `ResolvedItem`: `resource` (the identifier), `deliverable`, `hazards` and `variants`. |
| `sections(href, base)` | The `AssessmentSection` at the path.                                                    |
| `stimuli(href, base)`  | The `AssessmentStimulus` at the path (B62).                                             |

An item reference names a file. It resolves to the resource of type `imsqti_item_xmlv3p0` or `imsbasiclti_xmlv1p3` whose main
file is that file: its `href`, or its only file when it has no `href`. The `deliverable` is `{ kind: "qti", item }` for a QTI item,
and `{ kind: "lti", identifier, link }` for an LTI link, read with `readLtiLink`. The variants (BIND §8.1.1) are resolved the same
way and keep the DRD of their link, so that the engine can choose among them at the first presentation:

| Field      | Content                                                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `variants` | One entry for each `cpx:variant` of the resource: `resource` (the variant's identifier), `deliverable` and `drd`.                       |
| `hazards`  | The hazards of `DRD_HAZARDS` that the DRD of the variant links pointing at this resource name, once each. Extension terms are left out. |

The resolvers choose nothing. They throw a `ReadError` for a reference outside the package (`olah/package/outside-package`), one that
no item resource names (`olah/package/unknown-resource`), a missing file (`olah/package/missing-file`), a document of another kind
(`olah/package/document-kind`), and a variant whose resource has no main file inside the package (`olah/package/resource-href`).
They are synchronous, as the package holds its files; a resolver that a host writes returns its value and never a promise.

## Dependencies

`dependencyClosure(manifest, identifier)` returns the resource, then each resource it depends on once, depth first in the order of
the `dependency` elements; a cycle ends where it closes. A test depends on its items, an item on a shared stimulus (B62), an item on
a separate outcome declaration or response processing template resource (B91). Variants are not part of the closure.

## LTI links

`readLtiLink(input, options?)` reads the `cartridge_basiclti_link` document of a resource of type `imsbasiclti_xmlv1p3`
(BPIG §6.2.9.2): `title`, `description`, `launchUrl`, `secureLaunchUrl`, `custom` (a `Map`), `extensions` (a platform and a `Map`)
and `vendor`. Text is read without the white space around it. The root is accepted in `http://www.imsglobal.org/xsd/imslticc_v1p0`
and in the relative namespace `/xsd/imslticc_v1p0` that the 1EdTech examples declare. A document without a title, a property
without a name or with a repeated name, or a vendor without a code is a `ReadError` (`olah/package/lti-link`,
`olah/package/lti-property`). Launching the tool belongs to the player.

## Errors

| Class           | Thrown when                                                                                                                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DataError`     | An argument has the wrong type, a limit is not a positive integer, the paths of `PackageFiles` are not normalized and unique, or `writeManifest` and `writePackage` get a model that is not valid. |
| `ReadError`     | The data is not a ZIP archive or is cut off; a manifest, document or link cannot be read; a reference cannot be resolved. `issues` names the rule.                                                 |
| `SecurityError` | The input breaks a rule or limit of the table above, or an XML limit.                                                                                                                              |
