import {
  migrateQtiResourceToQti3,
  type QtiMigrationDiagnostic,
  type QtiMigrationOptions,
} from "@longsightgroup/qti3-migrator";
import type { Sample } from "./samples.ts";

const ENCODER = new TextEncoder();

/** The path of the manifest in a package. */
const MANIFEST_PATH = "imsmanifest.xml";

/**
 * Returns the manifest with the `schemaversion` that the schema of the package allows.
 *
 * @remarks
 * The migrator writes `3.0.1`, and the schema `imsqtiv3p0_imscpv1p2_v1p0.xsd` enumerates `3.0.0` only, as every 1EdTech
 * package does, so assesskit refuses the manifest as written. This is the one change that the example makes to the package.
 */
export function withSchemaVersion(manifest: string): string {
  return manifest.replace("<schemaversion>3.0.1</schemaversion>", "<schemaversion>3.0.0</schemaversion>");
}

/** The result of migrating one sample. */
export type Migration =
  | {
      /** The migrator produced a QTI 3 package. */
      readonly ok: true;
      /** The path of the item document in the package. */
      readonly itemHref: string;
      /** The files of the package, with its `imsmanifest.xml`, by path. */
      readonly files: ReadonlyMap<string, Uint8Array>;
      /** What the migrator reports, warnings included. */
      readonly diagnostics: readonly QtiMigrationDiagnostic[];
    }
  | {
      /** The migrator refused: it reports why, and gives no package. */
      readonly ok: false;
      readonly diagnostics: readonly QtiMigrationDiagnostic[];
    };

/**
 * Migrates one QTI 2.2 item and its files to a QTI 3 package with Longsight qti3-migrator.
 *
 * @param sample - The item and the files of its resource.
 * @param options - The options of the migrator; by default it neither repairs nor stubs, and refuses what it cannot keep.
 * @returns The package, with the one change of {@link withSchemaVersion}, or the migrator's reasons for not producing one.
 */
export async function migrateSample(sample: Sample, options: QtiMigrationOptions = {}): Promise<Migration> {
  const migrated = await migrateQtiResourceToQti3({ sourcePath: sample.href, files: sample.files }, options);
  if (!migrated.ok) return { ok: false, diagnostics: migrated.diagnostics };
  const [itemHref] = migrated.itemHrefs;
  if (itemHref === undefined) return { ok: false, diagnostics: migrated.diagnostics };
  const files = new Map(
    migrated.entries.map(({ path, data }): [string, Uint8Array] => [
      path,
      typeof data !== "string" ? data : ENCODER.encode(path === MANIFEST_PATH ? withSchemaVersion(data) : data),
    ]),
  );
  return { ok: true, itemHref, files, diagnostics: migrated.diagnostics };
}
