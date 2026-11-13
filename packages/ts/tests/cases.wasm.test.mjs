// The contract cases of php-serialization run against the WASM binding of the installed package, its subpath ./wasm
// (binding P-5, cases.mjs). The entry points of the feature fault-test are in the glue of the module, which
// wasm-bindgen writes beside the entry (binding GN-5).
import * as lib from '@polyspec/php-serialization/wasm';
import { run } from './cases.mjs';

run(lib, () => import(new URL('./php_serialization_wasm.js', import.meta.resolve('@polyspec/php-serialization/wasm')).href));
