import { sanitizeFilenameBase } from '@shared/security/filename'

export function torrentFolderName(title: string, files: Array<{ path: string }>): string {
  const root = files.length > 1 ? files[0]?.path.split('/')[0] : title
  return sanitizeFilenameBase(root ?? title, 'torrent')
}

export function defaultTorrentDestination(downloadDirectory: string, title: string): string {
  const separator = downloadDirectory.includes('\\') ? '\\' : '/'
  const base = downloadDirectory.replace(/[\\/]+$/, '')
  return `${base}${separator}${title}`
}

export function joinDisplayPath(base: string, child: string): string {
  return defaultTorrentDestination(base, child)
}
