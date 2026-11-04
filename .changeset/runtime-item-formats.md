---
"@assesskit/runtime": major
---

`@assesskit/runtime/item-formats`: `readGift` and `readMoodleXml` read a GIFT or a Moodle XML file, the formats of Moodle's
question bank, into QTI items as Moodle's own importers read them, and `writeGift` and `writeMoodleXml` write QTI items as files
that Moodle imports. Multiple choice of one and of several answers, true or false, short answers, numerical questions, matching
questions, essays and descriptions convert, with their credits, Moodle's grades, per-answer, general and combined feedback,
categories, identifiers and tags; a short answer or an inline choice at GIFT's missing word stands at its place in the text. A reader writes each grading in QTI's own
expressions; a writer learns an item's credits and feedback by running its response processing. Everything that does not
convert is in the result's `losses`, each with its reason (`item`, `scoring`, `feedback`, `content`, `setting`). The HTML of
a question is parsed with parse5, a new dependency, and kept as QTI content; `DEFAULT_ITEM_FORMAT_LIMITS` bounds a file.
Moodle XML also carries the mark, shuffling, case, the feedback by how right a response is, an essay's options and information
for graders, and the files that a text embeds, which `readMoodleXml` returns in `files` and `writeMoodleXml` takes in its option
`files`.
