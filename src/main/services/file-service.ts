import { constants } from 'node:fs'
import { access, cp, mkdir, rename, rm, rmdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { DomainError } from '@shared/domain/errors'
import type { JobOutput } from '@shared/domain/job'
import { addConflictSuffix, sanitizeFilenameBase } from '@shared/security/filename'

export interface EngineOutputLocation {
  kind: 'file' | 'directory'
  path: string
}

function normalizedForComparison(value: string): string {
  return process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value)
}

export function isPathInside(root: string, candidate: string): boolean {
  const normalizedRoot = normalizedForComparison(root)
  const normalizedCandidate = normalizedForComparison(candidate)
  const relativePath = relative(normalizedRoot, normalizedCandidate)
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}

export class FileService {
  async validateDestination(destination: string): Promise<string> {
    if (!isAbsolute(destination)) {
      throw new DomainError('INVALID_REQUEST', 'Choose an absolute download folder.')
    }

    const resolved = resolve(destination)
    try {
      await mkdir(resolved, { recursive: true })
      const info = await stat(resolved)
      if (!info.isDirectory()) {
        throw new DomainError('INVALID_REQUEST', 'The download destination is not a folder.')
      }
      await access(resolved, constants.W_OK)
    } catch (error) {
      if (error instanceof DomainError) throw error
      throw new DomainError(
        'PERMISSION_DENIED',
        'The download folder is not writable. Choose another folder.',
      )
    }

    return resolved
  }

  getWorkspacePath(destination: string, jobId: string): string {
    return join(destination, '.nexfetch-tmp', jobId)
  }

  async createWorkspace(destination: string, jobId: string): Promise<string> {
    const workspace = this.getWorkspacePath(destination, jobId)
    if (!isPathInside(destination, workspace)) {
      throw new DomainError(
        'PERMISSION_DENIED',
        'The download workspace is outside the destination.',
      )
    }
    await mkdir(workspace, { recursive: true })
    return workspace
  }

  async removeWorkspace(workspace: string, destination: string): Promise<void> {
    if (!isPathInside(destination, workspace)) {
      throw new DomainError(
        'PERMISSION_DENIED',
        'Refusing to remove a folder outside the destination.',
      )
    }
    await rm(workspace, { recursive: true, force: true })
    try {
      await rmdir(dirname(workspace))
    } catch {
      // Another job's workspace may still be present.
    }
  }

  async removeJobWorkspace(destination: string, jobId: string): Promise<void> {
    await this.removeWorkspace(this.getWorkspacePath(destination, jobId), destination)
  }

  async finalizeOutput(
    output: EngineOutputLocation,
    workspace: string,
    destination: string,
    filenameBase: string,
  ): Promise<JobOutput> {
    if (!isPathInside(workspace, output.path)) {
      throw new DomainError('FINALIZE_FAILED', 'The downloaded file was outside its workspace.')
    }

    try {
      await stat(output.path)
    } catch {
      throw new DomainError('FINALIZE_FAILED', 'The downloaded output could not be found.')
    }

    const base = sanitizeFilenameBase(filenameBase, 'download')
    const extension = output.kind === 'file' ? extname(output.path) : ''
    const cleanBase =
      extension && base.toLowerCase().endsWith(extension.toLowerCase())
        ? base.slice(0, -extension.length)
        : base

    const target = this.findAvailablePath(destination, cleanBase, extension)
    try {
      await rename(output.path, target)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') {
        throw new DomainError('FINALIZE_FAILED', 'The downloaded file could not be moved.')
      }
      await cp(output.path, target, { recursive: true, force: false })
      await rm(output.path, { recursive: true, force: true })
    }

    const finalInfo = await stat(target)
    return {
      directory: destination,
      files: [
        {
          path: target,
          bytes: finalInfo.isFile() ? finalInfo.size : null,
        },
      ],
    }
  }

  private findAvailablePath(destination: string, base: string, extension: string): string {
    for (let index = 0; index < 1000; index += 1) {
      const candidate = join(destination, `${addConflictSuffix(base, index)}${extension}`)
      if (!existsSync(candidate)) return candidate
    }
    throw new DomainError('FINALIZE_FAILED', 'Could not find an available filename.')
  }
}
