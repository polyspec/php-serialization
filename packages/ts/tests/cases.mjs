// The contract cases of php-serialization, run against one JavaScript binding: the Node package or its WASM subpath,
// which take and give the same values (the out rows of php_value in packages/rust/interface.json name the same forms
// for node and wasm). cases.test.mjs and cases.wasm.test.mjs import this module with their binding.
// PHP_SERIALIZATION_CONTRACTS is the path of contracts/, which make test-node and make test-wasm set.
//
// A value of the cases is {"kind", "value"} (binding G-5, docs/spec/php-serialize.md). The runner compares a value in
// one canonical form on both sides: a key is {"int": <decimal>} or {"hex": <bytes>}, an integer its decimal text, a
// float its text with -0 kept, bytes and texts their hex, and a reference {"id", "value"} numbered by its first place.
// A case that arms fault injection points runs armed: the runner makes the value first, arms the faults for the
// member with the entry point __armFaults of the feature fault-test (binding GN-5, GN-8a), calls the member at once
// and requires __faultLeft to be empty after the expected failure.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const contracts = process.env.PHP_SERIALIZATION_CONTRACTS ?? '';
const read = (name) => JSON.parse(readFileSync(join(contracts, name), 'utf8'));

const hex = (bytes) => Buffer.from(bytes).toString('hex');
const fromHex = (text) => new Uint8Array(Buffer.from(text, 'hex'));
const base64 = (bytes) => Buffer.from(bytes).toString('base64');
const utf8 = (bytes) => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    if (error instanceof TypeError) return undefined;
    throw error;
  }
};

const floatText = (value) => {
  if (typeof value === 'object' && value !== null) return value.float;
  if (Number.isNaN(value)) return 'nan';
  if (value === Infinity) return 'inf';
  if (value === -Infinity) return '-inf';
  return Object.is(value, -0) ? '-0' : String(value);
};

// The canonical form of a key of the cases: a text, {"int": n} or {"hex": ...}.
const caseKey = (key) => {
  if (typeof key === 'string') return { hex: hex(new TextEncoder().encode(key)) };
  if ('int' in key) return { int: String(key.int) };
  return { hex: key.hex };
};

// The canonical form of a value of the cases.
function canonicalCase(value, ids = new Map()) {
  switch (value.kind) {
    case 'null':
      return { kind: 'null' };
    case 'bool':
      return { kind: 'bool', value: value.value };
    case 'int':
      return { kind: 'int', value: String(value.value) };
    case 'float':
      return { kind: 'float', value: floatText(value.value) };
    case 'bytes':
      return { kind: 'bytes', value: value.value.hex };
    case 'text':
      return { kind: 'bytes', value: hex(new TextEncoder().encode(value.value)) };
    case 'map':
    case 'object':
      return { kind: value.kind, value: value.value.map(([key, item]) => [caseKey(key), canonicalCase(item, ids)]) };
    case 'reference': {
      const seen = ids.has(value.value.id);
      if (!seen) ids.set(value.value.id, ids.size);
      const id = ids.get(value.value.id);
      return seen ? { kind: 'reference', value: { id } } : { kind: 'reference', value: { id, value: canonicalCase(value.value.value, ids) } };
    }
    default:
      throw new Error(`a value of the kind ${String(value.kind)} has no form in the cases`);
  }
}

// The canonical form of a value that the binding gives.
function canonicalHost(lib, value, ids = new Map()) {
  if (value === null) return { kind: 'null' };
  if (typeof value === 'boolean') return { kind: 'bool', value };
  if (typeof value === 'bigint') return { kind: 'int', value: String(value) };
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && !Object.is(value, -0) ? { kind: 'int', value: String(value) } : { kind: 'float', value: floatText(value) };
  }
  if (typeof value === 'string') return { kind: 'bytes', value: hex(new TextEncoder().encode(value)) };
  if (value instanceof Uint8Array) return { kind: 'bytes', value: hex(value) };
  if (value instanceof lib.PhpFloat) return { kind: 'float', value: floatText(value.value) };
  const hostKey = (key) => (typeof key === 'number' || typeof key === 'bigint' ? { int: String(key) } : caseKey(typeof key === 'string' ? key : { hex: hex(key) }));
  if (Array.isArray(value)) return { kind: 'map', value: value.map((item, i) => [{ int: String(i) }, canonicalHost(lib, item, ids)]) };
  if (value instanceof Map) return { kind: 'map', value: [...value].map(([key, item]) => [hostKey(key), canonicalHost(lib, item, ids)]) };
  if (value instanceof lib.StdClass) return { kind: 'object', value: [...value.properties].map(([key, item]) => [hostKey(key), canonicalHost(lib, item, ids)]) };
  if (value instanceof lib.Reference) {
    const seen = ids.has(value);
    if (!seen) ids.set(value, ids.size);
    const id = ids.get(value);
    return seen ? { kind: 'reference', value: { id } } : { kind: 'reference', value: { id, value: canonicalHost(lib, value.value, ids) } };
  }
  throw new Error(`the binding gave a value that is no form of php_value: ${String(value)}`);
}

// A key of the cases as the binding takes it: an integer, a text, or the bytes that are no text.
const hostKey = (key) => {
  if (typeof key === 'string') return key;
  if ('int' in key) return typeof key.int === 'string' ? BigInt(key.int) : key.int;
  return utf8(fromHex(key.hex)) ?? fromHex(key.hex);
};

// A host value of a language that is no value of PHP (docs/spec/php-serialize.md, contracts/host-values.json).
class Other {}
const others = { callable: () => () => null, date: () => new Date(0), object: () => new Other() };

// The value of the cases as the binding takes it (RQ-012): a float whose value is an integer is a PhpFloat.
function fromCase(lib, value, references = new Map()) {
  if ('host' in value) return others[value.host]();
  switch (value.kind) {
    case 'null':
      return null;
    case 'bool':
      return value.value;
    case 'int':
      return typeof value.value === 'string' ? BigInt(value.value) : value.value;
    case 'float': {
      const number = typeof value.value === 'object' ? { nan: NaN, inf: Infinity, '-inf': -Infinity }[value.value.float] : value.value;
      return Number.isInteger(number) || Object.is(number, -0) ? new lib.PhpFloat(number) : number;
    }
    case 'bytes':
      return fromHex(value.value.hex);
    case 'text':
      return value.value;
    // A list nested deeper than a JSON reader takes is {"kind": "list", "repeat": n, "value"} (binding G-5).
    case 'list': {
      if (value.repeat === undefined) return value.value.map((item) => fromCase(lib, item, references));
      let made = fromCase(lib, value.value, references);
      for (let i = 0; i < value.repeat; i += 1) made = [made];
      return made;
    }
    case 'map':
      return new Map(value.value.map(([key, item]) => [hostKey(key), fromCase(lib, item, references)]));
    case 'object':
      return new lib.StdClass(new Map(value.value.map(([key, item]) => [hostKey(key), fromCase(lib, item, references)])));
    case 'reference': {
      if (!references.has(value.value.id)) references.set(value.value.id, new lib.Reference(fromCase(lib, value.value.value, references)));
      return references.get(value.value.id);
    }
    default:
      throw new Error(`a value of the kind ${String(value.kind)} has no form in the cases`);
  }
}

function raises(lib, kase, call) {
  const category = kase.raises.category[0].toUpperCase() + kase.raises.category.slice(1);
  assert.throws(call, (error) =>
    error.constructor === lib[`PhpSerialization${category}Error`] &&
    error.kind === kase.raises.kind &&
    error.status === kase.raises.status &&
    (kase.raises.message === null || error.message === kase.raises.message), kase.id);
}

// Runs every group of the cases that packages/rust/interface.json links, against the binding lib; faults gives the
// object that holds __armFaults and __faultLeft of the binding (binding GN-5).
export function run(lib, faults) {
  const php = read('php-serialize.json');
  const host = read('host-values.json');

  test('unserialize', () => {
    let count = 0;
    for (const group of ['cases', 'forms', 'deep', 'rejected', 'stricter']) {
      assert.ok(php[group].length > 0, group);
      for (const kase of php[group]) {
        const call = () => lib.unserialize(fromHex(kase.data.hex));
        count += 1;
        if (kase.raises !== undefined) {
          raises(lib, kase, call);
          continue;
        }
        const result = call();
        if (kase.value !== undefined) assert.deepEqual(canonicalHost(lib, result), canonicalCase(kase.value), kase.id);
        assert.equal(base64(lib.serialize(result)), kase.written ?? kase.bytes, kase.id);
      }
    }
    assert.ok(count > 0);
  });

  test('serialize', async () => {
    let count = 0;
    for (const kase of [...php.cases, ...php.forms, ...php.refused_values, ...host.serialize, ...host.php_value]) {
      if (kase.value === undefined) continue;
      count += 1;
      if (kase.faults !== undefined) {
        const entries = await faults();
        const value = fromCase(lib, kase.value);
        const armed = entries.__armFaults('serialize', JSON.stringify(kase.faults));
        raises(lib, kase, () => lib.serialize(value));
        assert.deepEqual(entries.__faultLeft(armed), [], kase.id);
        continue;
      }
      const call = () => lib.serialize(fromCase(lib, kase.value));
      if (kase.raises !== undefined) {
        raises(lib, kase, call);
        continue;
      }
      const written = call();
      if ((kase.written ?? kase.bytes) !== undefined) assert.equal(base64(written), kase.written ?? kase.bytes, kase.id);
      assert.deepEqual(canonicalHost(lib, lib.unserialize(written)), canonicalCase(kase.value), kase.id);
    }
    assert.ok(count > 0);
  });

  test('PhpFloat', () => {
    for (const kase of [...host['php_float.constructor'], ...host['php_float.value']]) {
      assert.equal(floatText(new lib.PhpFloat(kase.value).value), floatText(kase.value), kase.id);
    }
    for (const kase of host['php_float.value_of']) {
      assert.equal(floatText(Number(new lib.PhpFloat(kase.value))), floatText(kase.value), kase.id);
    }
  });

  test('StdClass', () => {
    for (const kase of [...host['std_class.constructor'], ...host['std_class.properties']]) {
      const call = () => fromCase(lib, { kind: 'object', value: kase.properties });
      if (kase.raises !== undefined) {
        raises(lib, kase, call);
        continue;
      }
      assert.deepEqual(canonicalHost(lib, call()), canonicalCase({ kind: 'object', value: kase.properties }), kase.id);
    }
  });

  test('Reference', () => {
    for (const kase of [...host['reference.constructor'], ...host['reference.value']]) {
      const call = () => new lib.Reference(fromCase(lib, kase.value));
      if (kase.raises !== undefined) {
        raises(lib, kase, call);
        continue;
      }
      assert.deepEqual(canonicalHost(lib, call().value), canonicalCase(kase.value), kase.id);
    }
  });
}
