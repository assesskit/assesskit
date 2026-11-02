import { cpSync, globSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/** The folder of the site that TypeDoc writes. */
const SITE = "docs/api";

/** Where the site holds Mermaid. */
const TARGET = join(SITE, "assets/mermaid");

/** The address that the TypeDoc plugin writes into each page that has a diagram, whatever version it names. */
const CDN_ADDRESS = /https:\/\/unpkg\.com\/mermaid@[^/"]+\/dist\/mermaid\.esm\.min\.mjs/gu;

/** The entry of the ESM build, which loads its chunks from the folder beside it. */
const ENTRY = "mermaid.esm.min.mjs";
const CHUNKS = "chunks/mermaid.esm.min";

/** Copies the ESM build of the pinned Mermaid into the site, without its source maps. */
function copyMermaid(): void {
  const source = dirname(fileURLToPath(import.meta.resolve("mermaid")));
  rmSync(TARGET, { recursive: true, force: true });
  mkdirSync(join(TARGET, CHUNKS), { recursive: true });
  cpSync(join(source, ENTRY), join(TARGET, ENTRY));
  for (const chunk of globSync("*.mjs", { cwd: join(source, CHUNKS) })) {
    cpSync(join(source, CHUNKS, chunk), join(TARGET, CHUNKS, chunk));
  }
}

/** Links each page at the copy in the site, by a path from the page, so that the site works under any path. */
function linkPages(): number {
  let pages = 0;
  for (const page of globSync("**/*.html", { cwd: SITE })) {
    const path = join(SITE, page);
    const text = readFileSync(path, "utf8");
    const local = relative(dirname(path), join(TARGET, ENTRY));
    const linked = text.replace(CDN_ADDRESS, local.startsWith(".") ? local : `./${local}`);
    if (linked !== text) {
      writeFileSync(path, linked);
      pages += 1;
    }
    if (linked.includes("unpkg.com")) throw new Error(`The page ${path} still loads a script from unpkg.com.`);
  }
  return pages;
}

copyMermaid();
const pages = linkPages();
if (pages === 0) throw new Error(`No page of ${SITE} loads Mermaid, so the plugin changed what it writes.`);
process.stdout.write(`Mermaid is served from the site for ${pages} pages.\n`);
