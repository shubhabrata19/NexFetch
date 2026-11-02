import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsService } from '@main/services/settings-service'

const temporaryDirectories: string[] = []

function createFixture(): {
  directory: string
  settingsFile: string
  downloadDirectory: string
} {
  const directory = mkdtempSync(join(tmpdir(), 'nexfetch-settings-'))
  temporaryDirectories.push(directory)
  return {
    directory,
    settingsFile: join(directory, 'settings.json'),
    downloadDirectory: join(directory, 'downloads'),
  }
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop()
    if (directory) rmSync(directory, { recursive: true, force: true })
  }
})

describe('settings service', () => {
  it('writes defaults on first run and reloads them', () => {
    const fixture = createFixture()
    const service = new SettingsService({
      filePath: fixture.settingsFile,
      defaultDownloadDirectory: fixture.downloadDirectory,
    })

    expect(service.get()).toEqual({
      downloadDirectory: fixture.downloadDirectory,
      maxConcurrentDownloads: 2,
      concurrentFragments: 4,
      theme: 'system',
    })

    const raw = JSON.parse(readFileSync(fixture.settingsFile, 'utf8')) as unknown
    expect(raw).toEqual(service.get())

    const reloaded = new SettingsService({
      filePath: fixture.settingsFile,
      defaultDownloadDirectory: fixture.downloadDirectory,
    })
    expect(reloaded.get()).toEqual(service.get())
  })

  it('fills settings added in a later version without discarding existing values', () => {
    const fixture = createFixture()
    const customDirectory = join(fixture.directory, 'custom-downloads')
    writeFileSync(
      fixture.settingsFile,
      JSON.stringify({
        downloadDirectory: customDirectory,
        maxConcurrentDownloads: 3,
        theme: 'dark',
      }),
      'utf8',
    )

    const service = new SettingsService({
      filePath: fixture.settingsFile,
      defaultDownloadDirectory: fixture.downloadDirectory,
    })

    expect(service.get()).toEqual({
      downloadDirectory: customDirectory,
      maxConcurrentDownloads: 3,
      concurrentFragments: 4,
      theme: 'dark',
    })
  })

  it('updates and persists a patch', () => {
    const fixture = createFixture()
    const service = new SettingsService({
      filePath: fixture.settingsFile,
      defaultDownloadDirectory: fixture.downloadDirectory,
    })

    const updated = service.update({
      maxConcurrentDownloads: 4,
      concurrentFragments: 8,
      theme: 'dark',
    })

    expect(updated.maxConcurrentDownloads).toBe(4)
    expect(updated.concurrentFragments).toBe(8)
    expect(updated.theme).toBe('dark')

    const reloaded = new SettingsService({
      filePath: fixture.settingsFile,
      defaultDownloadDirectory: fixture.downloadDirectory,
    })
    expect(reloaded.get()).toEqual(updated)
  })

  it('rejects out-of-range settings', () => {
    const fixture = createFixture()
    const service = new SettingsService({
      filePath: fixture.settingsFile,
      defaultDownloadDirectory: fixture.downloadDirectory,
    })

    expect(() => service.update({ maxConcurrentDownloads: 99 })).toThrow()
    expect(() => service.update({ concurrentFragments: 0 })).toThrow()
    expect(() => service.update({ concurrentFragments: 17 })).toThrow()
  })

  it('recovers from a corrupt settings file', () => {
    const fixture = createFixture()
    writeFileSync(fixture.settingsFile, '{not json', 'utf8')

    const service = new SettingsService({
      filePath: fixture.settingsFile,
      defaultDownloadDirectory: fixture.downloadDirectory,
    })

    expect(service.get().theme).toBe('system')
    expect(service.get().maxConcurrentDownloads).toBe(2)
    expect(service.get().concurrentFragments).toBe(4)
  })
})
