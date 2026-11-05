import { readdirSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const PACKAGES = resolve(ROOT, "packages");
const SCOPE = "@assesskit/";

interface Manifest {
  readonly name: string;
  readonly exports: Readonly<Record<string, unknown>>;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
}

/** The packages of the repository, by folder, each with the packages of the family that a user installs with it. */
const MANIFESTS: ReadonlyMap<string, Manifest> = new Map(
  readdirSync(PACKAGES).map((folder) => [
    folder,
    JSON.parse(readFileSync(resolve(PACKAGES, folder, "package.json"), "utf8")) as Manifest,
  ]),
);

/**
 * The source file of every entry that has types, by its specifier, from the `exports` of each manifest: `./dist/<path>.js`
 * is built from `src/<path>.ts`.
 */
function entrySources(folder: string): ReadonlyMap<string, string> {
  const manifest = MANIFESTS.get(folder);
  const entries = Object.entries(manifest?.exports ?? {}).flatMap(([subpath, target]) =>
    typeof target === "object" && target !== null && "default" in target && typeof target.default === "string"
      ? [[`${manifest?.name}${subpath.slice(1)}`, target.default] as const]
      : [],
  );
  return new Map(
    entries.map(([specifier, target]) => [
      specifier,
      resolve(PACKAGES, folder, target.replace(/^\.\/dist\//, "src/").replace(/\.js$/, ".ts")),
    ]),
  );
}

/** The folders of the packages that are installed with a package: its dependencies and peer dependencies of the family. */
function familyDependencies(folder: string): string[] {
  const manifest = MANIFESTS.get(folder);
  const names = Object.keys({ ...manifest?.dependencies, ...manifest?.peerDependencies });
  return names.filter((name) => name.startsWith(SCOPE)).map((name) => name.slice(SCOPE.length));
}

const SOURCES = new Map([...MANIFESTS.keys()].flatMap((folder) => [...entrySources(folder)]));
const OPTIONS: ts.CompilerOptions = {
  ...ts.convertCompilerOptionsFromJson(
    JSON.parse(readFileSync(resolve(ROOT, "tsconfig.base.json"), "utf8")).compilerOptions,
    ROOT,
  ).options,
  declarationMap: false,
  sourceMap: false,
  emitDeclarationOnly: true,
  allowImportingTsExtensions: true,
  paths: Object.fromEntries([...SOURCES].map(([specifier, source]) => [specifier, [source]])),
};

/** Whether a source file is a source of a package, and not a declaration file. */
const isSource = (file: string) => resolve(file).startsWith(PACKAGES) && !file.endsWith(".d.ts");

/**
 * Emits the declarations of every entry of the packages that name a package of the family, as a build writes them, into a map by
 * the path of each `.d.ts`, and returns a checker over them: a host that serves those files and hides the sources of those
 * packages. The sources of the packages that they name are served as they are.
 */
function declarations(): { readonly checker: ts.TypeChecker; readonly program: ts.Program } {
  const folders = [...MANIFESTS.keys()].filter((folder) => familyDependencies(folder).length > 0);
  const roots = folders.flatMap((folder) => [...entrySources(folder).values()]);
  const emitted = new Map<string, string>();
  const program = ts.createProgram(roots, OPTIONS);
  for (const file of program.getSourceFiles()) {
    const inFolder = folders.some((folder) => resolve(file.fileName).startsWith(resolve(PACKAGES, folder) + sep));
    if (!inFolder) continue;
    const { diagnostics } = program.emit(file, (name, text) => emitted.set(resolve(name), text), undefined, true);
    if (diagnostics.length > 0) throw new Error(ts.formatDiagnostics(diagnostics, ts.createCompilerHost(OPTIONS)));
  }
  const host = ts.createCompilerHost(OPTIONS);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const hidden = (file: string) => folders.some((folder) => resolve(file).startsWith(resolve(PACKAGES, folder) + sep));
  host.fileExists = (file) => emitted.has(resolve(file)) || (!(isSource(file) && hidden(file)) && fileExists(file));
  host.readFile = (file) => emitted.get(resolve(file)) ?? (isSource(file) && hidden(file) ? undefined : readFile(file));
  host.getSourceFile = (file, language) => {
    const text = host.readFile(file);
    return text === undefined ? undefined : ts.createSourceFile(file, text, language);
  };
  const declared = ts.createProgram(
    roots.map((source) => source.replace(/\.ts$/, ".d.ts")),
    {
      ...OPTIONS,
      noEmit: true,
      paths: Object.fromEntries(
        [...SOURCES].map(([specifier, source]) => [
          specifier,
          [
            folders.some((folder) => source.startsWith(resolve(PACKAGES, folder) + sep))
              ? source.replace(/\.ts$/, ".d.ts")
              : source,
          ],
        ]),
      ),
    },
    host,
  );
  return { checker: declared.getTypeChecker(), program: declared };
}

/**
 * The names of the packages that a package depends on that the declarations of its API name, following every type of the
 * package that a public declaration names, and the names of those packages that its root exports.
 */
function dependencyNames(folder: string): { readonly named: ReadonlySet<string>; readonly root: ReadonlySet<string> } {
  const { checker, program } = DECLARATIONS;
  const own = resolve(PACKAGES, folder) + sep;
  const dependencies = familyDependencies(folder).map((name) => resolve(PACKAGES, name) + sep);
  const rootFile = resolve(own, "src/index.d.ts");
  const named = new Set<string>();
  const root = new Set<string>();
  const seen = new Set<ts.Symbol>();
  const queue: ts.Symbol[] = [];
  const resolved = (symbol: ts.Symbol) =>
    symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const isIn = (symbol: ts.Symbol, paths: readonly string[]) =>
    symbol.declarations?.some((declaration) =>
      paths.some((path) => resolve(declaration.getSourceFile().fileName).startsWith(path)),
    ) ?? false;
  const follow = (symbol: ts.Symbol | undefined) => {
    if (symbol === undefined) return;
    const target = resolved(symbol);
    if (isIn(target, dependencies)) named.add(target.name);
    else if (isIn(target, [own]) && !seen.has(target)) {
      seen.add(target);
      queue.push(target);
    }
  };
  const rightmost = (name: ts.EntityName | ts.Expression): ts.Node =>
    ts.isQualifiedName(name) ? name.right : ts.isPropertyAccessExpression(name) ? name.name : name;
  const visit = (node: ts.Node): void => {
    if (ts.isTypeReferenceNode(node)) follow(checker.getSymbolAtLocation(rightmost(node.typeName)));
    else if (ts.isExpressionWithTypeArguments(node)) follow(checker.getSymbolAtLocation(rightmost(node.expression)));
    else if (ts.isTypeQueryNode(node)) follow(checker.getSymbolAtLocation(rightmost(node.exprName)));
    else if (ts.isImportTypeNode(node) && node.qualifier !== undefined) {
      follow(checker.getSymbolAtLocation(rightmost(node.qualifier)));
    }
    ts.forEachChild(node, visit);
  };
  for (const file of program.getRootFileNames()) {
    if (!resolve(file).startsWith(own)) continue;
    const source = program.getSourceFile(file);
    const module = source === undefined ? undefined : checker.getSymbolAtLocation(source);
    for (const exported of module === undefined ? [] : checker.getExportsOfModule(module)) {
      const target = resolved(exported);
      if (resolve(file) === rootFile && isIn(target, dependencies)) root.add(target.name);
      else follow(exported);
    }
  }
  for (let symbol = queue.pop(); symbol !== undefined; symbol = queue.pop()) {
    for (const declaration of symbol.declarations ?? []) {
      if (resolve(declaration.getSourceFile().fileName).startsWith(own)) visit(declaration);
    }
  }
  return { named, root };
}

const DECLARATIONS = declarations();
const DEPENDENT = [...MANIFESTS.keys()].filter((folder) => familyDependencies(folder).length > 0);

describe("the root of a package", () => {
  // A user installs one package, and pnpm does not let a program import a dependency of a dependency: every type of another
  // package of the family that the declarations name is exported by the root, and the root exports nothing else of them.
  it.each(DEPENDENT)(
    "of %s exports every type of the packages it depends on that its declarations name, and nothing else of them",
    (folder) => {
      const { named, root } = dependencyNames(folder);
      expect([...root].sort()).toEqual([...named].sort());
    },
  );
});
