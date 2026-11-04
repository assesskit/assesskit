import { FACTS, FAMILY, PACKAGES, SITE } from "../family.ts";
import { folderOf, linesFor, packageUrl } from "../identity.ts";

/** A Mermaid diagram, which every README holds. */
const DIAGRAM = "```mermaid\nflowchart LR\n  A --> B\n```\n";

/** A text with the lines of the marks and bodies that it names appended. */
function withLines(text: string): string {
  const lines = linesFor(text);
  return lines.length === 0 ? text : `${text}\n${lines.join("\n")}\n`;
}

/**
 * The files of a repository whose manifests, READMEs and NOTICE files say what `family.ts` says, as `check:standards` reads
 * them: the root README with the family's sentence and the table of packages, and for each package its manifest, a README
 * that opens with its description and a NOTICE, and the citation and the Context7 file with the family's sentence.
 */
export function familyFiles(): Record<string, string> {
  const table = PACKAGES.map(({ name, description }) => `| [\`${name}\`](${packageUrl(name)}) | ${description} |`);
  const files: Record<string, string> = {
    "README.md": withLines(
      `# ${FAMILY.name}\n\n${FAMILY.sentence}\n\n${DIAGRAM}\n## Which package\n\n| Package | What it is |\n| --- | --- |\n${table.join("\n")}\n\n## Documentation\n## Development\n## Layout\n## License\n`,
    ),
  };
  files["CITATION.cff"] =
    `cff-version: 1.2.0\ntitle: ${FAMILY.name}\nabstract: >-\n  ${FAMILY.sentence}\nurl: ${SITE}\n`;
  files["context7.json"] = JSON.stringify({ projectTitle: FAMILY.name, description: FAMILY.sentence, rules: FACTS });
  for (const { name, description, keywords } of PACKAGES) {
    const folder = folderOf(name);
    files[`packages/${folder}/package.json`] = `${JSON.stringify(
      { name, description, keywords, author: FAMILY.author, homepage: packageUrl(name) },
      null,
      2,
    )}\n`;
    files[`packages/${folder}/README.md`] = withLines(
      `# ${name}\n\n${description}\n\n## Quick start\n## Architecture\n\n${DIAGRAM}\n## API\n## Supported\n## Documentation\n## License\n`,
    );
    for (const page of ["supported", "evidence", "choosing"])
      files[`docs/${folder}/${page}.md`] = `# ${page}\n\n${DIAGRAM}`;
    files[`packages/${folder}/NOTICE`] = withLines(`${name}\nCopyright ${FAMILY.author}\n\n${description}\n`);
  }
  return files;
}
