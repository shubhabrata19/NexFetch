import { constants } from 'node:fs'
import { access, cp, lstat, mkdir, rename, rm, rmdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { DomainError } from '@shared/domain/errors'
import type { DownloadJob, JobOutput } from '@shared/domain/job'
import { addConflictSuffix, sanitizeFilenameBase } from '@shared/security/filename'

export interface EngineOutputLocation {
  kind: 'file' | 'directory'
  path: string
}

export interface DeleteTorrentFilesResult {
  deletedFiles: number
  deletedBytes: number
  failures: string[]
}

const RETRYABLE_DELETE_CODES = new Set(['EBUSY', 'EPERM', 'EACCES', 'EMFILE', 'ENOTEMPTY'])
const DELETE_ATTEMPTS = 5
const DELETE_RETRY_DELAY_MS = 150
/** Tolerated clock/file-timestamp skew when matching payload files to a job start. */
const START_TIME_TOLERANCE_MS = 2000

function normalizedForComparison(value: string): string {
  return process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value)
}

function samePath(first: string, second: string): boolean {
  return normalizedForComparison(first) === normalizedForComparison(second)
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

  /**
   * Deletes the files a torrent job wrote to disk.
   *
   * Only the exact payload files recorded in the job (or derived from its selection) are
   * removed. Directories are never deleted recursively, every path must stay inside the
   * torrent's save root, and files that predate the job are left alone when the job has no
   * finalized output — so a user file that happens to share a name is never destroyed.
   */
  async deleteTorrentFiles(job: DownloadJob): Promise<DeleteTorrentFilesResult> {
    const details = job.details?.engineId === 'torrent' ? job.details : null
    const result: DeleteTorrentFilesResult = { deletedFiles: 0, deletedBytes: 0, failures: [] }
    if (!details) return result

    const multiFile = details.files.length > 1
    const saveRoot = resolve(multiFile ? dirname(job.destination) : job.destination)
    const destination = resolve(job.destination)

    const candidates = new Set<string>()
    for (const file of job.output?.files ?? []) candidates.add(resolve(file.path))
    for (const file of details.files) {
      if (file.selected) candidates.add(resolve(join(saveRoot, file.path)))
    }

    const startedAt = job.startedAt ? Date.parse(job.startedAt) : Number.NaN
    const hasRecordedOutput = Boolean(job.output?.files.length)
    const touchedDirectories = new Set<string>()

    for (const target of candidates) {
      if (samePath(target, saveRoot) || samePath(target, destination)) continue
      if (!isPathInside(saveRoot, target)) {
        result.failures.push(target)
        continue
      }

      let info
      try {
        info = await lstat(target)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        result.failures.push(target)
        continue
      }
      if (!info.isFile()) continue

      if (
        !hasRecordedOutput &&
        Number.isFinite(startedAt) &&
        info.mtimeMs + START_TIME_TOLERANCE_MS < startedAt
      ) {
        continue
      }

      try {
        await this.removeFileWithRetry(target)
        result.deletedFiles += 1
        result.deletedBytes += info.size
        touchedDirectories.add(dirname(target))
      } catch {
        result.failures.push(target)
      }
    }

    for (const directory of touchedDirectories) {
      await this.pruneEmptyDirectories(directory, saveRoot)
    }

    return result
  }

  private async removeFileWithRetry(target: string): Promise<void> {
    for (let attempt = 1; attempt <= DELETE_ATTEMPTS; attempt += 1) {
      try {
        await rm(target, { force: true })
        return
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (attempt === DELETE_ATTEMPTS || !code || !RETRYABLE_DELETE_CODES.has(code)) throw error
        await new Promise<void>((done) => setTimeout(done, DELETE_RETRY_DELAY_MS))
      }
    }
  }

  private async pruneEmptyDirectories(start: string, saveRoot: string): Promise<void> {
    let directory = resolve(start)
    while (!samePath(directory, saveRoot) && isPathInside(saveRoot, directory)) {
      try {
        await rmdir(directory)
      } catch {
        return
      }
      directory = dirname(directory)
    }
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
