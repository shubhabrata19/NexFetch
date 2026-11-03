export type IconName =
  | 'download'
  | 'torrent'
  | 'history'
  | 'settings'
  | 'folder'
  | 'file'
  | 'refresh'
  | 'stop'
  | 'pause'
  | 'play'
  | 'x'
  | 'sun'
  | 'moon'
  | 'alert'
  | 'check'
  | 'logo'
  | 'spark'

interface IconProps {
  name: IconName
  size?: number
  className?: string
}

export function Icon({ name, size = 18, className }: IconProps) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    'aria-hidden': true,
    focusable: false,
  }

  switch (name) {
    case 'download':
      return (
        <svg {...common}>
          <path d="M12 3v11" />
          <path d="m7.5 9.5 4.5 4.5 4.5-4.5" />
          <path d="M5 21h14" />
        </svg>
      )
    case 'torrent':
      return (
        <svg {...common}>
          <circle cx="12" cy="5" r="2.2" />
          <circle cx="5" cy="18" r="2.2" />
          <circle cx="19" cy="18" r="2.2" />
          <path d="M12 7.2v4.3" />
          <path d="m10.4 17.2-3.2-2.6" />
          <path d="m13.6 17.2 3.2-2.6" />
        </svg>
      )
    case 'history':
      return (
        <svg {...common}>
          <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
          <path d="M3 3v5h5" />
          <path d="M12 7v5l3 2" />
        </svg>
      )
    case 'settings':
      return (
        <svg {...common}>
          <path d="M4 6h16" />
          <path d="M4 12h16" />
          <path d="M4 18h16" />
          <circle cx="8" cy="6" r="2" fill="var(--surface)" />
          <circle cx="16" cy="12" r="2" fill="var(--surface)" />
          <circle cx="10" cy="18" r="2" fill="var(--surface)" />
        </svg>
      )
    case 'folder':
      return (
        <svg {...common}>
          <path d="M3 7a2 2 0 0 1 2-2h5l2 2h5a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
      )
    case 'file':
      return (
        <svg {...common}>
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5" />
        </svg>
      )
    case 'refresh':
      return (
        <svg {...common}>
          <path d="M20 11a8 8 0 1 0-2.3 6.7" />
          <path d="M20 4v7h-7" />
        </svg>
      )
    case 'stop':
      return (
        <svg {...common}>
          <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
      )
    case 'pause':
      return (
        <svg {...common}>
          <path d="M9 6v12" />
          <path d="M15 6v12" />
        </svg>
      )
    case 'play':
      return (
        <svg {...common}>
          <path d="m8 5 11 7-11 7z" />
        </svg>
      )
    case 'x':
      return (
        <svg {...common}>
          <path d="m6 6 12 12" />
          <path d="M18 6 6 18" />
        </svg>
      )
    case 'sun':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2" />
          <path d="M12 20v2" />
          <path d="m4.93 4.93 1.42 1.42" />
          <path d="m17.66 17.66 1.41 1.41" />
          <path d="M2 12h2" />
          <path d="M20 12h2" />
          <path d="m6.34 17.66-1.41 1.41" />
          <path d="m19.07 4.93-1.41 1.41" />
        </svg>
      )
    case 'moon':
      return (
        <svg {...common}>
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
      )
    case 'alert':
      return (
        <svg {...common}>
          <path d="m12 3 9 16H3z" />
          <path d="M12 9v4" />
          <path d="M12 16.5h.01" />
        </svg>
      )
    case 'check':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="m8 12 2.5 2.5L16 9" />
        </svg>
      )
    case 'logo':
      return (
        <svg {...common}>
          <path d="M12 3v10" />
          <path d="m8 9 4 4 4-4" />
          <path d="M5 15v3a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-3" />
        </svg>
      )
    case 'spark':
      return (
        <svg {...common}>
          <path d="m12 3 1.4 4.6L18 9l-4.6 1.4L12 15l-1.4-4.6L6 9l4.6-1.4z" />
          <path d="m5 16 .7 2.3L8 19l-2.3.7L5 22l-.7-2.3L2 19l2.3-.7z" />
        </svg>
      )
  }
}
