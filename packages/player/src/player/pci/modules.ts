import type { PortableCustomInteraction } from "@assesskit/runtime/asi";
import { DataError } from "@assesskit/runtime/errors";
import {
  DEFAULT_WAIT_SECONDS,
  isPackageRelative,
  type PciModuleConfiguration,
  resolveModuleConfigurationPaths,
  resolvePciModules,
} from "@assesskit/runtime/pci";
import type { PciModules } from "./protocol.js";

/** The extension that RequireJS adds to the path of a module. */
const EXTENSION = /\.js$/u;

/**
 * Returns the location as RequireJS takes it.
 *
 * @remarks
 * The best practices guide gives locations without the `.js` extension, which RequireJS adds; the examples of 1EdTech give
 * some with it (`primary-path="modules/lib/eve.js"`), which RequireJS would turn into `eve.js.js`. Both name the same file.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, module resolution}
 */
const withoutExtension = (location: string): string => location.replace(EXTENSION, "");

/**
 * Returns the URL of a package path as the frame needs it: absolute.
 *
 * @remarks
 * The frame has an origin of its own and RequireJS resolves in it, so a relative URL such as `/package/q1/main.js` would
 * name a file of the frame's origin. The page resolves it against its own base URL (`document.baseURI`) before the frame
 * hears of it, which is what the page's other URLs do. An absolute URL needs no page. `URL.canParse` is outside the
 * browser baseline, so the parse is tried.
 *
 * @throws `DataError` when the URL is relative and there is no page to resolve it against.
 */
function absolute(url: string): string {
  const base = typeof document === "undefined" ? undefined : document.baseURI;
  try {
    return new URL(url, base).href;
  } catch (error) {
    throw new DataError(
      `The option assets gave the URL ${JSON.stringify(url)}, which is relative, and there is no page whose address could resolve it.`,
      { cause: error },
    );
  }
}

/**
 * Returns the URL of a location in the package, absolute, and refuses one that the frame cannot load from.
 *
 * @throws `DataError` when the origin of the URL is not among `origins`.
 */
function located(url: string, origins: readonly string[] | undefined): string {
  const resolved = absolute(url);
  const { origin } = new URL(resolved);
  if (origins === undefined || origins.includes(origin)) return resolved;
  throw new DataError(
    `The URL ${JSON.stringify(resolved)} of a file of the package is on the origin ${origin}, which the frame does not load scripts from (${origins.join(", ")}). Serve the files of the package from the origin of staticUrl, or add its origin to origins.`,
  );
}

/**
 * Returns the names of the modules to require: the `module` attribute, or else the `qti-interaction-module`s.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, module resolution}
 */
function namesToLoad(interaction: PortableCustomInteraction): readonly string[] {
  if (interaction.module !== undefined) return [interaction.module];
  return (interaction.interactionModules?.interactionModules ?? []).map(({ id }) => id);
}

/**
 * Locates the modules of an interaction for the frame.
 *
 * @remarks
 * A path in the package becomes an absolute URL under the asset prefix of the package, a relative one resolved against the
 * base URL of the page, and a location with a protocol stays as it is, for the frame's policy to allow or refuse. RequireJS resolves a dependency such as `./renderer` against `baseUrl`, so
 * `baseUrl` is the directory of the first module to load, under its prefix; the dependency then loads from the directory
 * of the module, under the same prefix, and so do the `url()`s of the stylesheets it adds.
 *
 * @param interaction - The `qti-portable-custom-interaction`.
 * @param configuration - The module resolution files that `resolveModuleConfigurationPaths` names, parsed; a file that the
 * package lacks is left out. The `waitSeconds` of the primary file is the timeout.
 * @param assets - Gives the URL of a path in the package, absolute or relative to the page. A location that ends in `.js`
 * is the same as one without it.
 * @param origins - The origins that the frame loads scripts from, or `undefined` to accept any. A location in the package
 * outside them is refused, because the frame's policy would block it after the host waited for it.
 * @returns The modules.
 * @throws `DataError` when `interaction` or `configuration` has the wrong type, the interaction names no module to load, a
 * module to load has no location, or a location in the package is outside `origins`.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, module resolution}
 */
export function pciModules(
  interaction: PortableCustomInteraction,
  configuration: PciModuleConfiguration,
  assets: (path: string) => string,
  origins?: readonly string[],
): PciModules {
  const resolved = resolvePciModules(interaction, configuration);
  const load = namesToLoad(interaction);
  if (load.length === 0) {
    throw new DataError(
      "The interaction names no module to load: it needs a module attribute or a qti-interaction-modules.",
    );
  }
  const paths = new Map(
    resolved.flatMap(({ id, primary, fallback }) => {
      const locations = [primary, fallback].filter((location) => location !== undefined);
      return locations.length === 0
        ? []
        : [
            [
              id,
              locations.map((location) =>
                withoutExtension(isPackageRelative(location) ? located(assets(location), origins) : location),
              ),
            ] as const,
          ];
    }),
  );
  const missing = load.find((name) => !paths.has(name));
  if (missing !== undefined) {
    throw new DataError(
      `The module ${JSON.stringify(missing)} has no location: a module resolution file or a qti-interaction-module must give its path.`,
    );
  }
  const first = resolved.find(({ id }) => id === load[0]);
  const home = [first?.primary, first?.fallback].find(
    (location) => location !== undefined && isPackageRelative(location),
  );
  return {
    baseUrl: new URL(".", absolute(assets(home ?? resolveModuleConfigurationPaths(interaction).primary))).href,
    paths,
    waitSeconds: configuration.primary?.waitSeconds ?? DEFAULT_WAIT_SECONDS,
    load,
  };
}
