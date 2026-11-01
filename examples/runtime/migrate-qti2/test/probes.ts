import type { Sample } from "../src/samples.ts";

/** The namespace of APIP 1.0 for QTI 2.x. */
const APIP_NAMESPACE = "http://www.imsglobal.org/xsd/apip/apipv1p0/imsapip_qtiv1p0";
/** The namespace of the portable custom interaction of QTI 2.x. */
const PCI_NAMESPACE = "http://www.imsglobal.org/xsd/portableCustomInteraction_v1";

const ENCODER = new TextEncoder();

/** Replaces text that an item must contain, so that a probe fails to build when the item of the examples changes. */
function replaced(source: string, search: string | RegExp, replacement: string): string {
  const result = source.replace(search, replacement);
  if (result === source) throw new Error(`The item has no ${String(search)} to replace.`);
  return result;
}

/** The sample `choice` with the text of its item replaced. */
function variant(choice: Sample, identifier: string, edit: (source: string) => string): Sample {
  const source = new TextDecoder().decode(choice.files[choice.href]);
  return { ...choice, identifier, files: { ...choice.files, [choice.href]: ENCODER.encode(edit(source)) } };
}

/**
 * The item `choice` of the 1EdTech examples with an APIP accessibility block: the order of reading and a spoken form of the
 * introduction. The examples hold no APIP, so the probe adds the block of the shape that APIP 1.0 defines to a real item.
 */
export function withApip(choice: Sample): Sample {
  return variant(choice, "choice-apip", (source) => {
    const declared = replaced(source, "<assessmentItem ", `<assessmentItem xmlns:apip="${APIP_NAMESPACE}" `);
    const linked = replaced(declared, "<p>Look at the text", '<p id="intro">Look at the text');
    return replaced(
      linked,
      "</assessmentItem>",
      `<apip:apipAccessibility>
        <apip:inclusionOrder><apip:textOnlyDefaultOrder>
          <apip:elementOrder order="1"><apip:contentLinkInfo qtiLinkIdentifierRef="intro"/></apip:elementOrder>
        </apip:textOnlyDefaultOrder></apip:inclusionOrder>
        <apip:accessibilityInfo><apip:accessElement identifier="intro-access">
          <apip:contentLinkInfo qtiLinkIdentifierRef="intro"><apip:objectLink/></apip:contentLinkInfo>
          <apip:relatedElementInfo><apip:readAloud>
            <apip:textToSpeechPronunciation>Look at the text in the picture.</apip:textToSpeechPronunciation>
          </apip:readAloud></apip:relatedElementInfo>
        </apip:accessElement></apip:accessibilityInfo>
      </apip:apipAccessibility></assessmentItem>`,
    );
  });
}

/**
 * The item `choice` of the 1EdTech examples with its interaction replaced by a portable custom interaction of QTI 2.x. The
 * examples hold none, so the probe puts the element of the PCI specification where the choice interaction was.
 */
export function withPci(choice: Sample): Sample {
  return variant(choice, "choice-pci", (source) => {
    const interaction = replaced(
      source,
      /<choiceInteraction[\s\S]*<\/choiceInteraction>/,
      `<customInteraction responseIdentifier="RESPONSE" xmlns:pci="${PCI_NAMESPACE}">
        <pci:portableCustomInteraction customInteractionTypeIdentifier="urn:example:pci:luggage" hook="app/hook">
          <pci:resources><pci:libraries><pci:lib id="app/hook"/></pci:libraries></pci:resources>
          <pci:markup><div class="luggage"/></pci:markup>
        </pci:portableCustomInteraction>
      </customInteraction>`,
    );
    return replaced(interaction, 'baseType="identifier"', 'baseType="string"');
  });
}
