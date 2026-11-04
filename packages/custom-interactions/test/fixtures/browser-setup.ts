import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import type { TestProject } from "vitest/node";
import { buildFrame } from "../../../player/scripts/build-static.ts";
import { buildModules } from "../../scripts/build-modules.ts";
import { writeCharacterModule } from "../../src/write-character-module.ts";
import "./origin.ts";

const PLAYER = resolve(import.meta.dirname, "../../../player");
/** The reference strokes of 十, U+5341, from hanzi-writer-data, whose module the setup writes. */
const CHARACTER = resolve(import.meta.dirname, "hanzi-writer-data/5341.json");

const MEDIA_TYPES: ReadonlyMap<string, string> = new Map([
  [".html", "text/html"],
  [".js", "text/javascript"],
  [".css", "text/css"],
  [".woff2", "font/woff2"],
]);

/** What the server answers: a status, and the bytes of a file. */
interface Served {
  readonly status: number;
  readonly body?: Buffer;
}

/** Serves a file below a directory, or 404 for a path that leaves it or that it lacks. */
async function serve(directory: string, path: string): Promise<Served> {
  const file = resolve(directory, `.${path}`);
  if (!file.startsWith(`${directory}${sep}`)) return { status: 404 };
  try {
    return { status: 200, body: await readFile(file) };
  } catch {
    return { status: 404 };
  }
}

/**
 * Starts the asset origin of the browser tests on a free port, and stops it when the tests end. It serves the player's frame
 * and stylesheet under `/static/`, and a package under `/g/<token>/`: the modules that `pnpm build` writes, built for the run,
 * under `modules/`. It records the paths it is asked for, which
 * `/__hits` shows, so that a test sees what a module loaded. The module of the character 十 is at `modules/characters/5341.js`.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const built = await mkdtemp(join(tmpdir(), "custom-interactions-"));
  await buildFrame(join(built, "pci-frame"));
  await buildModules(join(built, "modules"));
  await mkdir(join(built, "modules/characters"));
  const strokes = JSON.parse(await readFile(CHARACTER, "utf8"));
  await writeFile(join(built, "modules/characters/5341.js"), writeCharacterModule("十", strokes));
  const hits: string[] = [];
  const server: Server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    response.setHeader("access-control-allow-origin", "*");
    if (path === "/__hits") {
      response.setHeader("content-type", "application/json");
      response.setHeader("cache-control", "no-store");
      response.end(JSON.stringify(hits));
      return;
    }
    hits.push(path);
    const [, area, , ...rest] = path.split("/");
    const inPackage = `/${rest.join("/")}`;
    const found =
      area === "static"
        ? path === "/static/player.css"
          ? serve(PLAYER, "/player.css")
          : serve(built, path.slice("/static".length))
        : area === "g"
          ? serve(built, inPackage)
          : Promise.resolve<Served>({ status: 404 });
    void found.then(({ status, body }) => {
      response.statusCode = status;
      response.setHeader("content-type", MEDIA_TYPES.get(extname(path)) ?? "application/octet-stream");
      response.end(body);
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("The server has no port.");
  project.provide("assetOrigin", `http://127.0.0.1:${address.port}`);
  return async () => {
    await new Promise<void>((done) => {
      server.close(() => done());
      server.closeAllConnections();
    });
    await rm(built, { recursive: true, force: true });
  };
}
