<?php
// What Moodle makes of the files that assesskit's writers write and of edge cases of each format: for each case, Moodle's own
// importer reads the file into a category of a question bank, as "Import" in its question bank does; then, for each question it
// kept, this script records what Moodle stored, grades the responses of the case with the question's own grade_response, and
// exports the question with Moodle's own GIFT and XML exporters.
//
//   php /opt/questions.php <cases.json> <result.json>
//
// The cases are { "cases": [{ "name", "format": "gift" | "xml", "file", "responses": { "<question name>": [response, ...] } }] }.
// A response is null (no response), { "choice": i }, { "choices": [i, ...] } (answers by their position in the file),
// { "value": true | false }, { "text": "..." } or { "pairs": [[stem position, "answer text"], ...] }.

define('CLI_SCRIPT', true);
require('/var/www/html/config.php');
require_once($CFG->libdir . '/questionlib.php');
require_once($CFG->dirroot . '/question/format.php');
require_once($CFG->dirroot . '/question/format/gift/format.php');
require_once($CFG->dirroot . '/question/format/xml/format.php');
require_once($CFG->dirroot . '/question/engine/lib.php');

\core\session\manager::set_user(get_admin());
$course = get_site();
$bank = \core_question\local\bank\question_bank_helper::get_default_open_instance_system_type($course, true);
$context = context_module::instance($bank->id);
$top = question_get_top_category($context->id, true);

/** Returns the response of Moodle's question for a response of a case, given the order of the choices of its attempt. */
function moodle_response(question_definition $question, question_attempt_step $step, $response): array {
    if ($response === null) {
        return [];
    }
    if (array_key_exists('choice', $response)) {
        return ['answer' => $response['choice']];
    }
    if (array_key_exists('choices', $response)) {
        $result = [];
        foreach ($response['choices'] as $index) {
            $result['choice' . $index] = 1;
        }
        return $result;
    }
    if (array_key_exists('value', $response)) {
        return ['answer' => $response['value'] ? 1 : 0];
    }
    if (array_key_exists('text', $response)) {
        return ['answer' => $response['text']];
    }
    // The choices of a match are numbered from 1 in the order that the attempt drew, which its step records.
    $order = explode(',', $step->get_qt_var('_choiceorder'));
    $result = [];
    foreach ($response['pairs'] as [$stem, $answer]) {
        $choice = 0;
        foreach ($order as $index => $choiceid) {
            if ((string) $question->choices[$choiceid] === $answer) {
                $choice = $index + 1;
            }
        }
        $result['sub' . $stem] = $choice;
    }
    return $result;
}

/** Returns the grade of a response, or null when Moodle does not grade it, as for no response. */
function grade(int $id, $response) {
    $question = question_bank::load_question($id);
    if (property_exists($question, 'shuffleanswers')) {
        $question->shuffleanswers = false;
    }
    if (property_exists($question, 'shufflestems')) {
        $question->shufflestems = false;
    }
    $step = new question_attempt_step();
    $question->start_attempt($step, 1);
    if ($question->qtype->name() === 'essay') {
        return null;
    }
    $moodle = moodle_response($question, $step, $response);
    if (!$question->is_gradable_response($moodle)) {
        return null;
    }
    [$fraction] = $question->grade_response($moodle);
    return (float) $fraction;
}

/** Returns a text with its format's name, as Moodle's XML names it. */
function text_of($text, $format): array {
    return ['text' => (string) $text, 'format' => (new qformat_xml())->get_format((int) $format)];
}

/** Returns what Moodle stored of a question, in the terms of its exporters. */
function read_question(stdClass $data, string $category): array {
    $options = $data->options;
    $read = [
        'qtype' => $data->qtype,
        'name' => $data->name,
        'questiontext' => text_of($data->questiontext, $data->questiontextformat),
        'generalfeedback' => text_of($data->generalfeedback, $data->generalfeedbackformat),
        'defaultmark' => (float) $data->defaultmark,
        'penalty' => (float) $data->penalty,
        'idnumber' => (string) ($data->idnumber ?? ''),
        'category' => $category,
        'tags' => array_values(core_tag_tag::get_item_tags_array('core_question', 'question', $data->id)),
    ];
    if (!empty($options->answers)) {
        $read['answers'] = array_values(array_map(fn($answer) => array_filter([
            'answer' => (string) $answer->answer,
            'fraction' => (float) $answer->fraction,
            'feedback' => (string) $answer->feedback,
            'tolerance' => isset($answer->tolerance) && $answer->tolerance !== '' ? (float) $answer->tolerance : null,
        ], fn($value) => $value !== null), $options->answers));
    }
    foreach (['single', 'shuffleanswers', 'usecase', 'responseformat', 'responsefieldlines', 'responserequired',
            'attachments', 'minwordlimit', 'maxwordlimit', 'graderinfo', 'responsetemplate', 'correctfeedback',
            'partiallycorrectfeedback', 'incorrectfeedback'] as $field) {
        if (isset($options->$field)) {
            $read[$field] = is_numeric($options->$field) ? (float) $options->$field : (string) $options->$field;
        }
    }
    if (isset($options->trueanswer)) {
        $read['correct'] = (float) $options->answers[$options->trueanswer]->fraction === 1.0;
    }
    if (!empty($options->subquestions)) {
        $read['subquestions'] = array_values(array_map(fn($sub) => [
            'questiontext' => (string) $sub->questiontext,
            'answertext' => (string) $sub->answertext,
        ], $options->subquestions));
    }
    return $read;
}

$input = json_decode(file_get_contents($argv[1]), true);
$results = [];
foreach ($input['cases'] as $number => $case) {
    $category = $DB->get_record('question_categories', ['id' => $DB->insert_record('question_categories', (object) [
        'name' => 'Case ' . ($number + 1), 'contextid' => $context->id, 'info' => '', 'infoformat' => FORMAT_HTML,
        'stamp' => make_unique_id_code(), 'parent' => $top->id, 'sortorder' => 999, 'idnumber' => null,
    ])]);
    $path = tempnam(sys_get_temp_dir(), 'case');
    file_put_contents($path, $case['file']);
    $format = $case['format'] === 'gift' ? new qformat_gift() : new qformat_xml();
    $format->setCategory($category);
    $format->setContexts([$context]);
    $format->setCourse($course);
    $format->setFilename($path);
    $format->setRealfilename(basename($path));
    $format->setMatchgrades('error');
    $format->setCatfromfile(true);
    $format->setContextfromfile(false);
    $format->setStoponerror(false);
    $format->set_display_progress(false);
    ob_start();
    $failure = null;
    try {
        $format->importpreprocess();
        $format->importprocess();
        $format->importpostprocess();
    } catch (Throwable $error) {
        $failure = get_class($error) . ': ' . $error->getMessage();
    }
    $log = trim(strip_tags(ob_get_clean()));
    unlink($path);
    $questions = [];
    foreach ($format->questionids as $id) {
        // An import that Moodle rolls back keeps the ids of the questions it had saved, whose records are gone.
        if (!$DB->record_exists('question', ['id' => $id])) {
            continue;
        }
        $data = question_bank::load_question_data($id);
        $categoryname = $DB->get_field('question_categories', 'name', ['id' => $data->category]);
        $data->contextid = $context->id;
        $grades = [];
        foreach ($case['responses'][$data->name] ?? [] as $response) {
            $grades[] = grade($id, $response);
        }
        $questions[] = [
            'read' => read_question($data, $categoryname),
            'grades' => $grades,
            'gift' => (new qformat_gift())->writequestion(clone $data),
            'xml' => (new qformat_xml())->writequestion(clone $data),
        ];
    }
    $results[] = ['name' => $case['name'], 'failure' => $failure, 'log' => $log, 'questions' => $questions];
}
file_put_contents($argv[2], json_encode(['cases' => $results], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n");
