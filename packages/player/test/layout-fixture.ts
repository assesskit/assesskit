import { commands } from "vitest/browser";

/** Where an element is on the page, and how large. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Returns where an element is on the page.
 *
 * @param element - The element.
 * @returns Its position and size, which compare with `toEqual` (a `DOMRect` holds its numbers in getters, which `toEqual` does not read).
 */
export function boxOf(element: Element): Box {
  const { x, y, width, height } = element.getBoundingClientRect();
  return { x, y, width, height };
}

/**
 * Presses a button of the test page with the pointer, runs a change of the page while the press lasts, and lets go.
 *
 * @remarks
 * The browser sends a click when the pointer is released over the element that it was pressed on, so a button that the change
 * moved away gets none.
 *
 * @param button - A button in the document of the test page, not in a shadow root.
 * @param change - What happens to the page between the press and the release.
 * @returns How many clicks the button got.
 */
export async function clicksDuring(button: HTMLElement, change: () => Promise<void>): Promise<number> {
  let clicks = 0;
  const count = (): void => {
    clicks += 1;
  };
  button.addEventListener("click", count);
  button.id ||= `press-${crypto.randomUUID()}`;
  await commands.pressPointer(`#${button.id}`);
  try {
    await change();
  } finally {
    await commands.releasePointer();
    button.removeEventListener("click", count);
  }
  return clicks;
}
