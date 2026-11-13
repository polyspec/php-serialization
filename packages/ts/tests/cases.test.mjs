// The contract cases of php-serialization run against the installed Node package (cases.mjs). The entry points of the
// feature fault-test are in the addon of this platform (binding GN-5), the npm package that the package names in
// optionalDependencies.
import { createRequire } from 'node:module';
import * as lib from '@polyspec/php-serialization';
import { run } from './cases.mjs';

const require = createRequire(import.meta.url);
const platform = `${process.platform}-${process.arch}${process.platform === 'linux' ? '-gnu' : ''}`;

run(lib, () => Promise.resolve(require(`@polyspec/php-serialization-${platform}`)));
