// The PHP serialize format, ported from ext/standard/var.c and ext/standard/var_unserializer.re of php-src at commit
// 39fa31b98ae25243ebf24779762bb285bc3085e4. Copyright © The PHP Group and Contributors. BSD-3-Clause; see LICENSE.
// Neither direction recurses, so the depth that PHP reads does not depend on the stack of the process.

const MAX_DEPTH = 4096;
const INT_MIN = -(2n ** 63n);
const INT_MAX = 2n ** 63n - 1n;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const latin1 = new TextDecoder('latin1');
const NUMERIC_KEY = /^(?:0|-?[1-9][0-9]*)$/;
const UINT = /^[0-9]+$/;
const INT = /^[+-]?[0-9]+$/;
// The count of an object, which php_var_unserialize reads with parse_iv2 and without the grammar: an empty count is 0.
const OBJECT_COUNT = /^[+-]?[0-9]*$/;
const FLOAT = /^(?:NAN|-?INF|[+-]?(?:[0-9]*\.[0-9]+|[0-9]+\.[0-9]*|[0-9]+)(?:[eE][+-]?[0-9]+)?)$/;
const HEX_PAIR = /^[0-9a-fA-F]{2}$/;

export class UnserializeError extends Error {
  constructor(message, offset) {
    super(`${message} at offset ${offset}`);
    this.name = 'UnserializeError';
    this.offset = offset;
  }
}

export class PhpFloat {
  constructor(value) {
    if (typeof value !== 'number') throw new TypeError('a PhpFloat holds a number');
    this.value = value;
  }

  valueOf() {
    return this.value;
  }
}

export class StdClass {
  constructor(properties = new Map()) {
    this.properties = properties;
  }
}

export class Reference {
  constructor(value = null) {
    this.value = value;
  }
}

function integerValue(number) {
  return number >= BigInt(Number.MIN_SAFE_INTEGER) && number <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(number) : number;
}

// Returns the text of UTF-8 bytes, or null for other bytes.
function decoded(bytes) {
  try {
    return decoder.decode(bytes);
  } catch (error) {
    if (error.code !== 'ERR_ENCODING_INVALID_ENCODED_DATA') throw error;
    return null;
  }
}

// Returns the key that a PHP array stores: a string in the canonical form of a 64-bit integer becomes that integer, and bytes
// that are UTF-8 name the same key as their text, because PHP has one string type.
function arrayKey(input) {
  const key = input instanceof Uint8Array ? (decoded(input) ?? input) : input;
  if (typeof key === 'bigint') return integerValue(key);
  // 20 characters hold every 64-bit integer with its sign.
  if (typeof key !== 'string' || key.length > 20 || !NUMERIC_KEY.test(key)) return key;
  const number = BigInt(key);
  if (number < INT_MIN || number > INT_MAX) return key;
  return integerValue(number);
}

// Returns the name of an object property, which is always a string in PHP.
function propertyName(key) {
  if (typeof key === 'number' || typeof key === 'bigint') return String(key);
  return key instanceof Uint8Array ? (decoded(key) ?? key) : key;
}

// Tells whether a property name, a string or bytes, starts with U+0000 (RQ-009).
function startsWithNul(name) {
  return typeof name === 'string' ? name.startsWith('\0') : name instanceof Uint8Array && name[0] === 0;
}

function floatText(value) {
  if (Number.isNaN(value)) return 'NAN';
  if (!Number.isFinite(value)) return value > 0 ? 'INF' : '-INF';
  if (value === 0) return Object.is(value, -0) ? '-0' : '0';
  const [mantissa, power] = Math.abs(value).toExponential().split('e');
  const digits = mantissa.replace('.', '');
  // The position of the decimal point after the first digits, as zend_dtoa returns it.
  const point = Number(power) + 1;
  const prefix = value < 0 ? '-' : '';
  if (point < -3 || point > 17) {
    const exponent = point - 1;
    return `${prefix}${digits[0]}.${digits.slice(1) || '0'}E${exponent >= 0 ? '+' : '-'}${Math.abs(exponent)}`;
  }
  if (point <= 0) return `${prefix}0.${'0'.repeat(-point)}${digits}`;
  if (digits.length <= point) return `${prefix}${digits}${'0'.repeat(point - digits.length)}`;
  return `${prefix}${digits.slice(0, point)}.${digits.slice(point)}`;
}

function encodeText(text) {
  if (!text.isWellFormed()) throw new TypeError('a string that is not well-formed has no bytes of UTF-8');
  return encoder.encode(text);
}

class Writer {
  // One growing buffer: a piece per token would hold more memory than the output itself.
  buffer = new Uint8Array(4096);
  size = 0;
  objects = new Map();
  references = new Map();
  counter = 0;
  stack = [];

  reserve(extra) {
    if (this.size + extra <= this.buffer.length) return;
    const grown = new Uint8Array(Math.max(this.buffer.length * 2, this.size + extra));
    grown.set(this.buffer.subarray(0, this.size));
    this.buffer = grown;
  }

  bytes(bytes) {
    this.reserve(bytes.length);
    this.buffer.set(bytes, this.size);
    this.size += bytes.length;
  }

  // The tokens of the format are ASCII, so a character is a byte.
  text(text) {
    this.reserve(text.length);
    const { buffer } = this;
    let at = this.size;
    for (let index = 0; index < text.length; index++) buffer[at++] = text.charCodeAt(index);
    this.size = at;
  }

  string(bytes) {
    this.text(`s:${bytes.length}:"`);
    this.bytes(bytes);
    this.text('";');
  }

  integer(number) {
    const big = BigInt(number);
    if (big < INT_MIN || big > INT_MAX) throw new RangeError(`${number} is outside the integers of PHP`);
    this.text(`i:${big};`);
  }

  key(key) {
    if (typeof key === 'string') this.string(encodeText(key));
    else if (key instanceof Uint8Array) this.string(key);
    else if (typeof key === 'bigint' || Number.isSafeInteger(key)) this.integer(key);
    else throw new TypeError('an array key is an integer, a string or a Uint8Array');
  }

  push(entries, size, isObject = false) {
    // unserialize checks the depth of every object, but only of an array that holds elements.
    if ((size > 0 || isObject) && this.stack.length >= MAX_DEPTH) throw new RangeError('the value is nested deeper than unserialize reads');
    if (size === 0) {
      this.text('}');
      return;
    }
    this.stack.push(entries[Symbol.iterator]());
  }

  value(input) {
    const isReference = input instanceof Reference;
    const value = isReference ? input.value : input;
    // A reference to an object counts as the object, as php_add_var_hash treats it.
    const isObject = value instanceof StdClass;
    if (isReference || isObject) {
      const table = isObject ? this.objects : this.references;
      const known = table.get(isObject ? value : input);
      if (known !== undefined) {
        if (isReference) this.text(`R:${known};`);
        else {
          this.counter++;
          this.text(`r:${known};`);
        }
        return;
      }
      table.set(isObject ? value : input, this.counter + 1);
    }
    this.counter++;
    if (value === null) this.text('N;');
    else if (typeof value === 'boolean') this.text(value ? 'b:1;' : 'b:0;');
    else if (typeof value === 'bigint') this.integer(value);
    else if (typeof value === 'number') {
      if (Number.isSafeInteger(value) && !Object.is(value, -0)) this.integer(value);
      else this.text(`d:${floatText(value)};`);
    } else if (value instanceof PhpFloat) this.text(`d:${floatText(value.value)};`);
    else if (typeof value === 'string') this.string(encodeText(value));
    else if (value instanceof Uint8Array) this.string(value);
    else if (Array.isArray(value)) {
      this.text(`a:${value.length}:{`);
      this.push(value.entries(), value.length);
    } else if (value instanceof Map) {
      const normal = new KeyedMap();
      for (const [key, item] of value) normal.set(arrayKey(key), item);
      this.text(`a:${normal.size}:{`);
      this.push(normal.map, normal.size);
    } else if (value instanceof StdClass) {
      const normal = new KeyedMap();
      for (const [key, item] of value.properties) {
        const name = propertyName(key);
        // RQ-009: a property name that starts with U+0000 is never written.
        if (startsWithNul(name)) throw new TypeError('a property name starts with U+0000');
        normal.set(name, item);
      }
      this.text(`O:8:"stdClass":${normal.size}:{`);
      this.push(normal.map, normal.size, true);
    } else throw new TypeError(`${typeof value} has no serialized form`);
  }

  run(root) {
    this.value(root);
    while (this.stack.length > 0) {
      const next = this.stack.at(-1).next();
      if (next.done) {
        this.stack.pop();
        this.text('}');
      } else {
        this.key(next.value[0]);
        this.value(next.value[1]);
      }
    }
    return this.buffer.slice(0, this.size);
  }
}

export function serialize(value) {
  return new Writer().run(value);
}

// A Map whose Uint8Array keys are equal by their bytes, as the string keys of a PHP array are: a key that repeats overwrites
// in its first position, and the first array of bytes stays the key.
class KeyedMap {
  map = new Map();
  binary = new Map();

  resolve(key) {
    if (!(key instanceof Uint8Array)) return key;
    const text = latin1.decode(key);
    const known = this.binary.get(text);
    if (known !== undefined) return known;
    this.binary.set(text, key);
    return key;
  }

  set(key, value) {
    this.map.set(this.resolve(key), value);
  }

  get size() {
    return this.map.size;
  }
}

const COLON = 0x3a;
const SEMICOLON = 0x3b;
const BACKSLASH = 0x5c;

class Reader {
  at = 0;
  slots = [];
  stack = [];
  top = null;

  constructor(data) {
    this.data = data;
  }

  fail(message, at = this.at) {
    return new UnserializeError(message, at);
  }

  startsWith(text) {
    for (let index = 0; index < text.length; index++) {
      if (this.data[this.at + index] !== text.charCodeAt(index)) return false;
    }
    return true;
  }

  expect(text) {
    if (!this.startsWith(text)) throw this.fail(`expected ${text}`);
    this.at += text.length;
  }

  // Reads the text up to the next colon or semicolon and returns it when the pattern matches all of it.
  match(pattern) {
    let end = this.at;
    while (end < this.data.length && this.data[end] !== COLON && this.data[end] !== SEMICOLON) end++;
    const text = latin1.decode(this.data.subarray(this.at, end));
    if (!pattern.test(text)) throw this.fail('expected a number');
    this.at = end;
    return text;
  }

  // Reads a length or a slot as parse_uiv does, which wraps at 64 bits.
  wrapped() {
    if (this.data[this.at] !== 0x2b && this.data[this.at] !== 0x2d) {
      const short = this.shortNumber();
      if (short !== null) return short;
    }
    return Number(BigInt.asUintN(64, BigInt(this.match(UINT))));
  }

  rawString() {
    const length = this.wrapped();
    this.expect(':"');
    if (length > this.data.length - this.at) throw this.fail('the string exceeds the input');
    const bytes = this.data.subarray(this.at, this.at + length);
    this.at += length;
    this.expect('"');
    return bytes;
  }

  // Reads the bytes of S:, where \xx is the byte of two hexadecimal digits.
  escapedString() {
    const length = this.wrapped();
    this.expect(':"');
    if (length > this.data.length - this.at) throw this.fail('the string exceeds the input');
    const bytes = new Uint8Array(length);
    for (let index = 0; index < length; index++) {
      if (this.at >= this.data.length) throw this.fail('the string exceeds the input');
      if (this.data[this.at] === BACKSLASH) {
        const pair = latin1.decode(this.data.subarray(this.at + 1, this.at + 3));
        if (!HEX_PAIR.test(pair)) throw this.fail('expected two hexadecimal digits');
        bytes[index] = Number.parseInt(pair, 16);
        this.at += 3;
      } else {
        bytes[index] = this.data[this.at];
        this.at++;
      }
    }
    this.expect('"');
    return bytes;
  }

  // An array of its own, because the slice of a Buffer is a view of the input.
  text(bytes) {
    return decoded(bytes) ?? new Uint8Array(bytes);
  }

  // A number of up to 15 digits is the common case and needs neither a text nor a BigInt.
  shortNumber() {
    const { data } = this;
    let at = this.at;
    const negative = data[at] === 0x2d;
    if (negative || data[at] === 0x2b) at++;
    const start = at;
    let number = 0;
    while (at < data.length && data[at] >= 0x30 && data[at] <= 0x39 && at - start < 16) number = number * 10 + data[at++] - 0x30;
    if (at === start || at - start > 15) return null;
    this.at = at;
    return negative ? 0 - number : number;
  }

  integer() {
    const short = this.shortNumber();
    if (short !== null) return short === 0 ? 0 : short;
    const text = this.match(INT);
    // A number longer than 64 bits never reaches BigInt, whose cost grows with its length.
    if (text.replace(/^[+-]?0*/, '').length > 19) throw this.fail('the integer is out of range');
    const number = BigInt(text);
    if (number < INT_MIN || number > INT_MAX) throw this.fail('the integer is out of range');
    return integerValue(number);
  }

  key() {
    if (this.startsWith('i:')) {
      this.at += 2;
      const number = this.integer();
      this.expect(';');
      return number;
    }
    let bytes;
    if (this.startsWith('s:')) {
      this.at += 2;
      bytes = this.rawString();
    } else if (this.startsWith('S:')) {
      this.at += 2;
      bytes = this.escapedString();
    } else throw this.fail('an array key is an integer or a string');
    this.expect(';');
    return this.text(bytes);
  }

  // Reads the count and the brace; PHP refuses more elements than bytes remain, and checks the depth of every object but
  // only of an array that holds elements.
  open(items, isObject) {
    const text = this.match(isObject ? OBJECT_COUNT : UINT);
    const digits = text.replace(/^[+-]?0*/, '');
    const count = digits === '' ? 0 : digits.length > 19 ? Infinity : Number(text);
    if (count < 0 || count > this.data.length - this.at) throw this.fail('the count exceeds the remaining input');
    this.expect(':{');
    if ((count > 0 || isObject) && this.stack.length >= MAX_DEPTH) throw this.fail('the maximum depth is exceeded');
    this.stack.push({ items, remaining: count, isObject, key: null });
  }

  namedSlot(at) {
    this.at += 2;
    const number = this.wrapped();
    this.expect(';');
    if (number < 1 || number > this.slots.length) throw this.fail('the reference names no value', at);
    return this.slots[number - 1];
  }

  // Reads one value into the position of the frame, and opens a new frame for an array or an object.
  readValue(frame) {
    const at = this.at;
    const { items, key } = frame;
    if (this.startsWith('R:')) {
      const slot = this.namedSlot(at);
      if (slot.items === items && slot.key === key) throw this.fail('the reference names its own position', at);
      let found = slot.items.map.get(slot.key);
      // PHP reads this, but its serialize never writes it, and what it writes back is not these bytes: the array unrolled or
      // null in its place. Refusing keeps the data from changing silently.
      if (slot.items === this.top && (found instanceof Reference ? found.value : found) instanceof KeyedMap) throw this.fail('the reference names the top array', at);
      if (!(found instanceof Reference)) {
        found = new Reference(found);
        slot.items.map.set(slot.key, found);
      }
      items.map.set(key, found);
      return;
    }
    this.slots.push({ items, key });
    if (this.startsWith('r:')) {
      const slot = this.namedSlot(at);
      let found = slot.items.map.get(slot.key);
      if (found instanceof Reference) found = found.value;
      if (!(found instanceof StdClass)) throw this.fail('r: names no object', at);
      items.map.set(key, found);
    } else if (this.startsWith('N;')) {
      this.at += 2;
      items.map.set(key, null);
    } else if (this.startsWith('b:0;') || this.startsWith('b:1;')) {
      items.map.set(key, this.data[at + 2] === 0x31);
      this.at += 4;
    } else if (this.startsWith('i:')) {
      this.at += 2;
      const number = this.integer();
      this.expect(';');
      items.map.set(key, number);
    } else if (this.startsWith('d:')) {
      this.at += 2;
      const text = this.match(FLOAT);
      this.expect(';');
      const number = text === 'NAN' ? Number.NaN : text === 'INF' ? Infinity : text === '-INF' ? -Infinity : Number(text);
      items.map.set(key, Number.isInteger(number) ? new PhpFloat(number) : number);
    } else if (this.startsWith('s:') || this.startsWith('S:')) {
      const escaped = this.data[at] === 0x53;
      this.at += 2;
      const bytes = escaped ? this.escapedString() : this.rawString();
      this.expect(';');
      items.map.set(key, this.text(bytes));
    } else if (this.startsWith('a:')) {
      this.at += 2;
      const array = new KeyedMap();
      items.map.set(key, array);
      this.open(array, false);
    } else if (this.startsWith('O:')) {
      this.at += 2;
      const name = this.rawString();
      if (latin1.decode(name).toLowerCase() !== 'stdclass') throw this.fail('only objects of stdClass are read', at);
      this.expect(':');
      const target = new StdClass();
      items.map.set(key, target);
      const properties = new KeyedMap();
      properties.map = target.properties;
      this.open(properties, true);
    } else throw this.fail('no serialized value', at);
  }

  read() {
    const root = { items: new KeyedMap(), remaining: 0, isObject: false, key: null };
    this.top = root.items;
    this.readValue(root);
    while (this.stack.length > 0) {
      const frame = this.stack.at(-1);
      if (frame.remaining === 0) {
        this.expect('}');
        this.stack.pop();
        continue;
      }
      frame.remaining--;
      const keyAt = this.at;
      const key = this.key();
      // RQ-009: a property name that starts with U+0000 is refused, also when a repeated key overwrites the object later.
      if (frame.isObject && startsWithNul(key)) throw this.fail('a property name starts with U+0000', keyAt);
      // A property name is always a string: PHP converts an integer key of an object.
      const normal = frame.isObject ? (typeof key === 'number' || typeof key === 'bigint' ? String(key) : key) : arrayKey(key);
      frame.key = frame.items.resolve(normal);
      // A key that repeats keeps its first position and starts empty.
      frame.items.map.set(frame.key, null);
      this.readValue(frame);
    }
    return root.items.map.get(null);
  }
}

// Turns the arrays whose keys are 0 to n-1 into Arrays and the others into Maps, and a Reference that one position alone
// still holds into its value, as PHP holds it. The top value is never a reference: unserialize returns the value itself.
function finish(input) {
  const root = input instanceof Reference ? input.value : input;
  const holders = new Map();
  const containers = new Set();
  const pending = [root];
  while (pending.length > 0) {
    const item = pending.pop();
    if (item instanceof Reference) {
      const count = holders.get(item) ?? 0;
      holders.set(item, count + 1);
      if (count === 0) pending.push(item.value);
    } else if ((item instanceof KeyedMap || item instanceof StdClass) && !containers.has(item)) {
      containers.add(item);
      for (const value of (item instanceof StdClass ? item.properties : item.map).values()) pending.push(value);
    }
  }
  const finals = new Map();
  for (const item of containers) {
    if (!(item instanceof KeyedMap)) continue;
    let position = 0;
    let isList = true;
    for (const key of item.map.keys()) {
      if (key !== position) {
        isList = false;
        break;
      }
      position++;
    }
    finals.set(item, isList ? [] : item.map);
  }
  const final = (value) => {
    let result = value;
    if (result instanceof Reference) {
      if (holders.get(result) > 1) return result;
      result = result.value;
    }
    return result instanceof KeyedMap ? finals.get(result) : result;
  };
  for (const [reference, count] of holders) {
    if (count > 1) reference.value = final(reference.value);
  }
  for (const item of containers) {
    const map = item instanceof StdClass ? item.properties : item.map;
    const target = item instanceof KeyedMap ? finals.get(item) : map;
    if (Array.isArray(target)) {
      for (const value of map.values()) target.push(final(value));
    } else {
      for (const [key, value] of map) map.set(key, final(value));
    }
  }
  return final(root);
}

export function unserialize(data) {
  const reader = new Reader(data);
  try {
    const result = reader.read();
    if (reader.at !== data.length) throw reader.fail('extra data after the value');
    return finish(result);
  } catch (error) {
    // A Map holds 2^24 entries and a string about 2^29 characters: past them the runtime cannot hold the value.
    if (error instanceof RangeError || error.code === 'ERR_STRING_TOO_LONG') throw reader.fail(`the value exceeds what the runtime holds: ${error.message}`);
    throw error;
  }
}
