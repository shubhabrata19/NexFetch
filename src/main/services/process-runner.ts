import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'

export type ProcessFailure = 'ABORTED' | 'TIMEOUT' | 'IDLE_TIMEOUT' | 'SPAWN'

export interface ProcessRunOptions {
  executable: string
  args: readonly string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  idleTimeoutMs?: number
  maxStdoutBytes?: number
  maxStderrBytes?: number
  signal?: AbortSignal
  onStdoutLine?: (line: string) => void
  onStderrLine?: (line: string) => void
}

export interface ProcessRunResult {
  exitCode: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  stdoutTruncated: boolean
  stderrTruncated: boolean
}

export class ProcessError extends Error {
  readonly failure: ProcessFailure
  readonly stdout: string
  readonly stderr: string

  constructor(failure: ProcessFailure, message: string, stdout = '', stderr = '') {
    super(message)
    this.name = 'ProcessError'
    this.failure = failure
    this.stdout = stdout
    this.stderr = stderr
  }
}

const ALLOWED_ENVIRONMENT_KEY =
  /^(path|systemroot|windir|temp|tmp|userprofile|home|appdata|localappdata|lang|lc_all|tz|http_proxy|https_proxy|no_proxy)$/i

function buildEnvironment(overrides: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && ALLOWED_ENVIRONMENT_KEY.test(key)) {
      environment[key] = value
    }
  }
  return { ...environment, ...overrides }
}

function terminateProcessTree(child: ChildProcess): void {
  const pid = child.pid
  if (!pid) return

  if (process.platform === 'win32') {
    try {
      const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        shell: false,
        windowsHide: true,
        stdio: 'ignore',
      })
      killer.on('error', () => {
        child.kill()
      })
    } catch {
      child.kill()
    }
    return
  }

  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }

  const forceTimer = setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
  }, 2000)
  forceTimer.unref()
}

function appendCapped(current: string, chunk: string, limit: number): string {
  if (current.length >= limit) return current
  return current + chunk.slice(0, limit - current.length)
}

function createLineReader(
  onLine: ((line: string) => void) | undefined,
  maxLineLength = 1024 * 1024,
): { push(text: string): void; flush(): void } {
  if (!onLine) {
    return { push: () => undefined, flush: () => undefined }
  }

  let buffer = ''

  return {
    push(text: string): void {
      buffer += text
      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, '')
        buffer = buffer.slice(newlineIndex + 1)
        if (line.length > 0) {
          try {
            onLine(line)
          } catch {
            // A parser error must not take down the process supervisor.
          }
        }
        newlineIndex = buffer.indexOf('\n')
      }

      if (buffer.length > maxLineLength) {
        buffer = buffer.slice(-maxLineLength)
      }
    },
    flush(): void {
      const line = buffer.replace(/\r$/, '')
      buffer = ''
      if (line.length === 0) return
      try {
        onLine(line)
      } catch {
        // Ignore parser errors during final flush.
      }
    },
  }
}

export async function runProcess(options: ProcessRunOptions): Promise<ProcessRunResult> {
  if (options.signal?.aborted) {
    throw new ProcessError('ABORTED', 'The process was cancelled before it started.')
  }

  return new Promise<ProcessRunResult>((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let stdoutTruncated = false
    let stderrTruncated = false
    let settled = false
    let failure: ProcessFailure | null = null
    let timeoutTimer: NodeJS.Timeout | undefined
    let idleTimer: NodeJS.Timeout | undefined

    const maxStdoutBytes = options.maxStdoutBytes ?? 1024 * 1024
    const maxStderrBytes = options.maxStderrBytes ?? 64 * 1024

    const stdoutLines = createLineReader(options.onStdoutLine)
    const stderrLines = createLineReader(options.onStderrLine)

    const child = spawn(options.executable, [...options.args], {
      cwd: options.cwd,
      env: buildEnvironment(options.env),
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const clearTimers = (): void => {
      if (timeoutTimer) clearTimeout(timeoutTimer)
      if (idleTimer) clearTimeout(idleTimer)
    }

    const onAbort = (): void => {
      failure = 'ABORTED'
      terminateProcessTree(child)
    }

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return
      settled = true
      clearTimers()
      options.signal?.removeEventListener('abort', onAbort)
      stdoutLines.flush()
      stderrLines.flush()

      if (failure) {
        reject(
          new ProcessError(
            failure,
            failure === 'ABORTED'
              ? 'The process was cancelled.'
              : failure === 'SPAWN'
                ? 'The process could not be started.'
                : 'The process timed out.',
            stdout,
            stderr,
          ),
        )
        return
      }

      resolve({
        exitCode,
        signal,
        stdout,
        stderr,
        stdoutTruncated,
        stderrTruncated,
      })
    }

    const resetIdleTimer = (): void => {
      if (!options.idleTimeoutMs) return
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        failure = 'IDLE_TIMEOUT'
        terminateProcessTree(child)
      }, options.idleTimeoutMs)
      idleTimer.unref()
    }

    if (options.timeoutMs) {
      timeoutTimer = setTimeout(() => {
        failure = 'TIMEOUT'
        terminateProcessTree(child)
      }, options.timeoutMs)
      timeoutTimer.unref()
    }

    resetIdleTimer()
    options.signal?.addEventListener('abort', onAbort, { once: true })

    child.stdout?.on('data', (chunk: Buffer) => {
      resetIdleTimer()
      const text = chunk.toString('utf8')
      stdoutLines.push(text)
      if (!stdoutTruncated) {
        const next = appendCapped(stdout, text, maxStdoutBytes)
        stdoutTruncated = next.length >= maxStdoutBytes && text.length > 0
        stdout = next
      }
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      resetIdleTimer()
      const text = chunk.toString('utf8')
      stderrLines.push(text)
      if (!stderrTruncated) {
        const next = appendCapped(stderr, text, maxStderrBytes)
        stderrTruncated = next.length >= maxStderrBytes && text.length > 0
        stderr = next
      }
    })

    child.on('error', () => {
      failure = 'SPAWN'
      finish(null, null)
    })

    child.on('close', (exitCode, signal) => {
      finish(exitCode, signal)
    })
  })
}
