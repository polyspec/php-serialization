// The contract cases of php-serialization run against the WASM binding of the installed package, its subpath ./wasm
// (binding P-5, cases.mjs).
import * as lib from '@polyspec/php-serialization/wasm';
import { run } from './cases.mjs';

run(lib);
