const XML_WHITESPACE = /[ \t\n\r]+/;

/**
 * Splits a text at runs of XML whitespace (space, tab, line feed, carriage return) and returns the parts between them,
 * as the `collapse` whitespace rule of XML Schema reads a list.
 */
export function xmlTokens(text: string): string[] {
  return text.split(XML_WHITESPACE).filter((token) => token !== "");
}
