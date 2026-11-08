// Requirements: RQ-001, RQ-002, RQ-003, RQ-004, RQ-005, RQ-006.
// Checks the package against contracts/php-serialize.json, which real PHP writes (make contracts): each case is a top-level
// test named by its id.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { serialize, unserialize } from '../index.js';
import { newState, tree } from './tree.mjs';

const contract = JSON.parse(readFileSync(new URL('../../../contracts/php-serialize.json', import.meta.url), 'utf8'));
const bytesOf = (text) => new Uint8Array(Buffer.from(text, 'base64'));
const base64 = (bytes) => Buffer.from(bytes).toString('base64');

for (const entry of contract.cases) {
  test(entry.id, { timeout: 10_000 }, () => {
    const bytes = bytesOf(entry.bytes);
    const value = unserialize(bytes);
    assert.deepEqual(tree(value, newState()), entry.tree);
    assert.equal(base64(serialize(value)), entry.bytes);
  });
}
