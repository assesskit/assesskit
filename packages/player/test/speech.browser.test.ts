import { AssesskitError, DataError } from "@assesskit/runtime/errors";
import type { RestrictionType } from "@assesskit/runtime/pnp";
import { afterEach, describe, expect, inject, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { EN_MESSAGES } from "../src/index.js";
import { ID_MESSAGES } from "../src/messages/id/index.js";
import {
  createWebSpeech,
  type Lexicon,
  readLexicon,
  type SpeechHook,
  type SpeechRequest,
  type SpeechSettings,
} from "../src/player/index.js";
import { applyReadingType, buildSpeechRequest, echoTyping, type SpeechOptions } from "../src/player/speech/internal.js";
import { mountContent, wholeRoot } from "./content-fixture.js";
import type { ContentRoot } from "./css-fixture.js";
import { axeViolations } from "./renderer-fixture.js";
import { waitFor } from "./wait.js";

const { asset } = inject("fixtures");

/** The SSML documents that the tests made, which the schema of SSML 1.1 validates when the test ends. */
const produced: string[] = [];

/** Asks the global setup for what the schema of SSML 1.1 finds wrong with a document. */
async function schemaIssues(ssml: string): Promise<readonly string[]> {
  const response = await fetch(`${asset}/validate/ssml`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: ssml,
  });
  if (!response.ok) throw new Error(`The SSML validator answered ${response.status}: ${await response.text()}`);
  return response.json();
}

afterEach(async () => {
  for (const ssml of produced.splice(0)) expect(await schemaIssues(ssml), ssml).toEqual([]);
});

const READ_ALOUD: SpeechSettings = { readingType: "computer-read-aloud", restrictionTypes: [] };

/** Reads all the content of a root as a candidate with the given settings would hear it. */
function read(
  content: ContentRoot,
  settings: SpeechSettings = {},
  options: Partial<SpeechOptions> = {},
): SpeechRequest | undefined {
  const request = buildSpeechRequest(wholeRoot(content), {
    settings: { ...READ_ALOUD, ...settings },
    messages: EN_MESSAGES,
    language: "en",
    ...options,
  });
  if (request !== undefined) produced.push(request.ssml);
  return request;
}

/** The text of a request, which fails the test when there is none. */
function textOf(request: SpeechRequest | undefined): string {
  if (request === undefined) throw new Error("There is no request.");
  return request.text;
}

/** The markup between the `speak` tags of the SSML of a request. */
function inner(request: SpeechRequest | undefined): string {
  if (request === undefined) throw new Error("There is no request.");
  return request.ssml.replace(/^[\s\S]*?<speak[^>]*>/u, "").replace(/<\/speak>\s*$/u, "");
}

/** Builds the request for a range and keeps its SSML to validate. */
function built(range: Range, options: SpeechOptions): SpeechRequest | undefined {
  const request = buildSpeechRequest(range, options);
  if (request !== undefined) produced.push(request.ssml);
  return request;
}

const pls = (lexemes: string, attributes = 'alphabet="ipa" xml:lang="en"'): Lexicon =>
  readLexicon(
    `<lexicon xmlns="http://www.w3.org/2005/01/pronunciation-lexicon" version="1.0" ${attributes}>${lexemes}</lexicon>`,
  );

describe("the SSML schema", () => {
  it("rejects an SSML document that SSML 1.1 does not allow, so that the tests that pass it mean something", async () => {
    const invalid = [
      '<speak xmlns="http://www.w3.org/2001/10/synthesis" version="1.1" xml:lang="en"><p><p>nested</p></p></speak>',
      '<speak xmlns="http://www.w3.org/2001/10/synthesis" version="1.1"><p>no language</p></speak>',
      '<speak xmlns="http://www.w3.org/2001/10/synthesis" version="1.1" xml:lang="en"><sub>no alias</sub></speak>',
    ];
    for (const ssml of invalid) {
      expect((await schemaIssues(ssml)).length, ssml).toBeGreaterThan(0);
    }
  });
});

describe("applyReadingType", () => {
  const markup = `
    <p id="a" data-qti-suppress-tts="screen-reader">Point A</p>
    <p id="b" data-qti-suppress-tts="all">Point B</p>
    <p id="c" data-qti-suppress-tts="computer-read-aloud">Point C</p>
    <p id="d" data-qti-a11y-content-role="screen-reader-orientation" class="qti-visually-hidden">A bar chart with three bars.</p>
    <p id="e" data-qti-a11y-content-role="long-description">Bar one is the tallest.</p>
    <p id="f" aria-hidden="true" data-qti-suppress-tts="computer-read-aloud">Authored</p>
    <p id="g">Plain</p>`;
  const hidden = (content: ContentRoot): string[] => content.findAll("p[aria-hidden]").map((element) => element.id);

  it("hides the content that data-qti-suppress-tts suppresses for screen readers from the accessible structure", () => {
    const content = mountContent(markup);
    applyReadingType(content.root, "screen-reader");
    expect(hidden(content)).toEqual(["a", "b", "f"]);
  });

  it("hides the screen reader orientation from a candidate who reads aloud with the computer, and no other content", () => {
    const content = mountContent(markup);
    applyReadingType(content.root, "computer-read-aloud");
    expect(hidden(content)).toEqual(["d", "f"]);
    expect(content.find("#e").hasAttribute("aria-hidden")).toBe(false);
  });

  it("exposes what an earlier call hid when the support changes, and leaves the aria-hidden of the content", () => {
    const content = mountContent(markup);
    applyReadingType(content.root, "screen-reader");
    applyReadingType(content.root, "computer-read-aloud");
    expect(hidden(content)).toEqual(["d", "f"]);
    applyReadingType(content.root, undefined);
    expect(hidden(content)).toEqual(["f"]);
  });

  it("leaves no axe violation in either mode", async () => {
    const content = mountContent(markup);
    for (const readingType of ["screen-reader", "computer-read-aloud", undefined] as const) {
      applyReadingType(content.root, readingType);
      expect(await axeViolations(content.host), String(readingType)).toEqual([]);
    }
  });
});

describe("buildSpeechRequest", () => {
  describe("namespaced SSML", () => {
    // The example of the best practices guide, "Item Example with Inline Pronunciation Using Namespaced SSML".
    const freud =
      '<qti-prompt>Sigmund <ssml:sub alias="Froyd">Freud</ssml:sub> and Carl <ssml:sub alias="young">Jung</ssml:sub> both belong to the <ssml:sub alias="sigh-co-analytical">psychoanalytical</ssml:sub> school of psychology.</qti-prompt>';

    it("speaks the alias of each sub, in an SSML 1.1 document that keeps the sub", () => {
      const request = read(mountContent(freud));
      expect(textOf(request)).toBe(
        "Sigmund Froyd and Carl young both belong to the sigh-co-analytical school of psychology.",
      );
      expect(inner(request)).toBe(
        '<p>Sigmund <sub alias="Froyd">Freud</sub> and Carl <sub alias="young">Jung</sub> both belong to the <sub alias="sigh-co-analytical">psychoanalytical</sub> school of psychology.</p>',
      );
      expect(request?.ssml).toContain('xmlns="http://www.w3.org/2001/10/synthesis"');
      expect(request?.ssml).toContain('version="1.1"');
    });

    it("does not display the SSML: the text shows as written, with no alias", () => {
      const content = mountContent(freud);
      // innerText is the text as rendered, which is what this test is about.
      // biome-ignore lint/performance/useDomNodeTextContent: the rendered text, not the text of the nodes.
      expect(content.find("qti-prompt").innerText).toBe(
        "Sigmund Freud and Carl Jung both belong to the psychoanalytical school of psychology.",
      );
    });

    it("speaks every element of the ASI schema with its attributes", () => {
      const request = read(
        mountContent(
          '<ssml:p><ssml:s>First <ssml:emphasis level="strong">sentence</ssml:emphasis>.</ssml:s><ssml:break strength="weak"/><ssml:s>Second<ssml:mark name="m1"/> <ssml:prosody rate="slow" pitch="+2st">slow</ssml:prosody> and <ssml:voice gender="female">voiced</ssml:voice> in <ssml:say-as interpret-as="characters">ABC</ssml:say-as> and <ssml:phoneme alphabet="ipa" ph="ˈrɛdɪŋ">Reading</ssml:phoneme>.</ssml:s></ssml:p><ssml:audio src="https://a.example/beep.mp3">Beep.</ssml:audio>',
        ),
      );
      expect(inner(request)).toBe(
        '<p><s>First <emphasis level="strong">sentence</emphasis>.</s><break strength="weak"/><s>Second<mark name="m1"/> <prosody pitch="+2st" rate="slow">slow</prosody> and <voice gender="female">voiced</voice> in <say-as interpret-as="characters">ABC</say-as> and <phoneme alphabet="ipa" ph="ˈrɛdɪŋ">Reading</phoneme>.</s></p><p><audio src="https://a.example/beep.mp3">Beep.</audio></p>',
      );
      expect(textOf(request)).toBe("First sentence. Second slow and voiced in ABC and Reading.\nBeep.");
    });

    it("drops an element that lacks an attribute it needs and an attribute that SSML does not define, and keeps the text", () => {
      const request = read(
        mountContent('<p>a <ssml:sub>b</ssml:sub> c <ssml:emphasis level="strong" onclick="x()">d</ssml:emphasis></p>'),
      );
      expect(inner(request)).toBe('<p>a b c <emphasis level="strong">d</emphasis></p>');
    });

    it("says the fallback of an audio element whose source is not http or https", () => {
      const request = read(
        mountContent(
          '<ssml:audio src="javascript:alert(1)">Fallback.</ssml:audio><ssml:audio src="data:audio/wav;base64,AAAA">Two.</ssml:audio>',
        ),
      );
      expect(inner(request)).toBe("<p>Fallback.Two.</p>");
    });

    it("reads the text of an element that holds text only, and none of the elements in it", () => {
      const request = read(mountContent('<p><ssml:sub alias="World Wide Web">W<em>W</em>W</ssml:sub></p>'));
      expect(inner(request)).toBe('<p><sub alias="World Wide Web">WWW</sub></p>');
    });
  });

  describe("data-ssml", () => {
    // The example of the best practices guide, "Item Example with Inline SSML Pronunciation using JSON markup".
    const freud = `<qti-prompt>Sigmund <span data-ssml='{"sub":{"alias":"Froyd"}}'>Freud</span> and Carl <span data-ssml='{"sub":{"alias":"young"}}'>Jung</span> both belong to the <span data-ssml='{"emphasis":{"level":"strong"}}'>
      <span data-ssml='{"sub":{"alias":"sigh-co-analytical"}}'>psychoanalytical
      </span></span> school of psychology.</qti-prompt>`;

    it("speaks the functions of data-ssml: the example of the best practices guide", () => {
      const request = read(mountContent(freud));
      expect(inner(request)).toBe(
        '<p>Sigmund <sub alias="Froyd">Freud</sub> and Carl <sub alias="young">Jung</sub> both belong to the <emphasis level="strong"><sub alias="sigh-co-analytical">psychoanalytical</sub></emphasis> school of psychology.</p>',
      );
      expect(textOf(request)).toBe(
        "Sigmund Froyd and Carl young both belong to the sigh-co-analytical school of psychology.",
      );
    });

    it("speaks the examples of data-ssml", () => {
      const request = read(
        mountContent(
          `<p>Please select the choice which is the base 10 equivalent to <span data-ssml='{"say-as":{"interpret-as":"characters"}}'>10111</span></p>` +
            `<p>My latest travel guide is about <span data-ssml='{"phoneme":{"alphabet":"ipa","ph":"ˈrɛdɪŋ"}}'>Reading</span>, Pennsylvania.</p>` +
            `<p>Our new vocabulary word is<span data-ssml='{"break":{"time":"250ms"}}'> </span>deoxyribonucleic acid.</p>` +
            `<p>Let's repeat that name slowly "<span data-ssml='{"prosody":{"rate":"slow"}}'>Tyrannosaurus Rex</span>".</p>`,
        ),
      );
      expect(inner(request)).toBe(
        '<p>Please select the choice which is the base 10 equivalent to <say-as interpret-as="characters">10111</say-as></p>' +
          '<p>My latest travel guide is about <phoneme alphabet="ipa" ph="ˈrɛdɪŋ">Reading</phoneme>, Pennsylvania.</p>' +
          '<p>Our new vocabulary word is<break time="250ms"/> deoxyribonucleic acid.</p>' +
          '<p>Let\'s repeat that name slowly "<prosody rate="slow">Tyrannosaurus Rex</prosody>".</p>',
      );
    });

    it("does not display data-ssml", () => {
      const content = mountContent(`<p>Say <span data-ssml='{"sub":{"alias":"Froyd"}}'>Freud</span></p>`);
      // biome-ignore lint/performance/useDomNodeTextContent: the rendered text, not the text of the nodes.
      expect(content.find("p").innerText).toBe("Say Freud");
    });

    it("reads an element whose data-ssml is not valid as if it had none", () => {
      const request = read(
        mountContent(
          `<p>a <span data-ssml='{"sub":{"alias":"x","extra":1}}'>b</span> <span data-ssml="not json">c</span></p>`,
        ),
      );
      expect(inner(request)).toBe("<p>a b c</p>");
    });

    it("speaks a pause that closes a paragraph, with the text before it", () => {
      const request = read(
        mountContent(`<p>Answer the following question. <span data-ssml='{"break":{"time":"2s"}}'></span></p>`),
      );
      expect(inner(request)).toBe('<p>Answer the following question. <break time="2s"/></p>');
      expect(textOf(request)).toBe("Answer the following question.");
    });
  });

  describe("lexicons", () => {
    const aliasEntry = pls("<lexeme><grapheme>W3C</grapheme><alias>World Wide Web Consortium</alias></lexeme>");
    const phonemeEntry = pls("<lexeme><grapheme>drosophila</grapheme><phoneme>dro'sɒfɪlə</phoneme></lexeme>");

    it("speaks the alias of an entry in place of the text, and keeps the text in the SSML", () => {
      const request = read(mountContent("<p>The W3C spec</p>"), {}, { lexicons: [aliasEntry] });
      expect(textOf(request)).toBe("The World Wide Web Consortium spec");
      expect(inner(request)).toBe('<p>The <sub alias="World Wide Web Consortium">W3C</sub> spec</p>');
    });

    it("gives the SSML the phonemes of an entry, in the alphabet of the lexicon, and the text stays", () => {
      const request = read(mountContent("<p>the drosophila fly</p>"), {}, { lexicons: [phonemeEntry] });
      expect(inner(request)).toBe('<p>the <phoneme alphabet="ipa" ph="dro\'sɒfɪlə">drosophila</phoneme> fly</p>');
      expect(textOf(request)).toBe("the drosophila fly");
    });

    it("matches the characters as written: the capital letter does not match (PLS 1.0 Appendix C)", () => {
      const request = read(mountContent("<p>Drosophila</p>"), {}, { lexicons: [phonemeEntry] });
      expect(inner(request)).toBe("<p>Drosophila</p>");
    });

    it("uses the lexicon only for text of its language", () => {
      const indonesian = read(mountContent('<p xml:lang="id">The W3C spec</p>'), {}, { lexicons: [aliasEntry] });
      expect(textOf(indonesian)).toBe("The W3C spec");
      const english = read(mountContent('<p xml:lang="en-GB">The W3C spec</p>'), {}, { lexicons: [aliasEntry] });
      expect(textOf(english)).toBe("The World Wide Web Consortium spec");
    });

    it("leaves text alone that SSML or data-ssml already pronounces", () => {
      const request = read(
        mountContent(
          `<p><ssml:sub alias="web">W3C</ssml:sub> <span data-ssml='{"sub":{"alias":"consortium"}}'>W3C</span></p>`,
        ),
        {},
        { lexicons: [aliasEntry] },
      );
      expect(textOf(request)).toBe("web consortium");
    });

    it("applies the lexicons to the alt text of an image, which is text that is said", () => {
      const request = read(mountContent('<img alt="The W3C logo"/>'), {}, { lexicons: [aliasEntry] });
      expect(textOf(request)).toBe("The World Wide Web Consortium logo");
    });
  });

  describe("suppression and what is read", () => {
    // The example of the best practices guide: "Text-to-Speech Suppression".
    const figure =
      '<p>Below is a figure with <span class="inline-math" data-qti-suppress-tts="computer-read-aloud">12</span> boxes.</p>' +
      '<div><img alt="Figure showing Rectangle ABCD divided into 12 equal area boxes. 4 of the boxes are shaded."/> <span data-qti-suppress-tts="screen-reader">Point A</span> <span data-qti-suppress-tts="screen-reader">Point B</span> ' +
      '<div class="qti-visually-hidden long-description" data-qti-suppress-tts="computer-read-aloud"><p>Rectangle ABCD...the long description goes here...</p></div></div>' +
      "<qti-prompt>In the figure above, what fraction of the rectangle <em>ABCD</em> is shaded?</qti-prompt>";

    it("leaves out what data-qti-suppress-tts suppresses for computer read-aloud, and reads the alt text and the labels", () => {
      expect(textOf(read(mountContent(figure)))).toBe(
        "Below is a figure with boxes.\nFigure showing Rectangle ABCD divided into 12 equal area boxes. 4 of the boxes are shaded. Point A Point B\nIn the figure above, what fraction of the rectangle ABCD is shaded?",
      );
    });

    it("leaves out content that is suppressed for all reading types", () => {
      const request = read(mountContent('<p>One <span data-qti-suppress-tts="all">two</span> three</p>'));
      expect(textOf(request)).toBe("One three");
    });

    it("does not read a range inside suppressed content", () => {
      const content = mountContent('<div data-qti-suppress-tts="computer-read-aloud"><p id="a">Hidden</p></div>');
      const range = document.createRange();
      range.selectNodeContents(content.find("#a"));
      expect(built(range, { settings: READ_ALOUD, messages: EN_MESSAGES, language: "en" })).toBeUndefined();
    });

    it("reads the content of the shared vocabulary example: the visually hidden words, and not the aria-hidden ones", () => {
      const request = read(
        mountContent(
          '<p>Jane paid <span class="qti-visually-hidden">25 dollars</span> <span aria-hidden="true">$25.00</span> for the taxi fare.</p>',
        ),
      );
      expect(textOf(request)).toBe("Jane paid 25 dollars for the taxi fare.");
    });

    it("leaves out hidden content: hidden, qti-hidden and display none", () => {
      const request = read(
        mountContent(
          '<p>a</p><p hidden="">b</p><p class="qti-hidden">c</p><p style="display: none">d</p><p><span aria-hidden="true">e</span>f</p>',
        ),
      );
      expect(textOf(request)).toBe("a\nf");
    });

    it("leaves out the screen reader orientation, which a candidate who looks at the screen does not need, and reads the long description", () => {
      const request = read(
        mountContent(
          '<div class="qti-visually-hidden" data-qti-a11y-content-role="screen-reader-orientation"><p>This is a bar chart.</p></div><div class="qti-visually-hidden" data-qti-a11y-content-role="long-description"><p>Bar one is the tallest.</p></div><p>Which bar is tallest?</p>',
        ),
      );
      expect(textOf(request)).toBe("Bar one is the tallest.\nWhich bar is tallest?");
    });

    it("reads the value of text fields, as the candidate typed it", () => {
      const content = mountContent(
        '<p>Your answer: <input type="text"/></p><textarea></textarea><input type="password"/>',
      );
      content.find<HTMLInputElement>("input").value = "forty-two";
      content.find<HTMLTextAreaElement>("textarea").value = "A long answer.";
      content.find<HTMLInputElement>('input[type="password"]').value = "secret";
      expect(textOf(read(content))).toBe("Your answer: forty-two\nA long answer.");
    });

    it("reads an expression by its text alternative, and by its text when it has none", () => {
      const request = read(
        mountContent(
          '<p>Compute <math xmlns="http://www.w3.org/1998/Math/MathML" alttext="two plus two"><mn>2</mn><mo>+</mo><mn>2</mn></math> and <math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math>.</p>',
        ),
      );
      expect(textOf(request)).toBe("Compute two plus two and x.");
    });

    it("reads an expression that MathJax typeset by the speech it made", () => {
      const request = read(
        mountContent(
          '<p>Compute <mjx-container><mjx-math aria-hidden="true"><mjx-mi>x</mjx-mi></mjx-math><mjx-speech aria-label="x plus 1, math" role="img"/></mjx-container> now.</p>',
        ),
      );
      expect(textOf(request)).toBe("Compute x plus 1, math now.");
    });

    it("reads a break of the content as a pause", () => {
      const request = read(mountContent("<p>one<br/>two</p>"));
      expect(inner(request)).toBe("<p>one<break/>two</p>");
      expect(textOf(request)).toBe("one two");
    });

    it("removes the characters that XML 1.0 does not allow from what the content says", () => {
      const content = mountContent("<p>a</p>");
      content.find("p").append("b\u0001c");
      expect(textOf(read(content))).toBe("abc");
    });
  });

  describe("restriction types", () => {
    const directions =
      '<qti-rubric-block><p>Answer all questions.</p></qti-rubric-block><qti-prompt id="prompt">What is <math xmlns="http://www.w3.org/1998/Math/MathML"><mn>2</mn></math> plus 2?</qti-prompt>';

    it("reads everything when unrestricted, and ignores an extension it does not know", () => {
      const variants: readonly (readonly RestrictionType[])[] = [[], ["unrestricted"], ["ext:iowa-reading"]];
      for (const restrictionTypes of variants) {
        expect(textOf(read(mountContent(directions), { restrictionTypes })), restrictionTypes.join()).toBe(
          "Answer all questions.\nWhat is 2 plus 2?",
        );
      }
    });

    it("reads only the directions, the rubric blocks, under directions-only", () => {
      const content = mountContent(directions);
      expect(textOf(read(content, { restrictionTypes: ["directions-only"] }))).toBe("Answer all questions.");
      const range = document.createRange();
      range.selectNodeContents(content.find("#prompt"));
      const options = {
        settings: { ...READ_ALOUD, restrictionTypes: ["directions-only" as const] },
        messages: EN_MESSAGES,
        language: "en",
      };
      expect(built(range, options)).toBeUndefined();
    });

    it("reads a range inside a rubric block under directions-only", () => {
      const content = mountContent(directions);
      const range = document.createRange();
      range.selectNodeContents(content.find("qti-rubric-block p"));
      const options = {
        settings: { ...READ_ALOUD, restrictionTypes: ["directions-only" as const] },
        messages: EN_MESSAGES,
        language: "en",
      };
      expect(built(range, options)?.text).toBe("Answer all questions.");
    });

    it("leaves out MathML, and the output of MathJax, under skip-math-equations", () => {
      const content = mountContent(
        '<p>Add <math xmlns="http://www.w3.org/1998/Math/MathML"><mn>2</mn></math> and <mjx-container><mjx-speech aria-label="three"/></mjx-container> now.</p>',
      );
      expect(textOf(read(content, { restrictionTypes: ["skip-math-equations"] }))).toBe("Add and now.");
    });

    it("leaves out chemical markup under skip-chemistry-equations", () => {
      const content = mountContent(
        '<p>React <molecule xmlns="http://www.xml-cml.org/schema"><atom>H</atom></molecule> with water.</p>',
      );
      expect(textOf(read(content, { restrictionTypes: ["skip-chemistry-equations"] }))).toBe("React with water.");
      expect(textOf(read(content))).toBe("React H with water.");
    });

    it("restricts by several types at once", () => {
      const request = read(mountContent(`${directions}<p>Outside.</p>`), {
        restrictionTypes: ["directions-only", "skip-math-equations"],
      });
      expect(textOf(request)).toBe("Answer all questions.");
    });

    it("reads one word at a time under word-by-word, and nothing for more than one", () => {
      const content = mountContent("<p>Two words</p>");
      const text = content.find("p").firstChild;
      if (!(text instanceof Text)) throw new Error("The paragraph has no text.");
      const options = {
        settings: { ...READ_ALOUD, restrictionTypes: ["word-by-word" as const] },
        messages: EN_MESSAGES,
        language: "en",
      };
      const word = document.createRange();
      word.setStart(text, 4);
      word.setEnd(text, 9);
      expect(built(word, options)?.text).toBe("words");
      expect(built(wholeRoot(content), options)).toBeUndefined();
    });

    it("reads the alias of the one word that is selected under word-by-word", () => {
      const content = mountContent(`<p>Say <span data-ssml='{"sub":{"alias":"World Wide Web"}}'>WWW</span> twice</p>`);
      const range = document.createRange();
      range.selectNode(content.find("span"));
      const options = {
        settings: { ...READ_ALOUD, restrictionTypes: ["word-by-word" as const] },
        messages: EN_MESSAGES,
        language: "en",
      };
      expect(built(range, options)?.text).toBe("World Wide Web");
    });
  });

  describe("link indication", () => {
    const link = '<p>See <a href="#guide">the guide</a> now.</p>';

    it("says link before the text of a link for speak-link, in the language of the interface", () => {
      const request = read(mountContent(link), { linkIndication: "speak-link" });
      expect(textOf(request)).toBe("See link the guide now.");
      expect(textOf(read(mountContent(link), { linkIndication: "speak-link" }, { messages: ID_MESSAGES }))).toBe(
        "See tautan the guide now.",
      );
    });

    it("says the text of a link in another voice for different-voice", () => {
      const request = read(mountContent(link), { linkIndication: "different-voice" });
      expect(inner(request)).toBe('<p>See <voice variant="2">the guide</voice> now.</p>');
      expect(textOf(request)).toBe("See the guide now.");
    });

    it("marks a link with the word for a sound effect, because the player has no sound to play", () => {
      expect(textOf(read(mountContent(link), { linkIndication: "sound-effect" }))).toBe("See link the guide now.");
    });

    it("says a link as any other text for none and when the support sets no indication", () => {
      expect(textOf(read(mountContent(link), { linkIndication: "none" }))).toBe("See the guide now.");
      expect(textOf(read(mountContent(link)))).toBe("See the guide now.");
      expect(textOf(read(mountContent("<p>See <a>the anchor</a>.</p>"), { linkIndication: "speak-link" }))).toBe(
        "See the anchor.",
      );
    });
  });

  describe("the request", () => {
    it("has the rate, the pitch and the volume of the support, and none when the support sets none", () => {
      const content = mountContent("<p>Hello</p>");
      expect(read(content, { speechRate: 240, pitch: 0.25, volume: 1 })).toMatchObject({
        rate: 240,
        pitch: 0.25,
        volume: 1,
      });
      const plain = read(content);
      expect(plain).toBeDefined();
      expect(Object.keys(plain ?? {}).sort()).toEqual(["lang", "ssml", "text"]);
    });

    it("has the language of the first text, from xml:lang or lang, else the language of the option", () => {
      expect(read(mountContent('<div xml:lang="id-ID"><p>Halo</p></div>'))?.lang).toBe("id-ID");
      expect(read(mountContent('<div lang="fr"><p>Bonjour</p></div>'))?.lang).toBe("fr");
      expect(read(mountContent("<p>Hello</p>"), {}, { language: "jv" })?.lang).toBe("jv");
      expect(read(mountContent("<p>Hello</p>"))?.ssml).toContain('xml:lang="en"');
    });

    it("has nothing to say for a candidate who reads with a screen reader, which is the default", () => {
      const content = mountContent("<p>Hello</p>");
      expect(read(content, { readingType: "screen-reader" })).toBeUndefined();
      expect(built(wholeRoot(content), { settings: {}, messages: EN_MESSAGES, language: "en" })).toBeUndefined();
    });

    it("has nothing to say when there is nothing to read", () => {
      expect(read(mountContent("<p> </p><p hidden=''>x</p>"))).toBeUndefined();
      expect(read(mountContent(""))).toBeUndefined();
    });

    it("reads the part of the content that the range holds, and in the first text only the part of it", () => {
      const content = mountContent("<p>First paragraph.</p><p>Second paragraph.</p><p>Third paragraph.</p>");
      const [first, second, third] = content.findAll("p").map((element) => element.firstChild);
      if (!(first instanceof Text && second instanceof Text && third instanceof Text)) throw new Error("No text.");
      const range = document.createRange();
      range.setStart(first, 6);
      range.setEnd(third, 5);
      expect(read(content) && built(range, { settings: READ_ALOUD, messages: EN_MESSAGES, language: "en" })?.text).toBe(
        "paragraph.\nSecond paragraph.\nThird",
      );
    });

    it("applies the SSML of an element only when the range holds all of it", () => {
      const content = mountContent('<p>say <ssml:sub alias="World Wide Web">WWW</ssml:sub> now</p>');
      const text = content.find("sub, p").firstChild;
      const sub = content.root.querySelector("sub");
      const inside = sub?.firstChild;
      if (!(text instanceof Text) || !(inside instanceof Text)) throw new Error("No text.");
      const options = { settings: READ_ALOUD, messages: EN_MESSAGES, language: "en" };
      const part = document.createRange();
      part.setStart(inside, 0);
      part.setEnd(inside, 2);
      expect(built(part, options)?.text).toBe("WW");
      const whole = document.createRange();
      whole.selectNode(sub ?? text);
      expect(built(whole, options)?.text).toBe("World Wide Web");
    });
  });

  it("leaves no axe violation in a content root that is read", async () => {
    const content = mountContent(
      '<qti-prompt>Sigmund <ssml:sub alias="Froyd">Freud</ssml:sub> and <span data-ssml=\'{"emphasis":{"level":"strong"}}\'>Jung</span>.</qti-prompt>',
    );
    expect(read(content)).toBeDefined();
    expect(await axeViolations(content.host)).toEqual([]);
  });
});

describe("SpeechHook", () => {
  it("gets the request that the player built, from any voice that implements it", async () => {
    const heard: SpeechRequest[] = [];
    let stopped = 0;
    const voice: SpeechHook = {
      speak: async (request) => {
        heard.push(request);
      },
      stop: () => {
        stopped++;
      },
    };
    const request = read(mountContent('<p xml:lang="id">Halo <ssml:sub alias="dunia">bumi</ssml:sub></p>'), {
      speechRate: 150,
      pitch: 0.8,
      volume: 0.6,
    });
    if (request === undefined) throw new Error("No request.");
    await voice.speak(request);
    voice.stop();
    expect(heard).toEqual([{ ...request, lang: "id", text: "Halo dunia", rate: 150, pitch: 0.8, volume: 0.6 }]);
    expect(stopped).toBe(1);
  });
});

describe("echoTyping", () => {
  const stops: (() => void)[] = [];
  afterEach(() => {
    for (const stop of stops.splice(0)) stop();
  });

  /** A voice that records what it is asked to say. */
  function recorder(): { readonly hook: SpeechHook; readonly requests: SpeechRequest[] } {
    const requests: SpeechRequest[] = [];
    return {
      requests,
      hook: {
        speak: async (request) => {
          requests.push(request);
          produced.push(request.ssml);
        },
        stop: () => undefined,
      },
    };
  }

  /** Types in a field of a content root with the echo on, and returns what the voice was asked to say. */
  async function typed(
    echo: "characters" | "words" | "characters-and-words" | "none",
    keys: string,
    markup = "<input/>",
    messages = EN_MESSAGES,
  ): Promise<string[]> {
    const content = mountContent(markup);
    const field = content.find<HTMLInputElement>("input, textarea");
    const { hook, requests } = recorder();
    stops.push(echoTyping(field, { hook, echo, messages, language: "en" }));
    await userEvent.type(field, keys);
    return requests.map((request) => request.text);
  }

  it("says each character as it is typed, and the word for a space, under characters", async () => {
    expect(await typed("characters", "ab c")).toEqual(["a", "b", "space", "c"]);
  });

  it("says the word for a space in the language of the interface", async () => {
    expect(await typed("characters", "a b", "<input/>", ID_MESSAGES)).toEqual(["a", "spasi", "b"]);
  });

  it("says each word when a character that is not part of a word ends it, under words", async () => {
    expect(await typed("words", "hi there. ")).toEqual(["hi", "there"]);
  });

  it("says each character, and the word instead of the character that ends it, under characters-and-words", async () => {
    expect(await typed("characters-and-words", "hi ")).toEqual(["h", "i", "hi"]);
  });

  it("says nothing under none", async () => {
    expect(await typed("none", "hi there ")).toEqual([]);
  });

  it("echoes the typing in a text area too", async () => {
    expect(await typed("words", "one two ", "<textarea></textarea>")).toEqual(["one", "two"]);
  });

  it("says a character as the letters of a say-as in SSML, and the word for a space as text", async () => {
    const content = mountContent("<input/>");
    const field = content.find<HTMLInputElement>("input");
    const { hook, requests } = recorder();
    stops.push(echoTyping(field, { hook, echo: "characters", messages: EN_MESSAGES, language: "en" }));
    await userEvent.type(field, "a ");
    expect(
      requests.map((request) => request.ssml.replace(/^[\s\S]*?<speak[^>]*>/u, "").replace(/<\/speak>\s*$/u, "")),
    ).toEqual(['<p><say-as interpret-as="characters">a</say-as></p>', "<p>space</p>"]);
  });

  it("says it in the language of the field, else the language of the option", async () => {
    const content = mountContent('<div xml:lang="id"><input/></div><input id="other"/>');
    const { hook, requests } = recorder();
    stops.push(
      echoTyping(content.find<HTMLInputElement>("input"), {
        hook,
        echo: "characters",
        messages: EN_MESSAGES,
        language: "en",
      }),
    );
    stops.push(
      echoTyping(content.find<HTMLInputElement>("#other"), {
        hook,
        echo: "characters",
        messages: EN_MESSAGES,
        language: "jv",
      }),
    );
    await userEvent.type(content.find<HTMLInputElement>("input"), "a");
    await userEvent.type(content.find<HTMLInputElement>("#other"), "b");
    expect(requests.map((request) => request.lang)).toEqual(["id", "jv"]);
  });

  it("echoes typed characters only: not deletions, not pasted text, not a prediction of several characters", async () => {
    const content = mountContent("<input/>");
    const field = content.find<HTMLInputElement>("input");
    const { hook, requests } = recorder();
    stops.push(echoTyping(field, { hook, echo: "characters-and-words", messages: EN_MESSAGES, language: "en" }));
    await userEvent.type(field, "ab");
    requests.length = 0;
    await userEvent.keyboard("{Backspace}");
    field.dispatchEvent(new InputEvent("input", { inputType: "insertFromPaste", data: "pasted " }));
    field.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: "predicted " }));
    expect(requests).toEqual([]);
  });

  it("stops echoing when the function that echoTyping returned is called", async () => {
    const content = mountContent("<input/>");
    const field = content.find<HTMLInputElement>("input");
    const { hook, requests } = recorder();
    const stop = echoTyping(field, { hook, echo: "characters", messages: EN_MESSAGES, language: "en" });
    await userEvent.type(field, "a");
    stop();
    await userEvent.type(field, "b");
    expect(requests.map((request) => request.text)).toEqual(["a"]);
  });

  it("lets the candidate type when the voice fails", async () => {
    const content = mountContent("<input/>");
    const field = content.find<HTMLInputElement>("input");
    const hook: SpeechHook = {
      speak: () => Promise.reject(new AssesskitError("The voice failed.")),
      stop: () => undefined,
    };
    stops.push(echoTyping(field, { hook, echo: "characters", messages: EN_MESSAGES, language: "en" }));
    await userEvent.type(field, "ab");
    expect(field.value).toBe("ab");
  });
});

describe("createWebSpeech", () => {
  /** Replaces the voice of the browser by one that records the utterances; the test ends them. */
  function fakeVoice(): { readonly spoken: SpeechSynthesisUtterance[]; readonly cancel: ReturnType<typeof vi.fn> } {
    const spoken: SpeechSynthesisUtterance[] = [];
    vi.spyOn(window.speechSynthesis, "speak").mockImplementation((utterance) => {
      spoken.push(utterance);
    });
    const cancel = vi.fn();
    vi.spyOn(window.speechSynthesis, "cancel").mockImplementation(cancel);
    return { spoken, cancel };
  }
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const request: SpeechRequest = { ssml: "<speak/>", text: "Hello there", lang: "en-GB" };

  /** Waits until the voice has an utterance, as `speak` is asynchronous. */
  const utteranceOf = async (spoken: readonly SpeechSynthesisUtterance[]): Promise<SpeechSynthesisUtterance> => {
    await waitFor(() => expect(spoken).toHaveLength(1));
    const [utterance] = spoken;
    if (utterance === undefined) throw new Error("No utterance.");
    return utterance;
  };

  it("speaks the text of the request in its language, and resolves when the voice ends", async () => {
    const { spoken } = fakeVoice();
    const done = createWebSpeech().speak(request);
    const utterance = await utteranceOf(spoken);
    expect(utterance.text).toBe("Hello there");
    expect(utterance.lang).toBe("en-GB");
    utterance.dispatchEvent(new Event("end"));
    await expect(done).resolves.toBeUndefined();
  });

  it("leaves the rate, the pitch and the volume of the voice alone when the request has none", async () => {
    const { spoken } = fakeVoice();
    void createWebSpeech().speak(request);
    const utterance = await utteranceOf(spoken);
    expect([utterance.rate, utterance.pitch, utterance.volume]).toEqual([1, 1, 1]);
  });

  it("maps 180 words per minute to the rate 1, the pitch 0.5 to 1, and takes the volume as it is", async () => {
    const { spoken } = fakeVoice();
    void createWebSpeech().speak({ ...request, rate: 240, pitch: 0.25, volume: 0.8 });
    const utterance = await utteranceOf(spoken);
    expect(utterance.rate).toBeCloseTo(240 / 180, 5);
    expect(utterance.pitch).toBeCloseTo(0.5, 5);
    expect(utterance.volume).toBeCloseTo(0.8, 5);
  });

  it("keeps the rate within what the Web Speech API allows", async () => {
    const { spoken } = fakeVoice();
    void createWebSpeech().speak({ ...request, rate: 5000 });
    expect((await utteranceOf(spoken)).rate).toBe(10);
    spoken.length = 0;
    void createWebSpeech().speak({ ...request, rate: 1 });
    expect((await utteranceOf(spoken)).rate).toBeCloseTo(0.1, 5);
  });

  it("speaks the aliases of the content in place of the text, because the voice ignores SSML", async () => {
    const { spoken } = fakeVoice();
    const content = mountContent(
      '<p>The <ssml:sub alias="World Wide Web Consortium">W3C</ssml:sub> says <span data-ssml=\'{"phoneme":{"ph":"x"}}\'>read</span> and DSSML.</p>',
    );
    const lexicons = [pls("<lexeme><grapheme>DSSML</grapheme><alias>data S S M L</alias></lexeme>")];
    const built = read(content, {}, { lexicons });
    if (built === undefined) throw new Error("No request.");
    void createWebSpeech().speak(built);
    expect((await utteranceOf(spoken)).text).toBe("The World Wide Web Consortium says read and data S S M L.");
  });

  it("stops the voice before it speaks, and resolves what it stopped", async () => {
    const { spoken, cancel } = fakeVoice();
    const first = createWebSpeech().speak(request);
    const utterance = await utteranceOf(spoken);
    expect(cancel).toHaveBeenCalledTimes(1);
    utterance.dispatchEvent(Object.assign(new Event("error"), { error: "interrupted" }));
    await expect(first).resolves.toBeUndefined();
  });

  it("stops with stop", () => {
    const { cancel } = fakeVoice();
    createWebSpeech().stop();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("rejects with a AssesskitError when the voice fails", async () => {
    const { spoken } = fakeVoice();
    const done = createWebSpeech().speak(request);
    const utterance = await utteranceOf(spoken);
    utterance.dispatchEvent(Object.assign(new Event("error"), { error: "synthesis-failed" }));
    await expect(done).rejects.toThrow(AssesskitError);
    await expect(done).rejects.toThrow(/synthesis-failed/u);
  });

  it("rejects a request that is not one with a DataError", async () => {
    fakeVoice();
    await expect(createWebSpeech().speak(JSON.parse('{"text":3}'))).rejects.toThrow(DataError);
    await expect(createWebSpeech().speak(JSON.parse("null"))).rejects.toThrow(DataError);
  });
});
