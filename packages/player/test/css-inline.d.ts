/** A stylesheet that Vite imports as text. */
declare module "*.css?inline" {
  const css: string;
  // biome-ignore lint/style/noDefaultExport: Vite imports a stylesheet as text through the default export.
  export default css;
}
