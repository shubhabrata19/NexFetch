import { z } from 'zod'
import { DomainError } from '@shared/domain/errors'
import type { DependencyService } from './dependency-service'
import { ProcessError, runProcess } from './process-runner'

const ffprobeSchema = z.object({
  streams: z
    .array(
      z
        .object({
          codec_type: z.string().optional(),
          width: z.number().nullable().optional(),
          height: z.number().nullable().optional(),
        })
        .passthrough(),
    )
    .default([]),
})

export interface MediaExpectation {
  expectedVideoHeight: number | null
  requireAudio: boolean
}

export interface MediaVerificationResult {
  videoHeight: number | null
  hasAudio: boolean
}

export class MediaVerifier {
  constructor(private readonly dependencies: DependencyService) {}

  async verify(
    filePath: string,
    expectation: MediaExpectation,
    signal?: AbortSignal,
  ): Promise<MediaVerificationResult> {
    const ffprobe = this.dependencies.resolveExecutable('ffprobe')
    if (!ffprobe) {
      throw new DomainError(
        'DEPENDENCY_MISSING',
        'ffprobe was not found. It is required to verify the downloaded output.',
      )
    }

    let result
    try {
      result = await runProcess({
        executable: ffprobe.path,
        args: ['-v', 'error', '-print_format', 'json', '-show_streams', filePath],
        timeoutMs: 20_000,
        maxStdoutBytes: 2 * 1024 * 1024,
        maxStderrBytes: 32 * 1024,
        signal,
      })
    } catch (error) {
      if (error instanceof ProcessError && error.failure === 'ABORTED') {
        throw new DomainError('CANCELLED', 'Download cancelled.')
      }
      throw new DomainError(
        'VERIFICATION_FAILED',
        'The downloaded file could not be inspected after merging.',
      )
    }

    if (result.exitCode !== 0) {
      throw new DomainError(
        'VERIFICATION_FAILED',
        'The downloaded file could not be inspected after merging.',
      )
    }

    let parsed
    try {
      parsed = ffprobeSchema.parse(JSON.parse(result.stdout))
    } catch {
      throw new DomainError(
        'VERIFICATION_FAILED',
        'The downloaded file did not produce valid media metadata.',
      )
    }

    const videoStreams = parsed.streams.filter((stream) => stream.codec_type === 'video')
    const audioStreams = parsed.streams.filter((stream) => stream.codec_type === 'audio')

    if (expectation.expectedVideoHeight !== null) {
      const matchingVideo = videoStreams.find(
        (stream) => stream.height === expectation.expectedVideoHeight,
      )
      if (!matchingVideo) {
        throw new DomainError(
          'VERIFICATION_FAILED',
          'The downloaded file did not match the selected video resolution.',
        )
      }
    }

    if (expectation.requireAudio && audioStreams.length === 0) {
      throw new DomainError(
        'VERIFICATION_FAILED',
        'The downloaded file does not contain an audio track.',
      )
    }

    return {
      videoHeight: videoStreams[0]?.height ?? null,
      hasAudio: audioStreams.length > 0,
    }
  }
}
