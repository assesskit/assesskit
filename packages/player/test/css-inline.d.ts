/** A stylesheet that Vite imports as text. */
declare module "*.css?inline" {
  const css: string;
  // biome-ignore lint/style/noDefaultExport: Vite imports a stylesheet as text through the default export.
  export default css;
}

/** A guide that Vite imports as text. */
declare module "*.md?raw" {
  const markdown: string;
  // biome-ignore lint/style/noDefaultExport: Vite imports a file as text through the default export.
  export default markdown;
}
