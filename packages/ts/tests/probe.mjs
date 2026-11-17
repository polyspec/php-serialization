// The probe of make fuzz for the Node binding: reads one base64 input per line from the file of its argument and writes
// one JSON line per input to the file of its second argument: {"refused":true} when the binding refuses the input as a
// value error of the library, or the typed tree and the bytes that the binding writes back. Every other failure, of
// reading or of writing back, is a crash, the finding that the fuzz reports.
import { readFileSync, writeFileSync } from 'node:fs';
import * as lib from '@polyspec/php-serialization';
import { newState, tree } from './tree.mjs';

const lines = [];
for (const line of readFileSync(process.argv[2], 'utf8').split('\n')) {
  if (line === '' && lines.length > 0) continue;
  let value;
  try {
    value = lib.unserialize(new Uint8Array(Buffer.from(line, 'base64')));
  } catch (error) {
    lines.push(error instanceof lib.PhpSerializationValueError ? '{"refused":true}' : JSON.stringify({ crash: String(error) }));
    continue;
  }
  try {
    lines.push(JSON.stringify({ tree: tree(lib, value, newState()), written: Buffer.from(lib.serialize(value)).toString('base64') }));
  } catch (error) {
    lines.push(JSON.stringify({ crash: String(error) }));
  }
}
writeFileSync(process.argv[3], `${lines.join('\n')}\n`);
