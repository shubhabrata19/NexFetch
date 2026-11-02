import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

type LogLevel = 'info' | 'warn' | 'error'

const MAX_LOG_BYTES = 5 * 1024 * 1024
const SENSITIVE_KEY = /(token|secret|password|cookie|authorization|api[_-]?key)/i

function sanitizeContext(context: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!context) return {}

  const sanitized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(context)) {
    if (SENSITIVE_KEY.test(key)) {
      sanitized[key] = '[redacted]'
    } else if (value instanceof Error) {
      sanitized[key] = value.message
    } else if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      sanitized[key] = value
    } else if (value === null) {
      sanitized[key] = null
    } else {
      sanitized[key] = '[object]'
    }
  }
  return sanitized
}

export class Logger {
  private readonly logFile: string

  constructor(readonly directory: string) {
    mkdirSync(directory, { recursive: true })
    this.logFile = join(directory, 'nexfetch.log')
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.write('info', message, context)
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.write('warn', message, context)
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.write('error', message, context)
  }

  private write(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    const entry = {
      time: new Date().toISOString(),
      level,
      message,
      ...sanitizeContext(context),
    }

    try {
      this.rotateIfNeeded()
      appendFileSync(this.logFile, `${JSON.stringify(entry)}\n`, 'utf8')
    } catch {
      // Logging must never crash the application.
    }

    if (process.env.NODE_ENV !== 'production') {
      console[level](`[NexFetch] ${message}`, context ?? '')
    }
  }

  private rotateIfNeeded(): void {
    if (!existsSync(this.logFile)) return
    if (statSync(this.logFile).size < MAX_LOG_BYTES) return
    const previous = `${this.logFile}.1`
    rmSync(previous, { force: true })
    renameSync(this.logFile, previous)
  }
}
