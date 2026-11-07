import { describe, expect, it } from 'vitest'
import { removeJobRequestSchema } from '@shared/validation/jobs'

describe('removeJobRequestSchema', () => {
  it('accepts a job id with or without the deleteFiles flag', () => {
    expect(removeJobRequestSchema.safeParse({ jobId: 'job-1' }).success).toBe(true)
    expect(
      removeJobRequestSchema.safeParse({ jobId: 'job-1', deleteFiles: true }).success,
    ).toBe(true)
    expect(
      removeJobRequestSchema.safeParse({ jobId: 'job-1', deleteFiles: false }).success,
    ).toBe(true)
  })

  it('rejects a missing job id', () => {
    expect(removeJobRequestSchema.safeParse({ deleteFiles: true }).success).toBe(false)
  })

  it('rejects a non-boolean deleteFiles flag', () => {
    expect(removeJobRequestSchema.safeParse({ jobId: 'job-1', deleteFiles: 'yes' }).success).toBe(
      false,
    )
  })

  it('rejects unknown fields', () => {
    expect(
      removeJobRequestSchema.safeParse({ jobId: 'job-1', deleteFiles: true, path: '/tmp' }).success,
    ).toBe(false)
  })
})
