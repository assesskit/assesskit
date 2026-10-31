import type { PortableCustomInteraction } from "../asi/index.js";
import { checkRecord } from "../checks.js";

const DATA_PREFIX = "data-";

/** Returns the name `element.dataset` gives a `data-` attribute: the prefix is removed and `-a` becomes `A`. */
function datasetName(attribute: string): string {
  return attribute.slice(DATA_PREFIX.length).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/**
 * Returns the properties that the delivery engine passes to a PCI module.
 *
 * @remarks
 * The properties are the custom `data-*` attributes of the interaction, named as HTML5 names them for
 * `element.dataset`, so that `data-max-choices-message="Too many"` becomes `maxChoicesMessage`. The attributes that QTI
 * itself defines, `data-catalog-idref` and `data-qti-suppress-tts`, are not custom and are left out.
 *
 * @param interaction - The PCI.
 * @returns The value of each property by its name.
 * @throws `DataError` when `interaction` is not an object of the model of `qti-portable-custom-interaction`.
 * @see
 * {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, portable custom interaction properties}
 * @see {@link https://html.spec.whatwg.org/multipage/dom.html#dom-dataset | HTML Standard, dataset}
 */
export function pciProperties(interaction: PortableCustomInteraction): ReadonlyMap<string, string> {
  checkRecord(interaction, "The interaction must be an object of the model of qti-portable-custom-interaction");
  return new Map(
    interaction.extensions
      .filter(
        ({ namespace, name }) => namespace === "" && name.startsWith(DATA_PREFIX) && name.length > DATA_PREFIX.length,
      )
      .map(({ name, value }) => [datasetName(name), value]),
  );
}
