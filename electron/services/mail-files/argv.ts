import { basename, isAbsolute } from 'node:path';

/** .eml and .msg files named on the command line ("Open with" on Windows and Linux). */
export function mailFilePathsInArgv(argv: readonly string[]): string[] {
  return argv.slice(1).filter((a) => typeof a === 'string' && isAbsolute(a) && !a.startsWith('-') && /\.(eml|msg)$/i.test(basename(a))).slice(0, 20);
}
