import { randomUUID } from 'node:crypto'
import {
  chmod,
  mkdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { build } from 'esbuild'

const outfile = 'dist/awaitlingo.mjs'
await mkdir(dirname(outfile), { recursive: true })
const result = await build({
  entryPoints: ['src/cli.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  banner: { js: '#!/usr/bin/env node' },
  outfile,
  write: false,
  logLevel: 'info',
})
if (result.outputFiles.length !== 1) {
  throw new Error(`Expected one bundle output, received ${result.outputFiles.length}`)
}

const temporary = join(
  dirname(outfile),
  `.awaitlingo.mjs.${process.pid}.${randomUUID()}.tmp`,
)
try {
  await writeFile(temporary, result.outputFiles[0].contents, { mode: 0o755 })
  await chmod(temporary, 0o755)
  await rename(temporary, outfile)
} finally {
  await rm(temporary, { force: true })
}
