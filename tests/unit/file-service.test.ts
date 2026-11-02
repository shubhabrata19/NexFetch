import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileService, isPathInside } from '@main/services/file-service'

const temporaryDirectories: string[] = []

function createFixture(): { destination: string; workspace: string; service: FileService } {
  const destination = mkdtempSync(join(tmpdir(), 'nexfetch-files-'))
  temporaryDirectories.push(destination)
  const workspace = join(destination, '.nexfetch-tmp', 'job-1')
  mkdirSync(workspace, { recursive: true })
  return { destination, workspace, service: new FileService() }
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop()
    if (directory) rmSync(directory, { recursive: true, force: true })
  }
})

describe('file service', () => {
  it('recognizes paths inside the destination and rejects siblings', () => {
    const root = join(tmpdir(), 'nexfetch-root')
    expect(isPathInside(root, join(root, 'a', 'b'))).toBe(true)
    expect(isPathInside(root, join(root, '..', 'outside'))).toBe(false)
    expect(isPathInside(root, join(tmpdir(), 'other'))).toBe(false)
  })

  it('validates and creates the destination', async () => {
    const fixture = createFixture()
    const destination = await fixture.service.validateDestination(fixture.destination)
    expect(destination).toBe(fixture.destination)
    expect(existsSync(fixture.destination)).toBe(true)
  })

  it('moves a file into the destination and avoids overwrites', async () => {
    const fixture = createFixture()
    const firstSource = join(fixture.workspace, 'first.webm')
    writeFileSync(firstSource, 'first')

    const first = await fixture.service.finalizeOutput(
      { kind: 'file', path: firstSource },
      fixture.workspace,
      fixture.destination,
      'My video [abc]',
    )
    expect(first.files[0]?.path).toBe(join(fixture.destination, 'My video [abc].webm'))
    expect(existsSync(first.files[0]!.path)).toBe(true)

    const secondSource = join(fixture.workspace, 'second.webm')
    writeFileSync(secondSource, 'second')
    const second = await fixture.service.finalizeOutput(
      { kind: 'file', path: secondSource },
      fixture.workspace,
      fixture.destination,
      'My video [abc]',
    )
    expect(second.files[0]?.path).toBe(join(fixture.destination, 'My video [abc] (1).webm'))
  })

  it('rejects output outside the workspace', async () => {
    const fixture = createFixture()
    const outside = join(fixture.destination, 'outside.webm')
    writeFileSync(outside, 'outside')

    await expect(
      fixture.service.finalizeOutput(
        { kind: 'file', path: outside },
        fixture.workspace,
        fixture.destination,
        'bad',
      ),
    ).rejects.toThrow(/outside its workspace/)
  })
})
