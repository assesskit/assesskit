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

/** A script or a stylesheet of a package that Vite imports as text, for a page that runs it as the package ships it. */
declare module "*.js?raw" {
  const source: string;
  // biome-ignore lint/style/noDefaultExport: Vite imports a file as text through the default export.
  export default source;
}

declare module "*.css?raw" {
  const source: string;
  // biome-ignore lint/style/noDefaultExport: Vite imports a file as text through the default export.
  export default source;
}
