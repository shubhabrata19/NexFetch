import type { DownloadSource } from './job'

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
])

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/
const HOST_LIKE_PATTERN = /^(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be|youtube-nocookie\.com)/i

export type YoutubeInputClassification =
  { kind: 'supported'; source: DownloadSource } | { kind: 'unsupported'; reason: string }

function normalizeInput(value: string): string {
  const trimmed = value.trim()
  if (HOST_LIKE_PATTERN.test(trimmed)) return `https://${trimmed}`
  return trimmed
}

function extractVideoId(url: URL): string | null {
  const host = url.hostname.toLowerCase()

  if (host === 'youtu.be' || host === 'www.youtu.be') {
    return url.pathname.split('/').filter(Boolean)[0] ?? null
  }

  if (url.pathname === '/watch') {
    return url.searchParams.get('v')
  }

  const match = url.pathname.match(/^\/(?:shorts|live|embed|v)\/([^/]+)/)
  return match?.[1] ?? null
}

function unsupportedReason(url: URL): string {
  const path = url.pathname.toLowerCase()
  if (url.searchParams.has('list') && !url.searchParams.has('v')) {
    return 'Playlists are not supported yet. Paste a single video link.'
  }
  if (path.startsWith('/playlist')) {
    return 'Playlists are not supported yet. Paste a single video link.'
  }
  if (path.startsWith('/@') || path.startsWith('/channel/') || path.startsWith('/c/')) {
    return 'Channel pages are not supported. Paste a single video link.'
  }
  if (path.startsWith('/results') || path.startsWith('/hashtag/')) {
    return 'Search results are not supported. Paste a single video link.'
  }
  return 'Only individual YouTube videos are supported in this release.'
}

export function classifyYoutubeInput(value: string): YoutubeInputClassification | null {
  const normalized = normalizeInput(value)
  let url: URL
  try {
    url = new URL(normalized)
  } catch {
    return HOST_LIKE_PATTERN.test(normalized)
      ? { kind: 'unsupported', reason: 'This YouTube link is not valid.' }
      : null
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username || url.password) {
    return { kind: 'unsupported', reason: 'YouTube links with credentials are not accepted.' }
  }
  if (!YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return null

  const videoId = extractVideoId(url)
  if (!videoId || !VIDEO_ID_PATTERN.test(videoId)) {
    return { kind: 'unsupported', reason: unsupportedReason(url) }
  }

  return {
    kind: 'supported',
    source: {
      kind: 'youtube',
      videoId,
      canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
    },
  }
}

export function parseYoutubeUrl(value: string): DownloadSource | null {
  const classification = classifyYoutubeInput(value)
  return classification?.kind === 'supported' ? classification.source : null
}
