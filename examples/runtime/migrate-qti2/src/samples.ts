import { readFileSync } from "node:fs";
import { join } from "node:path";
import { attributeOf, childElements, parseXml, type XmlElement } from "@assesskit/runtime/xml";

/** The type of a resource that is a QTI 2.2 item in a content package. */
const ITEM_RESOURCE_TYPE = "imsqti_item_xmlv2p2";

/** An item of a QTI 2 package with the files its manifest lists for it: the local closure that a migration needs. */
export interface Sample {
  /** The identifier of the resource in the manifest. */
  readonly identifier: string;
  /** The path of the item document in the package. */
  readonly href: string;
  /** The bytes of the item and of the files it uses, by path in the package. */
  readonly files: Readonly<Record<string, Uint8Array>>;
}

/** Returns the child elements of an element that have a local name. */
const named = (element: XmlElement, name: string): readonly XmlElement[] =>
  childElements(element).filter((child) => child.name === name);

/**
 * Reads the items that the manifest of a QTI 2.2 package lists, each with the files of its resource.
 *
 * @param directory - A directory with `imsmanifest.xml` and the files it names, such as `items` of the 1EdTech examples of QTI 2.2.
 * @returns The samples, in the order of the manifest.
 * @throws `ReadError` when the manifest is not well-formed; `Error` when a file the manifest names is missing.
 */
export function readSamples(directory: string): readonly Sample[] {
  const manifest = parseXml(readFileSync(join(directory, "imsmanifest.xml")));
  return named(manifest, "resources").flatMap((resources) =>
    named(resources, "resource").flatMap((resource) => {
      const identifier = attributeOf(resource, "identifier");
      const href = attributeOf(resource, "href");
      if (attributeOf(resource, "type") !== ITEM_RESOURCE_TYPE || identifier === undefined || href === undefined) {
        return [];
      }
      const paths = new Set(named(resource, "file").flatMap((file) => attributeOf(file, "href") ?? []));
      const files = Object.fromEntries(
        [...paths].map((path): [string, Uint8Array] => [path, new Uint8Array(readFileSync(join(directory, path)))]),
      );
      return [{ identifier, href, files }];
    }),
  );
}
