#!/usr/bin/env node
/**
 * Writes a sha256sum-compatible SHA256SUMS.txt for the distributable files in a
 * release directory. Subdirectories (including win-unpacked) are not hashed.
 *
 * Usage:
 *   node scripts/write-release-checksums.mjs release/v0.5.0-polish
 */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const CHECKSUMS_FILE = 'SHA256SUMS.txt'
const BUILD_METADATA_FILES = new Set([
  'builder-debug.yml',
  'builder-effective-config.yaml',
  'latest.yml',
  'latest-mac.yml',
  'latest-linux.yml',
])
const directory = resolve(process.argv[2] ?? 'release')

let info
try {
  info = await stat(directory)
} catch {
  console.error(`Release directory not found: ${directory}`)
  process.exit(1)
}
if (!info.isDirectory()) {
  console.error(`Not a directory: ${directory}`)
  process.exit(1)
}

function sha256File(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolveHash(hash.digest('hex')))
  })
}

const entries = await readdir(directory, { withFileTypes: true })
const files = entries
  .filter(
    (entry) =>
      entry.isFile() && entry.name !== CHECKSUMS_FILE && !BUILD_METADATA_FILES.has(entry.name),
  )
  .map((entry) => entry.name)
  .sort((a, b) => a.localeCompare(b))

if (files.length === 0) {
  console.error(`No distributable files found in ${directory}`)
  process.exit(1)
}

const lines = []
for (const name of files) {
  const digest = await sha256File(join(directory, name))
  lines.push(`${digest}  ${name}`)
}

await writeFile(join(directory, CHECKSUMS_FILE), `${lines.join('\n')}\n`, 'utf8')
console.log(`Wrote ${CHECKSUMS_FILE} for ${files.length} file(s) in ${directory}`)
for (const line of lines) console.log(`  ${line}`)
