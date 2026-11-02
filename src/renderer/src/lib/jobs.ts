import type { JobStatus } from '@shared/domain/job'

export function isTerminalStatus(status: JobStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

export function isActiveStatus(status: JobStatus): boolean {
  return !isTerminalStatus(status)
}
