// The tests of the legacy JavaScript package that the contract cases do not hold (api.mjs), against the WASM binding of
// the installed package, its subpath ./wasm (binding P-5).
import * as lib from '@polyspec/php-serialization/wasm';
import { run } from './api.mjs';

run(lib);
