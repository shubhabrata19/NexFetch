#!/usr/bin/env node
/**
 * Validates resources/binaries.manifest.json and, when installed binaries are
 * present, verifies their SHA-256 hashes.
 *
 * Usage:
 *   node scripts/verify-binaries.mjs                # manifest + local files
 *   node scripts/verify-binaries.mjs --manifest-only
 *   node scripts/verify-binaries.mjs --require-installed
 */

import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = join(root, 'resources', 'binaries.manifest.json')
const platformKey = `${process.platform}-${process.arch}`
const args = new Set(process.argv.slice(2))
const manifestOnly = args.has('--manifest-only')
const requireInstalled = args.has('--require-installed')

const SHA256_PATTERN = /^[0-9a-f]{64}$/
const problems = []
const notes = []

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSafeRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024) return false
  if (value.includes('\0')) return false
  const normalized = value.replace(/\\/g, '/')
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) return false
  return normalized
    .split('/')
    .every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

function isSafeFileName(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 255 &&
    !value.includes('/') &&
    !value.includes('\\') &&
    value !== '.' &&
    value !== '..'
  )
}

function checkHttpsUrl(value, label) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') {
      problems.push(`${label}: URL must use HTTPS (${value}).`)
    }
    if (
      /\/releases\/download\/latest\//i.test(url.pathname) ||
      /\/releases\/latest\/download\//i.test(url.pathname)
    ) {
      problems.push(
        `${label}: URL must reference an immutable release tag, not a rolling "latest" tag (${value}).`,
      )
    }
  } catch {
    problems.push(`${label}: invalid URL (${String(value)}).`)
  }
}

function sha256File(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

let manifest
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
} catch (error) {
  console.error(`Cannot read ${manifestPath}: ${error instanceof Error ? error.message : error}`)
  process.exit(1)
}

if (!isRecord(manifest) || manifest.schemaVersion !== 1 || !isRecord(manifest.platforms)) {
  console.error('Manifest must be an object with schemaVersion 1 and a platforms object.')
  process.exit(1)
}

let artifactCount = 0
let pinnedCount = 0
let unpinnedCount = 0

for (const [platform, artifacts] of Object.entries(manifest.platforms)) {
  if (!/^[a-z0-9]+-[a-z0-9]+$/i.test(platform)) {
    problems.push(`platform "${platform}": expected a "<os>-<arch>" key.`)
    continue
  }
  if (!isRecord(artifacts)) {
    problems.push(`platform "${platform}": artifacts must be an object.`)
    continue
  }

  for (const [id, artifact] of Object.entries(artifacts)) {
    const label = `${platform}/${id}`
    artifactCount += 1

    if (!isRecord(artifact)) {
      problems.push(`${label}: artifact must be an object.`)
      continue
    }
    if (!isSafeFileName(artifact.file)) {
      problems.push(`${label}: file must be a plain file name.`)
    }

    if (artifact.sha256 === null) {
      unpinnedCount += 1
      if (typeof artifact.note !== 'string' || artifact.note.trim().length === 0) {
        problems.push(`${label}: unpinned artifacts must explain why in a note.`)
      }
    } else if (typeof artifact.sha256 !== 'string' || !SHA256_PATTERN.test(artifact.sha256)) {
      problems.push(`${label}: sha256 must be null or a lowercase 64-character hex digest.`)
    } else {
      pinnedCount += 1
    }

    if (artifact.url !== undefined) {
      checkHttpsUrl(artifact.url, `${label}.url`)
    }

    if (artifact.archive !== undefined) {
      if (!isRecord(artifact.archive)) {
        problems.push(`${label}: archive must be an object.`)
        continue
      }
      if (!isSafeFileName(artifact.archive.name)) {
        problems.push(`${label}: archive.name must be a plain file name.`)
      }
      checkHttpsUrl(artifact.archive.url, `${label}.archive.url`)
      if (
        typeof artifact.archive.sha256 !== 'string' ||
        !SHA256_PATTERN.test(artifact.archive.sha256)
      ) {
        problems.push(`${label}: archive.sha256 must be a lowercase 64-character hex digest.`)
      }
      if (!isSafeRelativePath(artifact.archive.member)) {
        problems.push(`${label}: archive.member must be a safe relative path.`)
      }
    } else if (artifact.sha256 !== null && artifact.url === undefined) {
      problems.push(`${label}: pinned artifacts need either a direct URL or an archive.`)
    }
  }
}

if (artifactCount === 0) {
  problems.push('Manifest contains no artifacts.')
}

if (!manifestOnly && problems.length === 0) {
  const platformArtifacts = manifest.platforms[platformKey]
  if (!isRecord(platformArtifacts) || Object.keys(platformArtifacts).length === 0) {
    notes.push(`No pinned artifacts for ${platformKey}; skipping installed-binary checks.`)
  } else {
    console.log(`Checking installed binaries for ${platformKey}...`)
    for (const [id, artifact] of Object.entries(platformArtifacts)) {
      if (!isRecord(artifact) || !isSafeFileName(artifact.file)) continue
      const path = join(root, 'resources', 'bin', platformKey, artifact.file)
      const displayPath = relative(root, path)

      if (!existsSync(path)) {
        const message = `${id}: not installed (${displayPath}). Run npm run fetch:win-binaries.`
        if (requireInstalled) problems.push(message)
        else notes.push(message)
        continue
      }

      const info = await stat(path)
      if (!info.isFile()) {
        problems.push(`${id}: ${displayPath} is not a file.`)
        continue
      }

      if (artifact.sha256 === null) {
        console.log(`  ${id}: locally built (not hash-pinned)`)
        continue
      }

      const actual = await sha256File(path)
      if (actual !== artifact.sha256) {
        problems.push(
          `${id}: SHA-256 mismatch for ${displayPath}. Expected ${artifact.sha256}, got ${actual}.`,
        )
      } else {
        console.log(`  ${id}: verified`)
      }
    }
  }
}

for (const note of notes) console.warn(`note: ${note}`)

if (problems.length > 0) {
  console.error('Binary verification failed:')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exitCode = 1
} else {
  console.log(
    `Binary manifest OK: ${artifactCount} artifact(s) across ${Object.keys(manifest.platforms).length} platform(s); ${pinnedCount} pinned, ${unpinnedCount} locally built.`,
  )
}
