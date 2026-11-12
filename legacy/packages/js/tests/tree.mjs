// The typed tree of a value, which the contract and the fuzz compare with the tree that PHP writes.
import { PhpFloat, Reference, StdClass } from '../index.js';

const base64 = (bytes) => Buffer.from(bytes).toString('base64');

function floatTree(number) {
  if (Number.isNaN(number)) return ['float', 'nan'];
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, number);
  return ['float', Buffer.from(view.buffer).toString('hex')];
}

function keyTree(key) {
  if (typeof key === 'string') return ['string', Buffer.from(key).toString('base64')];
  if (key instanceof Uint8Array) return ['string', base64(key)];
  return ['int', String(key)];
}

// The typed tree that the PHP generator writes, with references and objects numbered by first appearance.
export function tree(value, state) {
  if (value instanceof Reference) {
    const known = state.references.get(value);
    if (known !== undefined) return ['ref', known];
    state.references.set(value, state.references.size);
    const ordinal = state.references.get(value);
    return ['ref', ordinal, tree(value.value, state)];
  }
  if (value === null) return ['null'];
  if (typeof value === 'boolean') return ['bool', value];
  if (typeof value === 'bigint') return ['int', String(value)];
  if (typeof value === 'number') return Number.isSafeInteger(value) && !Object.is(value, -0) ? ['int', String(value)] : floatTree(value);
  if (value instanceof PhpFloat) return floatTree(value.value);
  if (typeof value === 'string') return ['string', Buffer.from(value).toString('base64')];
  if (value instanceof Uint8Array) return ['string', base64(value)];
  if (value instanceof StdClass) {
    const known = state.objects.get(value);
    if (known !== undefined) return ['object', known];
    state.objects.set(value, state.objects.size);
    const ordinal = state.objects.get(value);
    const pairs = [...value.properties].map(([key, item]) => [keyTree(key)[1], tree(item, state)]);
    return ['object', ordinal, 'stdClass', pairs];
  }
  const entries = Array.isArray(value) ? [...value.entries()] : [...value];
  return ['array', entries.map(([key, item]) => [keyTree(key), tree(item, state)])];
}

export const newState = () => ({ objects: new Map(), references: new Map() });
