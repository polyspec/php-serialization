// The tests of the legacy JavaScript package (legacy/packages/js/tests/api.test.mjs) that the contract cases do not
// hold, run against one JavaScript binding: the Node package or its WASM subpath. api.test.mjs and api.wasm.test.mjs
// import this module with their binding. The groups forms, deep, rejected and stricter of the legacy tests are the
// groups of contracts/php-serialize.json, which cases.mjs runs; this module holds the values that a JavaScript program
// builds (RQ-004, RQ-009, RQ-012), the values that the format refuses (RQ-003, RQ-006, RQ-009, RQ-012) and a large
// record, with the bytes of the legacy tests. A refusal is the class of its category and its kind (RQ-010): every kind
// of php-serialization is of the category value, so its class extends RangeError (binding E-2), and an argument of
// another type than the parameter is the TypeError of the binding.
import assert from 'node:assert/strict';
import test from 'node:test';

const latin1 = (bytes) => Buffer.from(bytes).toString('latin1');
const utf8 = (text) => new TextEncoder().encode(text);

function refuses(lib, call, kind, what) {
  assert.throws(call, (error) => error instanceof lib.PhpSerializationValueError && error instanceof RangeError && error.kind === kind, what);
}

export function run(lib) {
  const text = (value) => latin1(lib.serialize(value));

  test('refused_property_names', () => {
    for (const name of ['\0a', '\0*\0c', new Uint8Array([0, 0xff])]) {
      refuses(lib, () => lib.serialize(new lib.StdClass(new Map([[name, 1]]))), 'property_name', String(name));
    }
    assert.equal(text(new lib.StdClass(new Map([['', 1]]))), 'O:8:"stdClass":1:{s:0:"";i:1;}');
  });

  test('built_values', () => {
    const built = [
      [1, 'i:1;'],
      [new lib.PhpFloat(1), 'd:1;'],
      [1.5, 'd:1.5;'],
      [-0, 'd:-0;'],
      [2 ** 60, 'd:1.152921504606847E+18;'],
      [new Map([['5', 'a'], ['05', 'b']]), 'a:2:{i:5;s:1:"a";s:2:"05";s:1:"b";}'],
      [[], 'a:0:{}'],
      [new Map(), 'a:0:{}'],
      [new Map([[utf8('a'), 1], ['a', 2]]), 'a:1:{s:1:"a";i:2;}'],
      [new Map([[5n, 1], [5, 2]]), 'a:1:{i:5;i:2;}'],
      [new Map([[utf8('5'), 'a']]), 'a:1:{i:5;s:1:"a";}'],
      [new lib.StdClass(new Map([[5, 'a']])), 'O:8:"stdClass":1:{s:1:"5";s:1:"a";}'],
      [new lib.StdClass(new Map([[5, 'a'], ['5', 'b']])), 'O:8:"stdClass":1:{s:1:"5";s:1:"b";}'],
      [new lib.StdClass(new Map([[utf8('a'), 1], ['a', 2]])), 'O:8:"stdClass":1:{s:1:"a";i:2;}'],
    ];
    for (const [value, written] of built) assert.equal(text(value), written, written);
  });

  test('unrepresentable', () => {
    refuses(lib, () => lib.serialize('\ud800'), 'invalid_text', 'an unpaired surrogate');
    refuses(lib, () => lib.serialize(new Map([['\ud800', 1]])), 'invalid_text', 'an unpaired surrogate in a key');
    refuses(lib, () => lib.serialize(undefined), 'unsupported_value', 'undefined');
    refuses(lib, () => lib.serialize({ a: 1 }), 'unsupported_value', 'a plain object');
    refuses(lib, () => lib.serialize(2n ** 63n), 'int_range', 'an integer outside 64 bits');
    const cycle = [];
    cycle.push(cycle);
    refuses(lib, () => lib.serialize(cycle), 'unsupported_value', 'a list that holds itself');
    assert.throws(() => new lib.PhpFloat('1.5'), TypeError);
    let deepest = new lib.StdClass(new Map());
    for (let index = 0; index < 4096; index++) deepest = [deepest];
    refuses(lib, () => lib.serialize(deepest), 'depth', 'a value nested 4097 deep');
    // The value that unserialize gives holds its own bytes, not a view of the input.
    const input = Buffer.from('s:1:"\xff";', 'latin1');
    const value = lib.unserialize(input);
    input[5] = 0x41;
    assert.equal(value[0], 0xff);
  });

  test('large_record', () => {
    const map = new Map();
    for (let index = 0; index < 200_000; index++) {
      map.set(`key-${index}`, index % 3 === 0 ? index : index % 3 === 1 ? new lib.PhpFloat(index) : `값-${index}`);
    }
    map.set('blob', 'x'.repeat(32 * 1024 * 1024));
    const bytes = lib.serialize(map);
    assert.deepEqual(lib.serialize(lib.unserialize(bytes)), bytes);
  });
}
