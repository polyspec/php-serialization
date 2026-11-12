// Requirements: RQ-001, RQ-002, RQ-003, RQ-004, RQ-006, RQ-007, RQ-009.
// The forms, the depth and the refusals of the contract, built values and large input.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PhpFloat, StdClass, UnserializeError, serialize, unserialize } from '../index.js';
import { newState, tree } from './tree.mjs';

const contract = JSON.parse(readFileSync(new URL('../../../contracts/php-serialize.json', import.meta.url), 'utf8'));
const bytesOf = (text) => new Uint8Array(Buffer.from(text, 'base64'));
const base64 = (bytes) => Buffer.from(bytes).toString('base64');

test('forms', { timeout: 10_000 }, () => {
  for (const entry of contract.forms) {
    const value = unserialize(bytesOf(entry.bytes));
    assert.deepEqual(tree(value, newState()), entry.tree, entry.id);
    assert.equal(base64(serialize(value)), entry.written, entry.id);
  }
});

test('deep', { timeout: 10_000 }, () => {
  for (const entry of contract.deep) {
    assert.equal(base64(serialize(unserialize(bytesOf(entry.bytes)))), entry.bytes, entry.id);
  }
});

test('refused', { timeout: 10_000 }, () => {
  for (const entry of [...contract.rejected, ...contract.stricter]) {
    assert.throws(() => unserialize(bytesOf(entry.bytes)), UnserializeError, entry.id);
  }
});

test('refused_property_names', { timeout: 10_000 }, () => {
  for (const name of ['\0a', '\0*\0c', new Uint8Array([0, 0xff])]) {
    assert.throws(() => serialize(new StdClass(new Map([[name, 1]]))), TypeError);
  }
  assert.equal(Buffer.from(serialize(new StdClass(new Map([['', 1]])))).toString('latin1'), 'O:8:"stdClass":1:{s:0:"";i:1;}');
});

test('built_values', { timeout: 10_000 }, () => {
  const text = (value) => Buffer.from(serialize(value)).toString('latin1');
  assert.equal(text(1), 'i:1;');
  assert.equal(text(new PhpFloat(1)), 'd:1;');
  assert.equal(text(1.5), 'd:1.5;');
  assert.equal(text(-0), 'd:-0;');
  assert.equal(text(2 ** 60), 'd:1.152921504606847E+18;');
  assert.equal(text(new Map([['5', 'a'], ['05', 'b']])), 'a:2:{i:5;s:1:"a";s:2:"05";s:1:"b";}');
  assert.equal(text([]), 'a:0:{}');
  assert.equal(text(new Map()), 'a:0:{}');
  const bytes = (value) => new TextEncoder().encode(value);
  assert.equal(text(new Map([[bytes('a'), 1], ['a', 2]])), 'a:1:{s:1:"a";i:2;}');
  assert.equal(text(new Map([[5n, 1], [5, 2]])), 'a:1:{i:5;i:2;}');
  assert.equal(text(new Map([[bytes('5'), 'a']])), 'a:1:{i:5;s:1:"a";}');
  assert.equal(text(new StdClass(new Map([[5, 'a']]))), 'O:8:"stdClass":1:{s:1:"5";s:1:"a";}');
  assert.equal(text(new StdClass(new Map([[5, 'a'], ['5', 'b']]))), 'O:8:"stdClass":1:{s:1:"5";s:1:"b";}');
  assert.equal(text(new StdClass(new Map([[bytes('a'), 1], ['a', 2]]))), 'O:8:"stdClass":1:{s:1:"a";i:2;}');
});

test('unrepresentable', { timeout: 10_000 }, () => {
  assert.throws(() => serialize('\ud800'), TypeError);
  assert.throws(() => serialize(new Map([['\ud800', 1]])), TypeError);
  assert.throws(() => serialize(undefined), TypeError);
  assert.throws(() => serialize({ a: 1 }), TypeError);
  assert.throws(() => serialize(2n ** 63n), RangeError);
  const cycle = [];
  cycle.push(cycle);
  assert.throws(() => serialize(cycle), RangeError);
  assert.throws(() => new PhpFloat('1.5'), TypeError);
  let deepest = new StdClass();
  for (let index = 0; index < 4096; index++) deepest = [deepest];
  assert.throws(() => serialize(deepest), RangeError);
  const input = Buffer.from('s:1:"\xff";', 'latin1');
  const value = unserialize(input);
  input[5] = 0x41;
  assert.equal(value[0], 0xff);
});

test('large_record', { timeout: 120_000 }, () => {
  const map = new Map();
  for (let index = 0; index < 200_000; index++) {
    map.set(`key-${index}`, index % 3 === 0 ? index : index % 3 === 1 ? new PhpFloat(index) : `값-${index}`);
  }
  map.set('blob', 'x'.repeat(32 * 1024 * 1024));
  const bytes = serialize(map);
  assert.deepEqual(serialize(unserialize(bytes)), bytes);
});
