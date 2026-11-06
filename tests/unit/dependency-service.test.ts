import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DependencyService } from '@main/services/dependency-service'
import type { DependencyId } from '@shared/ipc/contracts'

const temporaryDirectories: string[] = []
const platformKey = `${process.platform}-${process.arch}`

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function binaryFileName(name: string): string {
  return process.platform === 'win32' ? `${name}.exe` : name
}

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'nexfetch-deps-'))
  temporaryDirectories.push(root)
  return root
}

function writeBinary(root: string, id: DependencyId, content: string): string {
  const name = id === 'torrent-helper' ? 'nexfetch-torrent-helper' : id
  const path = join(root, 'bin', platformKey, binaryFileName(name))
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
  chmodSync(path, 0o755)
  return path
}

function writeManifest(root: string, artifacts: Record<string, unknown>): void {
  writeFileSync(
    join(root, 'binaries.manifest.json'),
    JSON.stringify({ schemaVersion: 1, platforms: { [platformKey]: artifacts } }, null, 2),
  )
}

function createService(root: string): DependencyService {
  return new DependencyService({ bundledRoot: root, allowEnvOverrides: false })
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop()
    if (directory) rmSync(directory, { recursive: true, force: true })
  }
})

describe('dependency service integrity', () => {
  it('accepts a bundled binary whose SHA-256 matches the manifest', async () => {
    const root = createRoot()
    const content = 'pinned yt-dlp binary'
    const path = writeBinary(root, 'yt-dlp', content)
    writeManifest(root, {
      'yt-dlp': {
        file: binaryFileName('yt-dlp'),
        sha256: sha256(content),
      },
    })

    const service = createService(root)
    await service.verifyIntegrity()

    expect(service.resolveExecutable('yt-dlp')).toEqual({ path, source: 'bundled' })
  })

  it('refuses a bundled binary whose SHA-256 does not match the manifest', async () => {
    const root = createRoot()
    writeBinary(root, 'yt-dlp', 'tampered binary')
    writeManifest(root, {
      'yt-dlp': {
        file: binaryFileName('yt-dlp'),
        sha256: sha256('expected binary'),
      },
    })

    const service = createService(root)
    await service.verifyIntegrity()

    expect(service.resolveExecutable('yt-dlp')).toBeNull()
  })

  it('allows locally built binaries that are explicitly marked as unpinned', async () => {
    const root = createRoot()
    const content = 'locally built helper'
    const path = writeBinary(root, 'torrent-helper', content)
    writeManifest(root, {
      'torrent-helper': {
        file: binaryFileName('nexfetch-torrent-helper'),
        sha256: null,
        note: 'Built locally by PyInstaller.',
      },
    })

    const service = createService(root)
    await service.verifyIntegrity()

    expect(service.resolveExecutable('torrent-helper')).toEqual({
      path,
      source: 'bundled',
    })
  })

  it('keeps legacy presence-based resolution when no manifest is present', () => {
    const root = createRoot()
    const content = 'development binary'
    const path = writeBinary(root, 'ffmpeg', content)

    const service = createService(root)

    expect(service.resolveExecutable('ffmpeg')).toEqual({ path, source: 'bundled' })
  })

  it('re-verifies a repaired binary when integrity is rechecked', async () => {
    const root = createRoot()
    const expected = 'correct binary'
    const path = writeBinary(root, 'yt-dlp', 'tampered binary')
    writeManifest(root, {
      'yt-dlp': {
        file: binaryFileName('yt-dlp'),
        sha256: sha256(expected),
      },
    })

    const service = createService(root)
    await service.verifyIntegrity()
    expect(service.resolveExecutable('yt-dlp')).toBeNull()

    writeFileSync(path, expected)
    await service.recheckIntegrity()

    expect(service.resolveExecutable('yt-dlp')).toEqual({ path, source: 'bundled' })
  })
})
