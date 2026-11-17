// The typed tree of a value that the binding gives, which the fuzz compares with the tree that PHP writes
// (scripts/php-tree.mts): references and objects are numbered by their first place.
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

/** The typed tree of `value`, a value of the binding `lib`; `state` holds the numbers of this tree (newState). */
export function tree(lib, value, state) {
  if (value instanceof lib.Reference) {
    const known = state.references.get(value);
    if (known !== undefined) return ['ref', known];
    const ordinal = state.references.size;
    state.references.set(value, ordinal);
    return ['ref', ordinal, tree(lib, value.value, state)];
  }
  if (value === null) return ['null'];
  if (typeof value === 'boolean') return ['bool', value];
  if (typeof value === 'bigint') return ['int', String(value)];
  if (typeof value === 'number') return Number.isSafeInteger(value) && !Object.is(value, -0) ? ['int', String(value)] : floatTree(value);
  if (value instanceof lib.PhpFloat) return floatTree(value.value);
  if (typeof value === 'string') return ['string', Buffer.from(value).toString('base64')];
  if (value instanceof Uint8Array) return ['string', base64(value)];
  if (value instanceof lib.StdClass) {
    const known = state.objects.get(value);
    if (known !== undefined) return ['object', known];
    const ordinal = state.objects.size;
    state.objects.set(value, ordinal);
    const pairs = [...value.properties].map(([key, item]) => [keyTree(key)[1], tree(lib, item, state)]);
    return ['object', ordinal, 'stdClass', pairs];
  }
  const entries = Array.isArray(value) ? [...value.entries()] : [...value];
  return ['array', entries.map(([key, item]) => [keyTree(key), tree(lib, item, state)])];
}

export const newState = () => ({ objects: new Map(), references: new Map() });
