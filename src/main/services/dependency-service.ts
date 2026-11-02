import { spawn } from 'node:child_process'
import { accessSync, constants, existsSync, statSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import type {
  DependencyId,
  DependencyInfo,
  DependencySource,
  DependencyStatus,
} from '@shared/ipc/contracts'

interface DependencyServiceOptions {
  bundledRoot: string
  allowEnvOverrides: boolean
}

interface ResolvedExecutable {
  path: string
  source: DependencySource
}

const BINARY_NAMES: Record<DependencyId, string> = {
  'yt-dlp': 'yt-dlp',
  ffmpeg: 'ffmpeg',
  ffprobe: 'ffprobe',
}

const ENV_KEYS: Record<DependencyId, string> = {
  'yt-dlp': 'NXF_YTDLP_PATH',
  ffmpeg: 'NXF_FFMPEG_PATH',
  ffprobe: 'NXF_FFPROBE_PATH',
}

const VERSION_ARGS: Record<DependencyId, string[]> = {
  'yt-dlp': ['--version'],
  ffmpeg: ['-version'],
  ffprobe: ['-version'],
}

function executableName(id: DependencyId): string {
  return process.platform === 'win32' ? `${BINARY_NAMES[id]}.exe` : BINARY_NAMES[id]
}

function isExecutableFile(candidate: string): boolean {
  try {
    if (!existsSync(candidate) || !statSync(candidate).isFile()) return false
    if (process.platform !== 'win32') accessSync(candidate, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export class DependencyService {
  constructor(private readonly options: DependencyServiceOptions) {}

  resolve(id: DependencyId): { path: string; version: string | null } | null {
    const resolved = this.resolveExecutable(id)
    return resolved ? { path: resolved.path, version: null } : null
  }

  async getStatus(): Promise<DependencyStatus> {
    const [ytDlp, ffmpeg, ffprobe] = await Promise.all([
      this.check('yt-dlp'),
      this.check('ffmpeg'),
      this.check('ffprobe'),
    ])
    return { ytDlp, ffmpeg, ffprobe }
  }

  resolveExecutable(id: DependencyId): ResolvedExecutable | null {
    const candidates: Array<{ path: string; source: DependencySource }> = []

    if (this.options.allowEnvOverrides) {
      const override = process.env[ENV_KEYS[id]]
      if (override) candidates.push({ path: override, source: 'env' })
    }

    candidates.push({
      path: join(
        this.options.bundledRoot,
        'bin',
        `${process.platform}-${process.arch}`,
        executableName(id),
      ),
      source: 'bundled',
    })

    const pathValue = process.env.PATH ?? ''
    for (const directory of pathValue.split(delimiter)) {
      const normalized = directory.trim().replace(/^"(.*)"$/, '$1')
      if (normalized.length > 0) {
        candidates.push({ path: join(normalized, executableName(id)), source: 'system' })
      }
    }

    return candidates.find((candidate) => isExecutableFile(candidate.path)) ?? null
  }

  private async check(id: DependencyId): Promise<DependencyInfo> {
    const resolved = this.resolveExecutable(id)
    if (!resolved) {
      return { id, state: 'missing', version: null, source: null }
    }

    const version = await this.readVersion(resolved.path, VERSION_ARGS[id])
    return {
      id,
      state: version ? 'ready' : 'error',
      version,
      source: resolved.source,
    }
  }

  private readVersion(executable: string, args: string[]): Promise<string | null> {
    return new Promise((resolve) => {
      let output = ''
      let settled = false

      const finish = (value: string | null): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      }

      const child = spawn(executable, args, {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      const timer = setTimeout(() => {
        child.kill()
        finish(null)
      }, 5000)

      const collect = (chunk: Buffer): void => {
        if (output.length < 16_384) output += chunk.toString('utf8')
      }

      child.stdout.on('data', collect)
      child.stderr.on('data', collect)
      child.on('error', () => finish(null))
      child.on('close', () => {
        const line = output
          .split(/\r?\n/)
          .map((value) => value.trim())
          .find((value) => value.length > 0)
        finish(line ?? null)
      })
    })
  }
}
