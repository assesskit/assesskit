import { Application } from "typedoc";
import { familyLines } from "../scripts/identity.ts";

/**
 * The plugin of TypeDoc that makes the docs site say what `scripts/family.ts` says: the footer of every page carries the lines
 * of the marks of others and the line that the family is not affiliated with their holders. Every family copies this file
 * unchanged.
 */

const escapeHtml = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/** Loads the plugin into TypeDoc, which calls it once its options are read. */
export function load(app: Application): void {
  app.on(Application.EVENT_BOOTSTRAP_END, () => {
    app.options.setValue(
      "customFooterHtml",
      familyLines()
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join("\n"),
    );
    app.options.setValue("customFooterHtmlDisableWrapper", true);
  });
}
