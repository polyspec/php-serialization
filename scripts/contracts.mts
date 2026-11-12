// Writes contracts/php-serialize.json from the PHP of .php-version, the reference of the format: the bytes that PHP
// serializes for each case with the typed tree that PHP holds for them, and the bytes that PHP refuses. --check compares
// the result with the committed file, so CI proves the contract against real PHP. The random cases come from a fixed seed.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { PHP_TREE } from './php-tree.mts';

const CONTRACT = 'contracts/php-serialize.json';

const generator = String.raw`<?php
ini_set('serialize_precision', '-1');
ini_set('unserialize_max_depth', '4096');
error_reporting(E_ALL & ~E_WARNING & ~E_NOTICE & ~E_DEPRECATED);

${PHP_TREE}
function record(string $id, string $bytes, bool $withTree = true): array {
    $value = unserialize($bytes, ['allowed_classes' => ['stdClass']]);
    if ($value === false && $bytes !== 'b:0;') throw new RuntimeException("PHP refuses the bytes of $id");
    if (serialize($value) !== $bytes) throw new RuntimeException("PHP does not round-trip the bytes of $id");
    $case = ['id' => $id, 'bytes' => base64_encode($bytes)];
    if ($withTree) {
        $state = ['objects' => [], 'references' => []];
        $holder = [$value];
        $case['tree'] = tree($holder[0], $state);
    }
    return $case;
}

$object = new stdClass();
$object->name = 'a';
$object->{'5'} = 1;
$shared = new stdClass();
$shared->x = 1;
$reference = [1];
$cycle = [];
$cycle['self'] = &$cycle;
$scalar = 7;

$values = [
    'null' => null, 'true' => true, 'false' => false,
    'int_zero' => 0, 'int_one' => 1, 'int_negative' => -1,
    'int_safe_max' => 9007199254740991, 'int_past_safe' => 9007199254740993,
    'int_max' => PHP_INT_MAX, 'int_min' => PHP_INT_MIN,
    'float_one' => 1.0, 'float_half' => 0.5, 'float_negative_zero' => -0.0, 'float_zero' => 0.0, 'float_tenth' => 0.1,
    'float_third' => 1.0 / 3.0, 'float_inf' => INF, 'float_negative_inf' => -INF, 'float_nan' => NAN,
    'float_max' => PHP_FLOAT_MAX, 'float_min' => PHP_FLOAT_MIN, 'float_epsilon' => PHP_FLOAT_EPSILON,
    'float_subnormal' => 5e-324, 'float_past_safe' => 9007199254740992.0,
    'float_1e14' => 1e14, 'float_1e15' => 1e15, 'float_1e16' => 1e16, 'float_1e17' => 1e17, 'float_1e18' => 1e18,
    'float_1e25' => 1e25, 'float_1_5e300' => 1.5e300, 'float_negative_1e25' => -1e25,
    'float_1e_3' => 1e-3, 'float_1e_4' => 1e-4, 'float_1e_5' => 1e-5, 'float_1_5e_7' => 1.5e-7,
    'float_123456789012345678' => 123456789012345678.0, 'float_100000' => 100000.0, 'float_tie_even' => -98481486523842.625, 'float_1234_5' => 1234.5,
    'string_empty' => '', 'string_ascii' => 'hello', 'string_korean' => '안녕하세요', 'string_emoji' => "\u{1F600}",
    'string_quote' => 'a";s:1:"b', 'string_nul' => "a\0b", 'string_invalid_utf8' => "\xff\xfe", 'string_bom' => "\xef\xbb\xbfa",
    'string_numeric' => '5', 'string_newline' => "a\r\nb",
    'array_empty' => [], 'array_list' => [1, 2, 3], 'array_nested_list' => [[1], [2, [3]]],
    'array_map' => ['a' => 1, 'b' => 2], 'array_gap' => [1 => 'a', 2 => 'b'], 'array_reversed' => [1 => 'a', 0 => 'b'],
    'array_negative_key' => [-1 => 'a'], 'array_numeric_string_key' => ['5' => 'a', '05' => 'b', '-5' => 'c', '-0' => 'd', '5.0' => 'e'],
    'array_key_max' => ['9223372036854775807' => 'a', '9223372036854775808' => 'b'],
    'array_key_min' => ['-9223372036854775808' => 'a', '-9223372036854775809' => 'b'],
    'array_empty_string_key' => ['' => 1], 'array_invalid_utf8_key' => ["\xff" => 1, 'a' => 2], 'array_korean_key' => ['한글' => 1],
    'array_mixed' => ['a' => null, 'b' => true, 'c' => 1, 'd' => 1.0, 'e' => 's', 'f' => [], 'g' => new stdClass()],
    'array_long_digit_key' => [str_repeat('1', 5000) => 1], 'array_long_numeric_prefix_key' => ['-' . str_repeat('9', 30) => 1],
    'object_empty' => new stdClass(), 'object_props' => $object, 'object_in_array' => ['o' => clone $object],
    'object_nested' => (object) ['a' => (object) ['b' => []]],
    'object_repeated' => [$shared, $shared, 'x', $shared],
    'reference_array' => [&$reference, &$reference, 'x'],
    'reference_scalar' => [&$scalar, 'x', &$scalar],
    'reference_cycle' => $cycle,
    'array_nul_key' => ["\0a" => 1, "\0" => 2], 'object_empty_name' => (object) ['' => 1],
    'session_like' => ['user' => ['id' => 1, 'name' => '홍길동', 'score' => 1.0, 'tags' => ['a', 'b'], 'meta' => new stdClass()], 'csrf' => str_repeat('a', 64), 'at' => 1793653509],
];

$cases = [];
foreach ($values as $id => $value) $cases[] = record($id, serialize($value));

// Forms of the grammar that PHP reads but does not write: the case holds the tree and the bytes that PHP writes back.
$forms = [
    'form_escaped_string' => 'S:3:"a\62c";', 'form_escaped_key' => 'a:1:{S:1:"\61";i:1;}', 'form_plus_int' => 'i:+5;',
    'form_negative_zero_int' => 'i:-0;', 'form_float_int' => 'd:1;', 'form_float_dot' => 'd:1.;', 'form_float_lead' => 'd:.5;',
    'form_float_exp' => 'd:1e3;', 'form_float_upper' => 'd:1.5E+3;', 'form_duplicate_key' => 'a:3:{s:1:"a";i:1;s:1:"b";i:2;s:1:"a";i:3;}',
    'form_numeric_string_key' => 'a:1:{s:1:"5";i:1;}', 'form_object_case' => 'O:8:"STDCLASS":1:{s:1:"a";i:1;}',
    'form_long_zero_int' => 'i:' . str_repeat('0', 5000) . '5;', 'form_long_zero_length' => 's:' . str_repeat('0', 5000) . '1:"a";',
    'form_long_zero_count' => 'a:' . str_repeat('0', 5000) . ':{}', 'form_object_count_empty' => 'O:8:"stdClass"::{}', 'form_object_count_plus' => 'O:8:"stdClass":+0:{}',
    'form_length_wraps' => 's:18446744073709551617:"a";',
    'form_object_int_key' => 'O:8:"stdClass":1:{i:5;i:1;}', 'form_empty_array_slot' => 'a:2:{i:0;a:0:{}i:1;R:2;}',
];
$normal = [];
foreach ($forms as $id => $bytes) {
    $value = unserialize($bytes, ['allowed_classes' => ['stdClass']]);
    if ($value === false) throw new RuntimeException("PHP refuses the form $id");
    $state = ['objects' => [], 'references' => []];
    $holder = [$value];
    $normal[] = ['id' => $id, 'bytes' => base64_encode($bytes), 'tree' => tree($holder[0], $state), 'written' => base64_encode(serialize($value))];
}

// Random data with a fixed seed: every bit pattern of a double, then values nested from every kind.
mt_srand(20261103);
$randomFloats = [];
for ($index = 0; $index < 3000; $index++) {
    $randomFloats[] = unpack('E', pack('NN', mt_rand(0, 0xFFFFFFFF), mt_rand(0, 0xFFFFFFFF)))[1];
}
for ($index = 0; $index < 3000; $index++) $randomFloats[] = mt_rand(-1000000, 1000000) / 10 ** mt_rand(0, 12);
for ($index = -330; $index <= 310; $index++) {
    $randomFloats[] = (float) "1e$index";
    $randomFloats[] = (float) "1.2345678901234567e$index";
}
$cases[] = record('random_floats', serialize($randomFloats));

function randomValue(int $depth): mixed {
    switch (mt_rand(0, $depth > 0 ? 8 : 6)) {
        case 0: return null;
        case 1: return (bool) mt_rand(0, 1);
        case 2: return mt_rand(0, 1) ? mt_rand(-100, 100) : (mt_rand() << 32) | mt_rand();
        case 3: return mt_rand(-1000, 1000) / 8;
        case 4: return (float) mt_rand(-1000, 1000);
        case 5: return randomString();
        case 6: return randomString();
        case 7:
            $list = [];
            for ($count = mt_rand(0, 4); $count > 0; $count--) $list[] = randomValue($depth - 1);
            return $list;
        default:
            $map = [];
            for ($count = mt_rand(0, 4); $count > 0; $count--) {
                $map[mt_rand(0, 1) ? randomString() : mt_rand(-5, 5)] = randomValue($depth - 1);
            }
            // A property name that starts with U+0000 is refused (RQ-009): refused_values and stricter hold such names.
            if (mt_rand(0, 3) !== 0) return $map;
            return (object) array_filter($map, fn ($key) => !str_starts_with((string) $key, "\0"), ARRAY_FILTER_USE_KEY);
    }
}

function randomString(): string {
    $pieces = ['', 'a', '5', '-5', '05', '한', "\xff", "\0", '"', ';', "\u{1F600}", '}', 'key'];
    $text = '';
    for ($count = mt_rand(0, 3); $count > 0; $count--) $text .= $pieces[mt_rand(0, count($pieces) - 1)];
    return $text;
}

for ($index = 0; $index < 500; $index++) $cases[] = record("random_value_$index", serialize(randomValue(4)));

// The deepest arrays and objects that PHP reads, without a tree because the tree nests as deep.
$depth = 4096;
$deepest = str_repeat('a:1:{i:0;', $depth) . 'N;' . str_repeat('}', $depth);
$deepestObject = str_repeat('O:8:"stdClass":1:{s:1:"a";', $depth) . 'N;' . str_repeat('}', $depth);
$deepestEmpty = str_repeat('a:1:{i:0;', $depth) . 'a:0:{}' . str_repeat('}', $depth);
$deep = [record('deepest_array', $deepest, false), record('deepest_object', $deepestObject, false), record('deepest_with_empty', $deepestEmpty, false)];

$refused = [
    'empty' => '', 'garbage' => 'x', 'truncated_int' => 'i:1', 'no_semicolon' => 'i:1', 'empty_int' => 'i:;', 'space_int' => 'i: 1;',
    'bool_two' => 'b:2;', 'bool_word' => 'b:true;', 'null_value' => 'N', 'float_word' => 'd:abc;', 'float_inf_lower' => 'd:inf;', 'float_nan_lower' => 'd:nan;',
    'float_negative_nan' => 'd:-NAN;', 'float_plus_inf' => 'd:+INF;', 'string_short' => 's:5:"abc";', 'string_long' => 's:1:"abc";', 'string_no_quote' => 's:1:a;',
    'string_negative' => 's:-1:"";', 'escaped_bad_hex' => 'S:1:"\zz";', 'escaped_short' => 'S:2:"\6";', 'array_no_close' => 'a:1:{i:0;i:1;',
    'array_count_low' => 'a:0:{i:0;i:1;}', 'array_count_high' => 'a:2:{i:0;i:1;}', 'array_count_huge' => 'a:99999999:{}', 'array_negative' => 'a:-1:{}',
    'array_float_key' => 'a:1:{d:1;i:1;}', 'array_null_key' => 'a:1:{N;i:1;}', 'array_bool_key' => 'a:1:{b:1;i:1;}', 'array_array_key' => 'a:1:{a:0:{}i:1;}',
    'reference_zero' => 'a:1:{i:0;R:0;}', 'reference_missing' => 'R:1;', 'reference_past' => 'a:1:{i:0;R:9;}', 'object_ref_missing' => 'r:1;',
    'object_no_close' => 'O:8:"stdClass":1:{s:1:"a";i:1;', 'object_bad_name' => 'O:3:"std":0:{', 'object_too_deep' => str_repeat('a:1:{i:0;', $depth) . 'O:8:"stdClass":0:{}' . str_repeat('}', $depth), 'too_deep' => str_repeat('a:1:{i:0;', $depth + 1) . 'N;' . str_repeat('}', $depth + 1),
];
// The kind of each refusal (RQ-010): the first failure that a reader meets, reading from the start; the other ids are syntax.
$kinds = [
    'reference_zero' => 'reference', 'reference_missing' => 'reference', 'reference_past' => 'reference', 'object_ref_missing' => 'reference',
    'object_bad_name' => 'class', 'object_too_deep' => 'depth', 'too_deep' => 'depth',
];
function raises(string $kind): array {
    return ['kind' => $kind, 'status' => null, 'category' => 'value', 'message' => null];
}
$rejected = [];
foreach ($refused as $id => $bytes) {
    if (unserialize($bytes, ['allowed_classes' => ['stdClass']]) !== false) throw new RuntimeException("PHP reads the refused bytes of $id");
    $rejected[] = ['id' => $id, 'bytes' => base64_encode($bytes), 'raises' => raises($kinds[$id] ?? 'syntax')];
}

// Bytes that PHP reads but this package refuses on purpose, each with its reason.
$overflow = 'PHP wraps the integer and changes the value; PHP never writes it';
$hidden = 'PHP reads it without a warning into a property that no code outside the object reads and no other language holds (RQ-009)';
$strict = [
    ['trailing_data', 'i:1;i:2;', 'trailing_data', 'extra bytes mean a corrupt record; PHP only warns'],
    ['class_object', 'O:3:"Foo":0:{}', 'class', 'only stdClass is read, as unserialize with allowed_classes gives no other class; no other language holds the class'],
    ['enum', 'E:7:"Foo:Bar";', 'class', 'a case of an enum needs its class'],
    ['custom_object', 'C:3:"Foo":0:{}', 'class', 'the C: format needs its class'],
    ['reference_top_array', 'a:1:{i:0;R:1;}', 'top_array_reference', 'no serialize of PHP writes it, and what PHP writes back is not these bytes'],
    ['int_overflow_long', 'i:' . str_repeat('1', 5000) . ';', 'int_range', $overflow],
    ['int_overflow', 'i:9223372036854775808;', 'int_range', $overflow],
    ['property_nul', 'O:8:"stdClass":1:{s:2:"' . "\0a" . '";i:1;}', 'property_name', $hidden],
    ['property_nul_only', 'O:8:"stdClass":1:{s:1:"' . "\0" . '";i:1;}', 'property_name', $hidden],
    ['property_protected', 'O:8:"stdClass":1:{s:4:"' . "\0*\0c" . '";i:1;}', 'property_name', $hidden],
    ['property_private', 'O:8:"stdClass":1:{s:6:"' . "\0Foo\0d" . '";i:1;}', 'property_name', $hidden],
    ['property_escaped_nul', 'O:8:"stdClass":1:{S:2:"\\00a";i:1;}', 'property_name', $hidden],
    ['property_nul_overwritten', 'a:2:{i:0;O:8:"stdClass":1:{s:2:"' . "\0a" . '";N;}i:0;i:1;}', 'property_name', $hidden],
];
$stricter = [];
foreach ($strict as [$id, $bytes, $kind, $reason]) {
    // RQ-009 rests on PHP reading these names.
    if ($kind === 'property_name' && unserialize($bytes, ['allowed_classes' => ['stdClass']]) === false) throw new RuntimeException("PHP refuses the stricter bytes of $id");
    $stricter[] = ['id' => $id, 'bytes' => base64_encode($bytes), 'reason' => $reason, 'raises' => raises($kind)];
}

// Values that PHP holds and a value of the format refuses when it is built (RQ-009), with the bytes that PHP writes for them.
$unholdable = [
    'property_nul' => (object) ["\0a" => 1], 'property_protected' => (object) ["\0*\0c" => 1],
    'property_nul_nested' => ['x' => (object) ['a' => 1, "\0" => null]],
];
$refusedValues = [];
foreach ($unholdable as $id => $value) {
    $state = ['objects' => [], 'references' => []];
    $holder = [$value];
    $refusedValues[] = ['id' => $id, 'tree' => tree($holder[0], $state), 'written' => base64_encode(serialize($value)), 'raises' => raises('property_name')];
}

$php = ['version' => PHP_MAJOR_VERSION . '.' . PHP_MINOR_VERSION, 'serialize_precision' => -1];
echo json_encode(['php' => $php, 'cases' => $cases, 'deep' => $deep, 'forms' => $normal, 'rejected' => $rejected, 'stricter' => $stricter, 'refused_values' => $refusedValues],
    JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION, 4096), "\n";
`;

const run = spawnSync('php', ['-d', 'memory_limit=-1'], { input: generator, encoding: 'utf8', maxBuffer: 1 << 30 });
if (run.status !== 0) {
  console.error(run.stdout, run.stderr);
  process.exit(1);
}
if (process.argv.includes('--check')) {
  if (readFileSync(CONTRACT, 'utf8') !== run.stdout) {
    console.error(`${CONTRACT} differs from what PHP writes: run make contracts`);
    process.exit(1);
  }
  console.log(`${CONTRACT} equals what PHP writes`);
} else {
  writeFileSync(CONTRACT, run.stdout);
  console.log(`wrote ${CONTRACT}`);
}
