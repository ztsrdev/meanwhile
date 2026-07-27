import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'

export function atomicWriteFile(
  path: string,
  contents: string | Buffer,
  mode?: number,
): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  )
  try {
    writeFileSync(temporary, contents)
    if (mode !== undefined) {
      chmodSync(temporary, mode)
    }
    renameSync(temporary, path)
  } finally {
    rmSync(temporary, { force: true })
  }
}
