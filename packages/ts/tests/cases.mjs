// The contract cases of php-serialization, run against one JavaScript binding: the Node package or its WASM subpath,
// which take and give the same values (the out rows of php_value in packages/rust/interface.json name the same forms
// for node and wasm). cases.test.mjs and cases.wasm.test.mjs import this module with their binding.
// PHP_SERIALIZATION_CONTRACTS is the path of contracts/, which make test-node and make test-wasm set.
//
// A value of the cases is {"kind", "value"} (binding G-5, docs/spec/php-serialize.md). The runner compares a value in
// one canonical form on both sides, the texts of its places in pre-order: a key is {"int": <decimal>} or {"hex":
// <bytes>}, an integer its decimal text, a float its text with -0 kept, bytes and texts their hex, a list the map of its
// items under the keys 0 to n-1, and a reference and an object numbered by their first place, which give their number
// alone at every later place. A case names a reference or an object again by its id alone, and gives n nested lists or
// objects as one with repeat (binding G-5). A reference and an object with an id are made empty at their first place
// and filled after, so that a later place inside their own value names them.
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

// The key of a pair on the stack of a canonical form, apart from the values, of which a repeated object has a key.
class Key {
  constructor(key) {
    this.key = key;
  }
}

// The canonical form of a value of the cases: the texts of its places in pre-order, depth first, which a loop writes
// because the values of deep nest 4096 levels (RQ-006), deeper than the stack of a recursion holds. A map, a list and
// an object give the number of their pairs, and each pair its key and then its value.
function canonicalCase(top) {
  const out = [];
  const stack = [top];
  const references = new Map();
  const objects = new Map();
  const pairs = (head, entries) => {
    out.push(`${head} ${entries.length}`);
    for (let i = entries.length - 1; i >= 0; i -= 1) stack.push(entries[i][1], new Key(entries[i][0]));
  };
  while (stack.length > 0) {
    const value = stack.pop();
    if (value instanceof Key) {
      out.push(`key ${JSON.stringify(value.key)}`);
      continue;
    }
    switch (value.kind) {
      case 'null':
        out.push('null');
        break;
      case 'bool':
        out.push(`bool ${String(value.value)}`);
        break;
      case 'int':
        out.push(`int ${String(value.value)}`);
        break;
      case 'float':
        out.push(`float ${floatText(value.value)}`);
        break;
      case 'bytes':
        out.push(`bytes ${value.value.hex}`);
        break;
      case 'text':
        out.push(`bytes ${hex(new TextEncoder().encode(value.value))}`);
        break;
      case 'list':
        if (value.repeat !== undefined) pairs('map', [[{ int: '0' }, value.repeat > 1 ? { ...value, repeat: value.repeat - 1 } : value.value]]);
        else pairs('map', value.value.map((item, i) => [{ int: String(i) }, item]));
        break;
      case 'map':
        pairs('map', value.value.map(([key, item]) => [caseKey(key), item]));
        break;
      case 'object': {
        if (value.value === undefined) {
          if (!objects.has(value.id)) throw new Error(`the object ${String(value.id)} has no first place`);
          out.push(`object again ${String(objects.get(value.id))}`);
          break;
        }
        const number = objects.size;
        objects.set(value.id ?? `place ${String(number)}`, number);
        if (value.repeat !== undefined) {
          const inner = value.repeat > 1 ? { kind: 'object', repeat: value.repeat - 1, key: value.key, value: value.value } : value.value;
          pairs(`object ${String(number)}`, [[caseKey(value.key), inner]]);
        } else {
          pairs(`object ${String(number)}`, value.value.map(([key, item]) => [caseKey(key), item]));
        }
        break;
      }
      case 'reference': {
        const { id, value: held } = value.value;
        if (references.has(id)) {
          if (held !== undefined) throw new Error(`the reference ${String(id)} gives its value again`);
          out.push(`reference again ${String(references.get(id))}`);
          break;
        }
        references.set(id, references.size);
        out.push(`reference ${String(references.get(id))}`);
        stack.push(held);
        break;
      }
      default:
        throw new Error(`a value of the kind ${String(value.kind)} has no form in the cases`);
    }
  }
  return out;
}

// The canonical form of a value that the binding gives, as canonicalCase writes it: a reference and an object are
// numbered by their identity at their first place.
function canonicalHost(lib, top) {
  const out = [];
  const stack = [{ host: top }];
  const references = new Map();
  const objects = new Map();
  const hostKey = (key) => (typeof key === 'number' || typeof key === 'bigint' ? { int: String(key) } : caseKey(typeof key === 'string' ? key : { hex: hex(key) }));
  const pairs = (head, entries) => {
    out.push(`${head} ${entries.length}`);
    for (let i = entries.length - 1; i >= 0; i -= 1) stack.push({ host: entries[i][1] }, new Key(hostKey(entries[i][0])));
  };
  while (stack.length > 0) {
    const place = stack.pop();
    if (place instanceof Key) {
      out.push(`key ${JSON.stringify(place.key)}`);
      continue;
    }
    const value = place.host;
    if (value === null) out.push('null');
    else if (typeof value === 'boolean') out.push(`bool ${String(value)}`);
    else if (typeof value === 'bigint') out.push(`int ${String(value)}`);
    else if (typeof value === 'number') out.push(Number.isSafeInteger(value) && !Object.is(value, -0) ? `int ${String(value)}` : `float ${floatText(value)}`);
    else if (typeof value === 'string') out.push(`bytes ${hex(new TextEncoder().encode(value))}`);
    else if (value instanceof Uint8Array) out.push(`bytes ${hex(value)}`);
    else if (value instanceof lib.PhpFloat) out.push(`float ${floatText(value.value)}`);
    else if (Array.isArray(value)) pairs('map', value.map((item, i) => [i, item]));
    else if (value instanceof Map) pairs('map', [...value]);
    else if (value instanceof lib.StdClass) {
      if (objects.has(value)) {
        out.push(`object again ${String(objects.get(value))}`);
      } else {
        objects.set(value, objects.size);
        pairs(`object ${String(objects.get(value))}`, [...value.properties]);
      }
    } else if (value instanceof lib.Reference) {
      if (references.has(value)) {
        out.push(`reference again ${String(references.get(value))}`);
      } else {
        references.set(value, references.size);
        out.push(`reference ${String(references.get(value))}`);
        stack.push({ host: value.value });
      }
    } else {
      throw new Error(`the binding gave a value that is no form of php_value: ${String(value)}`);
    }
  }
  return out;
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
function fromCase(lib, value, references = new Map(), objects = new Map()) {
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
      if (value.repeat === undefined) return value.value.map((item) => fromCase(lib, item, references, objects));
      let made = fromCase(lib, value.value, references, objects);
      for (let i = 0; i < value.repeat; i += 1) made = [made];
      return made;
    }
    case 'map':
      return new Map(value.value.map(([key, item]) => [hostKey(key), fromCase(lib, item, references, objects)]));
    case 'object': {
      if (value.value === undefined) {
        if (!objects.has(value.id)) throw new Error(`the object ${String(value.id)} has no first place`);
        return objects.get(value.id);
      }
      if (value.repeat !== undefined) {
        let made = fromCase(lib, value.value, references, objects);
        for (let i = 0; i < value.repeat; i += 1) made = new lib.StdClass(new Map([[hostKey(value.key), made]]));
        return made;
      }
      const object = new lib.StdClass(new Map());
      if (value.id !== undefined) objects.set(value.id, object);
      for (const [key, item] of value.value) object.properties.set(hostKey(key), fromCase(lib, item, references, objects));
      return object;
    }
    case 'reference': {
      if (references.has(value.value.id)) return references.get(value.value.id);
      const reference = new lib.Reference();
      references.set(value.value.id, reference);
      reference.value = fromCase(lib, value.value.value, references, objects);
      return reference;
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
