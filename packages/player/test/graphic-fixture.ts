import type { Value } from "@assesskit/runtime/values";
import type { InteractionFiles } from "../src/player/index.js";
import { mountScene, type Scene } from "./interactions-fixture.js";

/** A picture of one color as a `data:` URL, which the renderer loads as it would a file of the package. */
export function picture(width: number, height: number, color = "#cccccc"): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("The engine has no 2D canvas.");
  context.fillStyle = color;
  context.fillRect(0, 0, width, height);
  return canvas.toDataURL("image/png");
}

/**
 * A white picture with a black rectangle drawn on it from (20, 20) to (120, 80), as a `data:` URL: a drawing to colour in,
 * whose line is the edge that a fill must stop at.
 */
export function outlined(width: number, height: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("The engine has no 2D canvas.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "#000000";
  context.lineWidth = 4;
  context.strokeRect(20, 20, 100, 60);
  return canvas.toDataURL("image/png");
}

/** Returns the color of a pixel of a stored picture, which the test decodes as a person would see it. */
export async function colorAt(bytes: Blob, x: number, y: number): Promise<readonly [number, number, number, number]> {
  const bitmap = await createImageBitmap(bytes);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("The engine has no 2D canvas.");
  context.drawImage(bitmap, 0, 0);
  const [red = 0, green = 0, blue = 0, alpha = 0] = context.getImageData(x, y, 1, 1).data;
  return [red, green, blue, alpha];
}

/** An upload that the drawing made. */
export interface Upload {
  /** The bytes of the picture. */
  readonly bytes: Blob;
  /** Their media type. */
  readonly mimeType: string;
}

/**
 * The host's storage of drawings for the tests: it keeps what is uploaded, and gives a file value its reference as the URL.
 *
 * @param upload - Stores a picture in place of keeping it, such as one that fails.
 */
export function memoryFiles(upload?: InteractionFiles["upload"]): {
  readonly files: InteractionFiles;
  readonly uploads: Upload[];
} {
  const uploads: Upload[] = [];
  const files: InteractionFiles = {
    upload:
      upload ??
      (async (bytes, mimeType, fileName) => {
        uploads.push({ bytes, mimeType });
        return { reference: `file-${uploads.length}`, mimeType, ...(fileName === undefined ? {} : { fileName }) };
      }),
    url: ({ reference }) => reference,
  };
  return { files, uploads };
}

/** A scene of graphic interactions with the pictures that a drawing stored. */
export interface Graphic extends Scene {
  /** The pictures that were stored, in order. */
  readonly uploads: readonly Upload[];
  /** The responses that the interactions gave, in order. */
  readonly values: readonly (Value | null)[];
}

/** Waits for the layout that the observers of a stage make after the first frame. */
export const settle = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

/**
 * Shows an item with graphic interactions in a content root, with the descriptors that the runtime makes of it, once its pictures
 * have loaded and the stages have their size.
 *
 * @param body - The markup between `qti-item-body` and its end tag.
 * @param declarations - Markup between the opening tag of the item and its body: the response declarations.
 * @param upload - Stores the pictures of a drawing. Default: keeps them in `uploads`.
 */
export async function show(body: string, declarations: string, upload?: InteractionFiles["upload"]): Promise<Graphic> {
  const { files, uploads } = memoryFiles(upload);
  const scene = mountScene(declarations, body, { options: { files } });
  await Promise.all(scene.findAll<HTMLImageElement>("img").map((image) => image.decode()));
  await settle();
  return {
    ...scene,
    uploads,
    get values() {
      return scene.responses.map(({ value }) => value);
    },
  };
}
