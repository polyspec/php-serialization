// The probe of make fuzz: reads one base64 input per line from the file of its argument and writes one JSON line per input
// to the file of its second argument: {"refused":true}, or the typed tree and the bytes that the package writes back.
import { readFileSync, writeFileSync } from 'node:fs';
import { UnserializeError, serialize, unserialize } from '../index.js';
import { newState, tree } from './tree.mjs';

const lines = [];
for (const line of readFileSync(process.argv[2], 'utf8').split('\n')) {
  if (line === '' && lines.length > 0) continue;
  try {
    const value = unserialize(new Uint8Array(Buffer.from(line, 'base64')));
    lines.push(JSON.stringify({ tree: tree(value, newState()), written: Buffer.from(serialize(value)).toString('base64') }));
  } catch (error) {
    if (!(error instanceof UnserializeError)) lines.push(JSON.stringify({ crash: String(error) }));
    else lines.push('{"refused":true}');
  }
}
writeFileSync(process.argv[3], `${lines.join('\n')}\n`);
