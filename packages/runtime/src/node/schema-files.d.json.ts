import type { SchemaFile } from "./schema-files.js";

// The type of schema-files.json for the configurations that leave resolveJsonModule off, as all but tsconfig.build.json do, so
// that tsc refuses any other import of a JSON file, a test's included. The build turns resolveJsonModule on, reads the JSON
// itself and copies it to dist.
declare const schemaFiles: readonly SchemaFile[];
export = schemaFiles;
