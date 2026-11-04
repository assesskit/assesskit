import { DataError } from "@assesskit/runtime/errors";

/** The shadow roots that the player attached: a shadow root cannot be removed, so a mount may use one again after `destroy` emptied it. */
const ATTACHED = new WeakSet<ShadowRoot>();

/** What the host must be, for every mount of the player. */
export const HOST_SHADOW_RULE =
  "The host must be an element that can have a shadow root and has none, or has one that an earlier mount of the player left empty.";

/**
 * Tells whether a mount can use a host: it has no shadow root, or one that the player attached and `destroy` emptied.
 *
 * @param host - The host element.
 * @returns Whether the host can take a mount.
 */
export function canMount(host: HTMLElement): boolean {
  const { shadowRoot } = host;
  return shadowRoot === null || (ATTACHED.has(shadowRoot) && shadowRoot.childNodes.length === 0);
}

/**
 * Gives a mount the shadow root of its host: a new one, or the one an earlier mount attached and left empty, with no
 * stylesheet adopted.
 *
 * @param host - The host element.
 * @returns The shadow root.
 * @throws `DataError` when the host cannot have a shadow root, or has one that is not the player's or that a mount still draws in.
 */
export function shadowRootOf(host: HTMLElement): ShadowRoot {
  if (!canMount(host)) throw new DataError(HOST_SHADOW_RULE);
  if (host.shadowRoot !== null) {
    host.shadowRoot.adoptedStyleSheets = [];
    return host.shadowRoot;
  }
  let shadow: ShadowRoot;
  try {
    shadow = host.attachShadow({ mode: "open" });
  } catch (error) {
    throw new DataError(HOST_SHADOW_RULE, { cause: error });
  }
  ATTACHED.add(shadow);
  return shadow;
}
