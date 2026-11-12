// The directory of a fuzz run. A run removes it in its finally, which a killed process does not run, so its name holds the
// process id of the run and each run removes the directories of the runs whose process is gone.
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const LEFT = /^php-serialization-fuzz-(\d+)-/;

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
}

/** Removes what gone runs left under `root` and returns a new directory of this run. */
export function runDirectory(root: string): string {
  for (const name of readdirSync(root)) {
    const pid = LEFT.exec(name)?.[1];
    if (pid !== undefined && !isAlive(Number(pid))) rmSync(join(root, name), { recursive: true, force: true });
  }
  return mkdtempSync(join(root, `php-serialization-fuzz-${String(process.pid)}-`));
}
