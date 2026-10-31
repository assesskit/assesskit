import { resolveUrl, type UrlPolicy } from "./urls.js";

/**
 * A descriptor of a candidate of `srcset`: a width in pixels or a density.
 *
 * @see {@link https://html.spec.whatwg.org/multipage/images.html#srcset-attribute | HTML Standard, the srcset attribute}
 */
const SRCSET_DESCRIPTOR = /^(?:\d+w|(?:\d+|\d*\.\d+)x)$/u;
/** The code of the highest character that HTML counts as white space in a list of candidates. */
const LAST_SPACE = 0x20;
/** A candidate of a `srcset`: a URL and its descriptor, which is empty for the default density. */
interface Candidate {
  readonly url: string;
  readonly descriptor: string;
}
const isSpace = (character: string | undefined): boolean =>
  character !== undefined && character.charCodeAt(0) <= LAST_SPACE;
/** Returns the end of the descriptors of a candidate: the next comma that is not inside parentheses. */
function descriptorEnd(value: string, from: number): number {
  let depth = 0;
  for (let index = from; index < value.length; index++) {
    const character = value.charAt(index);
    if (character === "(") depth++;
    else if (character === ")" && depth > 0) depth--;
    else if (character === "," && depth === 0) return index;
  }
  return value.length;
}
/**
 * Parses the candidates of a `srcset`: URLs may contain commas, descriptors may not.
 *
 * @see {@link https://html.spec.whatwg.org/multipage/images.html#parsing-a-srcset-attribute | HTML Standard, parsing a srcset attribute}
 */
function parseSrcset(value: string): Candidate[] {
  const candidates: Candidate[] = [];
  let index = 0;
  while (index < value.length) {
    while (isSpace(value[index]) || value[index] === ",") index++;
    const start = index;
    while (index < value.length && !isSpace(value[index])) index++;
    const url = value.slice(start, index);
    if (url.endsWith(",")) {
      candidates.push({ url: url.replace(/,+$/u, ""), descriptor: "" });
      continue;
    }
    const end = descriptorEnd(value, index);
    if (url !== "") candidates.push({ url, descriptor: value.slice(index, end).trim() });
    index = end;
  }
  return candidates;
}
/**
 * Resolves the candidates of a `srcset`.
 *
 * @remarks
 * A candidate whose URL the policy refuses, or whose descriptor is none of a width or a density, is left out.
 *
 * @param value - The `srcset` as the content writes it.
 * @param policy - The URL policy.
 * @returns The rewritten `srcset`, or `undefined` when no candidate remains.
 */
export function resolveSrcset(value: string, policy: UrlPolicy): string | undefined {
  const kept = parseSrcset(value).flatMap(({ url, descriptor }) => {
    const resolved = resolveUrl(url, policy, "load");
    return resolved === undefined || !(descriptor === "" || SRCSET_DESCRIPTOR.test(descriptor))
      ? []
      : [descriptor === "" ? resolved : `${resolved} ${descriptor}`];
  });
  return kept.length === 0 ? undefined : kept.join(", ");
}
