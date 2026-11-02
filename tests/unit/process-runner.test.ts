import { describe, expect, it } from 'vitest'
import { runProcess } from '@main/services/process-runner'
import type { ProcessError } from '@main/services/process-runner'

const node = process.execPath

describe('process runner', () => {
  it('captures stdout/stderr and reports line callbacks', async () => {
    const stdoutLines: string[] = []
    const stderrLines: string[] = []
    const result = await runProcess({
      executable: node,
      args: ['-e', "console.log('first'); console.error('second');"],
      timeoutMs: 5000,
      onStdoutLine: (line) => stdoutLines.push(line),
      onStderrLine: (line) => stderrLines.push(line),
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('first')
    expect(result.stderr).toContain('second')
    expect(stdoutLines).toContain('first')
    expect(stderrLines).toContain('second')
  })

  it('returns a non-zero exit code without treating it as a process failure', async () => {
    const result = await runProcess({
      executable: node,
      args: ['-e', "console.error('nope'); process.exit(3);"],
      timeoutMs: 5000,
    })
    expect(result.exitCode).toBe(3)
    expect(result.stderr).toContain('nope')
  })

  it('terminates a timed-out process tree', async () => {
    await expect(
      runProcess({
        executable: node,
        args: ['-e', 'setTimeout(() => undefined, 10000)'],
        timeoutMs: 150,
      }),
    ).rejects.toMatchObject<Partial<ProcessError>>({ failure: 'TIMEOUT' })
  })

  it('terminates an aborted process tree', async () => {
    const controller = new AbortController()
    const promise = runProcess({
      executable: node,
      args: ['-e', 'setTimeout(() => undefined, 10000)'],
      timeoutMs: 5000,
      signal: controller.signal,
    })
    setTimeout(() => controller.abort(), 150)

    await expect(promise).rejects.toMatchObject<Partial<ProcessError>>({ failure: 'ABORTED' })
  })

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      runProcess({
        executable: node,
        args: ['-e', 'console.log("never")'],
        signal: controller.signal,
      }),
    ).rejects.toMatchObject<Partial<ProcessError>>({ failure: 'ABORTED' })
  })
})
