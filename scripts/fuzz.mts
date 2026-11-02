// Corrupts the bytes of the contract with a fixed seed and gives every input to real PHP and to both ports. A port must
// refuse what PHP refuses, read what PHP reads into the same typed tree, and write back the bytes that PHP writes. The
// deliberate refusals, which PHP names with a warning or an incomplete class, must be refused. Usage:
// node scripts/fuzz.mts [--count N] [--seed N]; the input and the output of the run stay in a directory of the run.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { PHP_TREE } from './php-tree.mts';

interface Reply {
  refused: boolean;
  unwritable: boolean;
  crash: string | undefined;
  deliberate: string | undefined;
  tree: unknown;
  written: string | undefined;
}

const textOf = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

function fieldsOf(value: unknown): Map<string, unknown> {
  if (typeof value !== 'object' || value === null) throw new Error('expected a JSON object');
  return new Map(Object.entries(value));
}

function replyOf(line: string): Reply {
  const fields = fieldsOf(JSON.parse(line));
  return {
    refused: fields.get('refused') === true,
    unwritable: fields.get('unwritable') === true,
    crash: textOf(fields.get('crash')),
    deliberate: textOf(fields.get('deliberate')),
    tree: fields.get('tree'),
    written: textOf(fields.get('written')),
  };
}

function seedBytes(list: unknown): Buffer[] {
  if (!Array.isArray(list)) throw new Error('expected a list of contract entries');
  return list.map((entry: unknown) => Buffer.from(textOf(fieldsOf(entry).get('bytes')) ?? '', 'base64'));
}

const { values } = parseArgs({ options: { count: { type: 'string', default: '200000' }, seed: { type: 'string', default: '20261103' } } });
const count = Number(values.count);
let state = Number(values.seed) >>> 0;

// mulberry32: the same seed gives the same inputs on every machine.
function random(limit: number): number {
  state = (state + 0x6d2b79f5) >>> 0;
  let mixed = state;
  mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
  mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
  return (((mixed ^ (mixed >>> 14)) >>> 0) % limit);
}

const contract = fieldsOf(JSON.parse(readFileSync('contracts/php-serialize.json', 'utf8')));
// The list of random floats is one long value of one kind, which the mutations of other seeds reach more often.
const FLOATS_PREFIX = 'a:6';
const seeds = [...seedBytes(contract.get('cases')), ...seedBytes(contract.get('forms'))].filter((bytes) => bytes.length < 100_000 || !bytes.toString('latin1').startsWith(FLOATS_PREFIX));
const TOKENS = ['i:', 'd:', 's:', 'S:', 'a:', 'O:', 'R:', 'r:', 'b:', 'N;', ';', ':', '{', '}', '"', '\\', '0', '1', '2', '-', '+', '.', 'e', 'E', 'NAN', 'INF', '-INF', 'R:1;', 'R:2;', 'R:3;', 'r:1;', 'r:2;', 'a:0:{}', 'a:1:{', 'O:8:"stdClass":', 's:1:"a";', 'i:0;', 'i:1;', 'i:-0;', 'i:05;', 's:1:"5";', 's:2:"05";', 's:1:"\0";', 's:3:"\0a\0";', 'd:1;', 'd:1e400;', '9223372036854775807', '9223372036854775808', '99999999999999999999', '0'.repeat(5000), '1'.repeat(5000)];

function mutate(input: Buffer): Buffer {
  let bytes = input;
  for (let round = 1 + random(3); round > 0; round--) {
    const at = random(bytes.length + 1);
    switch (random(6)) {
      case 0: {
        const copy = Buffer.from(bytes);
        if (at < copy.length) copy[at] = random(256);
        bytes = copy;
        break;
      }
      case 1:
        bytes = bytes.subarray(0, at);
        break;
      case 2:
        bytes = Buffer.concat([bytes.subarray(0, at), bytes.subarray(at + 1 + random(4))]);
        break;
      case 3:
        bytes = Buffer.concat([bytes.subarray(0, at), Buffer.from(TOKENS[random(TOKENS.length)] ?? '', 'latin1'), bytes.subarray(at)]);
        break;
      case 4: {
        const token = Buffer.from(TOKENS[random(TOKENS.length)] ?? '', 'latin1');
        bytes = Buffer.concat([bytes.subarray(0, at), token, bytes.subarray(at + token.length)]);
        break;
      }
      default: {
        const other = seeds[random(seeds.length)] ?? input;
        bytes = Buffer.concat([bytes.subarray(0, at), other.subarray(random(other.length + 1))]);
      }
    }
  }
  return bytes;
}

// A random text of the grammar with arbitrary slots, repeated keys and keys of every form, which reaches the paths that
// a corrupted input rarely reaches: references to elements, properties, overwritten keys and values still being read.
function grammarValue(depth: number): string {
  const text = (body: string): string => `s:${Buffer.byteLength(body, 'latin1')}:"${body}";`;
  const keys = ['0', '1', '2', '5', '-1', '05', '-0', 'a', 'b', '', '\0', '\0a\0b', '\0*\0c', '9223372036854775807', '9223372036854775808'];
  const key = (): string => (random(2) === 0 ? `i:${random(6) - 1};` : text(keys[random(keys.length)] ?? ''));
  const pairs = (): string => {
    const size = random(5);
    return `${size}:{${Array.from({ length: size }, () => key() + grammarValue(depth - 1)).join('')}}`;
  };
  switch (random(depth > 0 ? 12 : 7)) {
    case 0: return 'N;';
    case 1: return `b:${random(2)};`;
    case 2: return `i:${random(9) - 4};`;
    case 3: return ['d:1;', 'd:0.5;', 'd:-0;', 'd:NAN;', 'd:INF;', 'd:1.0E+25;', 'd:1e400;'][random(7)] ?? 'd:1;';
    case 4: return text(['', 'x', '5', '\xff', '\0'][random(5)] ?? '');
    case 5: return `R:${random(8)};`;
    case 6: return `r:${random(8)};`;
    case 7: case 8: case 9: return `a:${pairs()}`;
    default: return `O:8:"stdClass":${pairs()}`;
  }
}

const PHP_PROBE = String.raw`<?php
ini_set('serialize_precision', '-1');
ini_set('unserialize_max_depth', '4096');
${PHP_TREE}
// Scans the bytes outside every string for what the ports refuse on purpose although PHP reads it: an R: to a top array, which
// no serialize of PHP writes, and an object of another class, also when a repeated key has overwritten it.
// A length as parse_uiv reads it, which wraps at 64 bits; one that does not fit the rest of the bytes ends the scan.
function wrappedLength(string $digits): int {
    $high = 0;
    $low = 0;
    foreach (str_split($digits) as $digit) {
        $low = $low * 10 + (int) $digit;
        $high = ($high * 10 + ($low >> 32)) & 0xFFFFFFFF;
        $low &= 0xFFFFFFFF;
    }
    $length = ($high << 32) | $low;
    return $length < 0 ? PHP_INT_MAX >> 1 : min($length, PHP_INT_MAX >> 1);
}
function refusedOnPurpose(string $bytes, bool $topArray): ?string {
    $at = 0;
    $length = strlen($bytes);
    while ($at < $length) {
        if (preg_match('/\\Gs:(\\d+):"/', $bytes, $match, 0, $at)) $at += strlen($match[0]) + wrappedLength($match[1]) + 2;
        elseif (preg_match('/\\GS:(\\d+):"/', $bytes, $match, 0, $at)) {
            $at += strlen($match[0]);
            for ($count = wrappedLength($match[1]); $count > 0 && $at < $length; $count--) $at += $bytes[$at] === '\\\\' ? 3 : 1;
            $at += 2;
        } elseif ($topArray && preg_match('/\\GR:(\\d+);/', $bytes, $match, 0, $at) && wrappedLength($match[1]) === 1) return 'reference to the top array';
        elseif (preg_match('/\\GO:(\\d+):"/', $bytes, $match, 0, $at)) {
            $at += strlen($match[0]);
            if (strtolower(substr($bytes, $at, min(wrappedLength($match[1]), $length))) !== 'stdclass') return 'class';
            $at += wrappedLength($match[1]) + 1;
        } elseif (preg_match('/\\G[CE]:\\d+:"/', $bytes, $match, 0, $at)) return 'class';
        else $at++;
    }
    return null;
}
$warnings = [];
set_error_handler(function (int $level, string $message) use (&$warnings) { $warnings[] = $message; return true; });
$out = fopen($argv[2], 'w');
foreach (explode("\n", rtrim(file_get_contents($argv[1]), "\n")) as $line) {
    $bytes = base64_decode($line);
    $warnings = [];
    $reply = [];
    try {
        $value = unserialize($bytes, ['allowed_classes' => ['stdClass']]);
        if ($value === false && $bytes !== 'b:0;' && !preg_match('/^b:0;./s', $bytes)) $reply['refused'] = true;
        elseif (array_filter($warnings, fn ($w) => str_contains($w, 'Extra data'))) $reply['deliberate'] = 'extra data';
        elseif (($reason = refusedOnPurpose($bytes, is_array($value))) !== null) $reply['deliberate'] = $reason;
        elseif (array_filter($warnings, fn ($w) => str_contains($w, 'out of range'))) $reply['deliberate'] = 'integer out of range';
        else {
            $state = ['objects' => [], 'references' => [], 'limit' => 20000];
            $holder = [$value];
            $reply['tree'] = tree($holder[0], $state);
            if (isset($state['foreign'])) $reply = ['deliberate' => 'class'];
            else $reply['written'] = base64_encode(serialize($value));
        }
    } catch (Error | OverflowException $error) {
        // PHP read the bytes but cannot write them or walk them, as for an array that holds itself through its top value:
        // there is no result to compare, and a port only has to finish.
        $reply = ['unwritable' => true];
    }
    fwrite($out, json_encode($reply, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES, 200000) . "\n");
    fflush($out);
}
fclose($out);
`;

// A reference that one position alone holds is no reference to a reader, and PHP keeps some alive only because an overwritten
// value in a cycle was not collected. The comparison drops them and numbers the others again; the written bytes stay exact.
const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function withoutLoneReferences(tree: unknown): unknown {
  const seen = new Map<unknown, number>();
  const count = (node: unknown): void => {
    const [kind, first, second, third] = listOf(node);
    if (kind === 'ref') {
      seen.set(first, (seen.get(first) ?? 0) + 1);
      if (second !== undefined) count(second);
    } else if (kind === 'array') for (const pair of listOf(first)) count(listOf(pair)[1]);
    else if (kind === 'object') for (const pair of listOf(third)) count(listOf(pair)[1]);
  };
  count(tree);
  const ordinals = new Map<unknown, number>();
  const rebuild = (node: unknown): unknown => {
    const [kind, first, second, third] = listOf(node);
    const pairs = (list: unknown): unknown[] => listOf(list).map((pair) => [listOf(pair)[0], rebuild(listOf(pair)[1])]);
    if (kind === 'ref') {
      if (seen.get(first) === 1) return rebuild(second);
      if (!ordinals.has(first)) ordinals.set(first, ordinals.size);
      return second === undefined ? ['ref', ordinals.get(first)] : ['ref', ordinals.get(first), rebuild(second)];
    }
    if (kind === 'array') return ['array', pairs(first)];
    if (kind === 'object' && third !== undefined) return ['object', first, second, pairs(third)];
    return node;
  };
  return rebuild(tree);
}

// PHP writes an object at such a lone reference as R: where a port writes r:. Both name the same object, so only for a tree
// that holds a lone reference does the comparison take the two as one; every other byte stays exact.
function sameBytes(port: string, php: string, tree: unknown): boolean {
  if (port === php) return true;
  if (JSON.stringify(withoutLoneReferences(tree)) === JSON.stringify(tree)) return false;
  const common = (text: string): string => Buffer.from(text, 'base64').toString('latin1').replace(/R:(\d+);/g, 'r:$1;');
  return common(port) === common(php);
}

const directory = mkdtempSync(join(tmpdir(), 'php-serialize-fuzz-'));
try {
  const inputs: string[] = [];
  const unique = new Set<string>();
  while (inputs.length < count) {
    const grammar = Buffer.from(grammarValue(5), 'latin1');
    const text = (random(2) === 0 ? grammar : random(2) === 0 ? mutate(grammar) : mutate(seeds[random(seeds.length)] ?? Buffer.alloc(0))).toString('base64');
    if (text !== '' && !unique.has(text)) {
      unique.add(text);
      inputs.push(text);
    }
  }
  const inputFile = join(directory, 'inputs');
  writeFileSync(inputFile, `${inputs.join('\n')}\n`);
  console.log(`fuzz: ${count} inputs, seed ${values.seed}`);

  const runs: { name: string; command: string; args: string[]; cwd: string; input: string }[] = [
    { name: 'php', command: 'php', args: ['-d', 'memory_limit=-1', '--', inputFile, join(directory, 'php')], cwd: '.', input: PHP_PROBE },
    { name: 'node', command: process.execPath, args: ['packages/js/tests/probe.mjs', inputFile, join(directory, 'node')], cwd: '.', input: '' },
    { name: 'python', command: resolve('packages/python/.venv/bin/python'), args: ['-m', 'tests.probe', inputFile, join(directory, 'python')], cwd: 'packages/python', input: '' },
  ];
  const replies = new Map<string, Reply[]>();
  let failed = false;
  for (const run of runs) {
    const started = performance.now();
    const result = spawnSync(run.command, run.args, { cwd: run.cwd, input: run.input, encoding: 'utf8', maxBuffer: 1 << 28 });
    console.log(`fuzz: ${run.name} exit ${result.status} in ${Math.round(performance.now() - started)} ms`);
    if (result.status !== 0) {
      console.error(result.stdout, result.stderr);
      failed = true;
      continue;
    }
    replies.set(run.name, readFileSync(join(directory, run.name), 'utf8').trimEnd().split('\n').map(replyOf));
  }
  if (failed) process.exit(1);

  const tally: Record<string, number> = { php_refused: 0, php_read: 0, deliberate: 0, unwritable: 0 };
  const failures: string[] = [];
  for (const [index, input] of inputs.entries()) {
    const php = replies.get('php')?.[index];
    if (php === undefined) throw new Error(`php wrote no reply for input ${index}`);
    const key = php.refused ? 'php_refused' : php.deliberate !== undefined ? 'deliberate' : php.unwritable ? 'unwritable' : 'php_read';
    tally[key] = (tally[key] ?? 0) + 1;
    for (const name of ['node', 'python']) {
      const port = replies.get(name)?.[index];
      if (port === undefined) throw new Error(`${name} wrote no reply for input ${index}`);
      let problem: string | undefined;
      if (port.crash !== undefined) problem = `crash ${port.crash}`;
      else if (php.unwritable) continue;
      else if (php.refused || php.deliberate !== undefined) {
        if (!port.refused) problem = php.refused ? 'reads what PHP refuses' : `reads what is refused on purpose (${php.deliberate})`;
      } else if (port.refused) problem = 'refuses what PHP reads';
      else if (JSON.stringify(withoutLoneReferences(port.tree)) !== JSON.stringify(withoutLoneReferences(php.tree))) problem = 'reads another value';
      else if (!sameBytes(port.written ?? '', php.written ?? '', php.tree)) problem = 'writes other bytes';
      if (problem !== undefined) failures.push(`${name} ${problem}: ${Buffer.from(input, 'base64').toString('latin1').slice(0, 200)} [${input}]`);
    }
  }
  console.log(`fuzz: PHP refused ${tally.php_refused}, read ${tally.php_read}, refused on purpose ${tally.deliberate}, unwritable in PHP ${tally.unwritable}; ${failures.length} differences`);
  // The shortest inputs first: they show the cause.
  failures.sort((a, b) => a.length - b.length);
  for (const failure of failures.slice(0, 60)) console.error(JSON.stringify(failure));
  if (failures.length > 0) process.exit(1);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
