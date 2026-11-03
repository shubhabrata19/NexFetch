import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface ResumeState {
  version: 1
  url: string
  etag: string | null
  lastModified: string | null
  totalBytes: number | null
  contentType: string | null
  updatedAt: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeResumeState(value: unknown): ResumeState | null {
  if (!isRecord(value) || value.version !== 1) return null
  if (typeof value.url !== 'string' || value.url.length === 0) return null

  const totalBytes =
    value.totalBytes === null
      ? null
      : typeof value.totalBytes === 'number' &&
          Number.isSafeInteger(value.totalBytes) &&
          value.totalBytes >= 0
        ? value.totalBytes
        : null

  return {
    version: 1,
    url: value.url,
    etag: typeof value.etag === 'string' ? value.etag : null,
    lastModified: typeof value.lastModified === 'string' ? value.lastModified : null,
    totalBytes,
    contentType: typeof value.contentType === 'string' ? value.contentType : null,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
  }
}

export async function readResumeState(filePath: string): Promise<ResumeState | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, 'utf8'))
    return normalizeResumeState(parsed)
  } catch {
    return null
  }
}

export async function writeResumeState(filePath: string, state: ResumeState): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  await rename(temporaryPath, filePath)
}

export async function removeResumeState(filePath: string): Promise<void> {
  await rm(filePath, { force: true })
}
