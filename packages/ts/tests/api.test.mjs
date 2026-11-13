// The tests of the legacy JavaScript package that the contract cases do not hold (api.mjs), against the installed Node
// package.
import * as lib from '@polyspec/php-serialization';
import { run } from './api.mjs';

run(lib);
