import { DomainError } from '@shared/domain/errors'

export function mapYtDlpFailure(stderr: string, _exitCode: number | null): DomainError {
  const text = stderr.toLowerCase()

  if (
    /private video|members-only|members only|join this channel|sign in to confirm|login required|age-restricted|age restricted|not available in your country|geo-restricted/.test(
      text,
    )
  ) {
    return new DomainError(
      'ACCESS_RESTRICTED',
      'This video requires access that NexFetch does not bypass. Try a public video you are permitted to download.',
    )
  }

  if (/video unavailable|has been removed|does not exist|no longer available/.test(text)) {
    return new DomainError('VIDEO_UNAVAILABLE', 'This video is unavailable.')
  }

  if (/requested format is not available|requested format not available/.test(text)) {
    return new DomainError(
      'FORMAT_UNAVAILABLE',
      'The selected format is no longer available. Fetch the video details again.',
    )
  }

  if (/no space left|disk full/.test(text)) {
    return new DomainError('DISK_FULL', 'There is not enough disk space to finish this download.')
  }

  if (/permission denied|access is denied/.test(text)) {
    return new DomainError('PERMISSION_DENIED', 'The download folder could not be written to.')
  }

  if (/ffmpeg.*not found|ffprobe.*not found|ffmpeg.*not installed/.test(text)) {
    return new DomainError(
      'DEPENDENCY_MISSING',
      'FFmpeg is required to merge this download but was not found.',
    )
  }

  if (/unsupported url|not a valid url/.test(text)) {
    return new DomainError('UNSUPPORTED_SOURCE', 'This source is not supported.')
  }

  if (/postprocess|merger|conversion failed|ffmpeg failed/.test(text)) {
    return new DomainError(
      'PROCESSING_FAILED',
      'The downloaded streams could not be merged into a playable file.',
      true,
    )
  }

  if (
    /timed out|timeout|connection|network|temporary failure|http error|unable to download/.test(
      text,
    )
  ) {
    return new DomainError(
      'NETWORK_ERROR',
      'The download was interrupted by a network error. Try again.',
      true,
    )
  }

  return new DomainError('EXTRACTOR_ERROR', 'yt-dlp could not extract or download this video.')
}
