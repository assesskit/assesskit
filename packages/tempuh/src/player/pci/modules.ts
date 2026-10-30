import type { PortableCustomInteraction } from "@luthfanwakan/olah/asi";
import {
  DEFAULT_WAIT_SECONDS,
  isPackageRelative,
  moduleConfigurationPaths,
  type PciModuleConfiguration,
  resolvePciModules,
} from "@luthfanwakan/olah/pci";
import { DataError } from "../../errors.js";
import type { PciModules } from "./protocol.js";

/** The extension that RequireJS adds to the path of a module. */
const EXTENSION = /\.js$/u;

/**
 * Returns the location as RequireJS takes it. BPIG §3.7.12.2 gives locations without the `.js` extension, which
 * RequireJS adds; the examples of 1EdTech give some with it (`primary-path="modules/lib/eve.js"`), which RequireJS
 * would turn into `eve.js.js`. Both name the same file.
 */
const withoutExtension = (location: string): string => location.replace(EXTENSION, "");

/** Returns the names of the modules to require: the `module` attribute, or else the `qti-interaction-module`s (BPIG §3.7.12.4). */
function namesToLoad(interaction: PortableCustomInteraction): readonly string[] {
  if (interaction.module !== undefined) return [interaction.module];
  return (interaction.interactionModules?.interactionModules ?? []).map(({ id }) => id);
}

/**
 * Locates the modules of an interaction for the frame. A path in the package becomes a URL under the asset prefix of the
 * package, and a location with a protocol stays as it is, for the frame's policy to allow or refuse. RequireJS resolves
 * a dependency such as `./renderer` against `baseUrl`, so `baseUrl` is the directory of the first module to load, under
 * its prefix; the dependency then loads from the directory of the module, under the same prefix, and so do the
 * `url()`s of the stylesheets it adds.
 *
 * @param interaction - The `qti-portable-custom-interaction`.
 * @param configuration - The module resolution files that `moduleConfigurationPaths` names, parsed; a file that the
 * package lacks is left out. The `waitSeconds` of the primary file is the timeout (BPIG §3.7.12.2).
 * @param assets - Gives the URL of a path in the package. A location that ends in `.js` is the same as one without it.
 * @throws `DataError` when `interaction` or `configuration` has the wrong type, the interaction names no module to
 * load, or a module to load has no location.
 */
export function pciModules(
  interaction: PortableCustomInteraction,
  configuration: PciModuleConfiguration,
  assets: (path: string) => string,
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
              locations.map((location) => withoutExtension(isPackageRelative(location) ? assets(location) : location)),
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
    baseUrl: new URL(".", assets(home ?? moduleConfigurationPaths(interaction).primary)).href,
    paths,
    waitSeconds: configuration.primary?.waitSeconds ?? DEFAULT_WAIT_SECONDS,
    load,
  };
}
