# PCI

`@luthfanwakan/olah/pci` is what a delivery engine and a player need of a portable custom interaction (PCI) besides the
interaction's own code ([BPIG] §3.7.12): the JSON in which variables travel to and from the module, the files that tell
where its modules are, the properties it receives, and checks of the interaction. It imports `values` and `asi` and runs
in any JavaScript runtime. Loading and running the module (the AMD loader, the timeouts, the fallback, the sandbox) is the
player's: tempuh's PCI frame.

| Export                                                                                                                            | Purpose                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `encodePciValue(value, declaration, files)`                                                                                       | The JSON of BPIG Appendix C for a value; the bytes of a file value come from `files.load`.   |
| `decodePciValue(json, declaration, files)`                                                                                        | The value for the JSON a module gives; the bytes of a file go to `files.store`.              |
| `parseModuleResolution(text)`                                                                                                     | A module resolution configuration file (BPIG App. D) as a `ModuleResolution`.                |
| `moduleConfigurationPaths(interaction)`                                                                                           | The package paths of the two configuration files of an interaction, with their defaults.     |
| `resolvePciModules(interaction, configuration)`                                                                                   | The modules of an interaction and where each is, as `PciModule`s.                            |
| `pciProperties(interaction)`                                                                                                      | The `data-*` attributes as the properties a module receives.                                 |
| `checkPortableInteraction(interaction, configuration)`                                                                            | `Issue`s for modules that no configuration locates and for a type identifier that is no URN. |
| `isPackageRelative(location)`                                                                                                     | Whether a module location is a path in the package.                                          |
| `DEFAULT_WAIT_SECONDS`                                                                                                            | 7, the timeout when a configuration file gives none.                                         |
| `PciJson`, `PciFileLoader`, `PciFileStore`, `ModuleResolution`, `ModuleConfigurationPaths`, `PciModule`, `PciModuleConfiguration` | The types.                                                                                   |

## Example

```ts
import { readAsi } from "@luthfanwakan/olah/asi";
import {
  checkPortableInteraction,
  decodePciValue,
  encodePciValue,
  moduleConfigurationPaths,
  parseModuleResolution,
  pciProperties,
  resolvePciModules,
} from "@luthfanwakan/olah/pci";
import { container } from "@luthfanwakan/olah/values";

// The host reads the file at moduleConfigurationPaths(interaction).primary from the package.
const primary = parseModuleResolution(
  '{"waitSeconds": 15, "paths": {"likert": "modules/likert", "handlebars": "https://cdn.example/handlebars"}}',
);

const document = readAsi(`<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0"
    identifier="pci" title="PCI" time-dependent="false">
  <qti-item-body>
    <qti-portable-custom-interaction response-identifier="RESPONSE" module="likert"
        custom-interaction-type-identifier="urn:fdc:example.com:2024:pci:likert"
        data-label-min="Very Poorly" data-max-choices-message="Too many">
      <qti-interaction-markup/>
    </qti-portable-custom-interaction>
  </qti-item-body>
</qti-assessment-item>`);

const [interaction] = document.kind === "item" ? (document.item.body?.children ?? []) : [];
if (interaction?.kind === "portable-custom-interaction") {
  moduleConfigurationPaths(interaction); // { primary: "modules/module_resolution.js", fallback: "modules/fallback_module_resolution.js" }
  resolvePciModules(interaction, { primary });
  // [{ id: "likert", primary: "modules/likert", packageRelative: true },
  //  { id: "handlebars", primary: "https://cdn.example/handlebars", packageRelative: false }]
  [...pciProperties(interaction)]; // [["labelMin", "Very Poorly"], ["maxChoicesMessage", "Too many"]]
  checkPortableInteraction(interaction, { primary }); // []
}

encodePciValue(
  container("multiple", "integer", [3, 4]),
  { cardinality: "multiple", baseType: "integer" },
  { load: () => "" },
);
// { list: { integer: [3, 4] } }

decodePciValue(
  { base: { file: { data: "cGxlYXN1cmUu", mime: "text/plain", name: "helloworld.txt" } } },
  { cardinality: "single", baseType: "file" },
  { store: () => "file-1" },
);
// { cardinality: "single", baseType: "file", value: { reference: "file-1", mimeType: "text/plain", fileName: "helloworld.txt" } }
```

## The JSON of variables

`encodePciValue` and `decodePciValue` read and write the plain binding of BPIG Appendix C.1 to C.3: `{ "base": … }` for a
single value, `{ "list": … }` for `multiple` and `ordered`, and `{ "record": … }`, and NULL as `null` inside each. A
PCI receives its template variables, its context variables and its response in this form, and gives its response back in
it. They are the codec `toJsonValue` and `fromJsonValue` of `values`, with the files of Appendix C:

- A file is `{ "data": <base64>, "mime", "name"? }`. A file value only refers to its bytes (D7), so `encodePciValue` calls
  `files.load(reference)` for each file and `decodePciValue` calls `files.store(data, mimeType, fileName?)` and keeps the
  reference it returns. Both callbacks are synchronous; a host with asynchronous storage fetches the bytes before it
  encodes and uploads them after it decodes. Neither is called for a value without a file.
- A duration is `PT<seconds>S`. A duration with years or months has no fixed length, and `decodePciValue` refuses it, the
  example `P10Y3M20DT4H30M25S` of Appendix C.1 included (G14, G39).
- `intOrIdentifier` is read as the declared base type, and in a record as an integer for a number and an identifier for a
  string (G38). A field of a record that is NULL is left out of the record (G37).
- A float that JSON cannot carry (`NaN`, `INF`, `-INF`, `-0`) is the string with that spelling.

Both functions throw `DataError` for JSON that is not the JSON of a value of the declaration, so a message from a
module is untrusted until it has gone through `decodePciValue`.

## Modules

A module resolution file (BPIG §3.7.12.2, App. D) is JSON with `waitSeconds` and `paths`. `parseModuleResolution` reads
it; other properties are ignored, and `waitSeconds` is 7 when absent and 0 for no timeout. The paths have no `.js`
extension; a path with a protocol is fetched from there and any other is a path in the package.

The two files of an interaction are `primary-configuration` (`modules/module_resolution.js` by default) and
`secondary-configuration` (`modules/fallback_module_resolution.js`), which BPIG calls the fallback configuration.
`moduleConfigurationPaths` gives their package paths.

`resolvePciModules` lists the modules in this order: the module of the `module` attribute, the `qti-interaction-module`s in
document order, then the modules that only the configuration files name, which are dependencies of the PCI's modules. For
each it gives the primary and fallback location:

| Source                                         | Primary location                     | Fallback location                     |
| ---------------------------------------------- | ------------------------------------ | ------------------------------------- |
| `primary-path` / `fallback-path` of the module | wins                                 | wins                                  |
| the configuration files                        | `paths` of the primary configuration | `paths` of the fallback configuration |

`packageRelative` says whether the first location to load, the primary one or else the fallback, is a path in the package.
The host requires the module of the `module` attribute or, when there is none, those of `qti-interaction-modules`; it
gives the others to its loader as paths, with `waitSeconds` of the primary configuration as the timeout. The host also
decides which package paths it may serve (BPIG §3.7.12.2 lets it ignore those the manifest does not list).

## Properties

`pciProperties` gives the custom `data-*` attributes of the interaction, named as `element.dataset` names them: the
prefix goes and a hyphen followed by a lowercase letter becomes that letter in capitals, so `data-max-choices-message`
is `maxChoicesMessage` and `data-selected_color` stays `selected_color` (BPIG §3.7.12.7.1). `data-catalog-idref` and
`data-qti-suppress-tts` are QTI's own and are not properties.

## Checks

`checkPortableInteraction` returns `Issue`s (BPIG §3.7.12, §3.7.12.4):

| Code                             | Severity | Reported when                                                                                     |
| -------------------------------- | -------- | ------------------------------------------------------------------------------------------------- |
| `olah/pci/no-module`             | error    | the interaction has neither a `module` attribute nor `qti-interaction-modules`                    |
| `olah/pci/module-not-configured` | error    | the `module` or a `qti-interaction-module` has no location in the configurations or its own paths |
| `olah/pci/type-identifier`       | warning  | `custom-interaction-type-identifier` is not a Federated Content URN (`urn:fdc:`)                  |

## Evidence

The tests read every example of Appendix C, the module resolution files of the PCI packages of the 1EdTech examples and
their six PCIs. A property test writes and reads values of every cardinality and base type, files included, through an
in-memory host.
