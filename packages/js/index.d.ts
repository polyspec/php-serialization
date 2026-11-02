// The PHP serialize format, ported from ext/standard/var.c and var_unserializer.re of php-src (BSD-3-Clause).

/** The input is no serialized value; `offset` is the byte where reading stopped. */
export class UnserializeError extends Error {
  readonly offset: number;
}

/** A float of PHP whose value is an integer, such as 1.0, which a number of JavaScript cannot tell from the integer 1. */
export class PhpFloat {
  readonly value: number;
  constructor(value: number);
  valueOf(): number;
}

/** An object of the class stdClass. */
export class StdClass {
  readonly properties: Map<string | Uint8Array, Value>;
  constructor(properties?: Map<string | Uint8Array, Value>);
}

/** A PHP reference: the positions that hold one Reference hold one value, which serialize writes once and then as R:. */
export class Reference {
  value: Value;
  constructor(value?: Value);
}

export type ArrayKey = number | bigint | string | Uint8Array;
export type Value = null | boolean | number | bigint | PhpFloat | string | Uint8Array | Value[] | Map<ArrayKey, Value> | StdClass | Reference;

/**
 * Returns the bytes of php_var_serialize for a value. An object that appears again is written as r:<slot>;, a Reference
 * that appears again as R:<slot>;. A string that is not well-formed, whose bytes UTF-8 cannot hold, and a value nested
 * deeper than unserialize reads, a cycle among them, throw.
 */
export function serialize(value: Value): Uint8Array;

/**
 * Returns the value of the bytes that php_var_unserialize reads, and throws UnserializeError for other bytes, for extra
 * bytes after the value and for an object of a class other than stdClass. A string is a string, or a Uint8Array when its
 * bytes are not UTF-8; an array whose keys are 0 to n-1 in order is an Array and another array a Map; an integer outside
 * the safe integers of JavaScript is a bigint; a float whose value is an integer is a PhpFloat. Serializing the result
 * gives the same bytes.
 */
export function unserialize(data: Uint8Array): Value;
