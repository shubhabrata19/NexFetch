export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) {
    return 'Unknown'
  }

  if (bytes < 1024) return `${Math.round(bytes)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`
}

export function formatSpeed(bytesPerSecond: number | null): string {
  if (bytesPerSecond === null || !Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
    return '—'
  }
  return `${formatBytes(bytesPerSecond)}/s`
}

export function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '—'
  const total = Math.max(0, Math.round(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const remaining = total % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${remaining}s`
  return `${remaining}s`
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return 'Unknown duration'
  const total = Math.round(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const remaining = total % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
  }
  return `${minutes}:${String(remaining).padStart(2, '0')}`
}

export function formatUploadDate(value: string | null): string {
  if (!value) return 'Upload date unknown'
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return 'Upload date unknown'
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

export function formatCodec(codec: string | null): string {
  if (!codec) return '—'
  const normalized = codec.toLowerCase()
  if (normalized.includes('avc') || normalized.includes('h264')) return 'H.264'
  if (normalized.includes('hev') || normalized.includes('h265')) return 'HEVC'
  if (normalized.includes('av01')) return 'AV1'
  if (normalized.includes('vp9')) return 'VP9'
  if (normalized.includes('vp8')) return 'VP8'
  if (normalized.includes('opus')) return 'Opus'
  if (normalized.includes('mp4a') || normalized.includes('aac')) return 'AAC'
  if (normalized.includes('mp3')) return 'MP3'
  return codec
}

export function formatResolution(width: number | null, height: number | null): string {
  if (width === null || height === null) return height === null ? 'Audio' : `${height}p`
  return `${width}×${height}`
}
