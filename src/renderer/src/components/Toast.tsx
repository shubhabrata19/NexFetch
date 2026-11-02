import { Icon } from './Icon'

export type ToastKind = 'success' | 'error' | 'info'

export interface ToastState {
  id: number
  kind: ToastKind
  message: string
}

interface ToastProps {
  toast: ToastState | null
}

export function Toast({ toast }: ToastProps) {
  if (!toast) return null

  const icon = toast.kind === 'success' ? 'check' : toast.kind === 'error' ? 'alert' : 'spark'

  return (
    <div
      className={`toast toast--${toast.kind}`}
      role={toast.kind === 'error' ? 'alert' : 'status'}
      aria-live={toast.kind === 'error' ? 'assertive' : 'polite'}
      aria-atomic="true"
    >
      <Icon name={icon} size={18} />
      <span>{toast.message}</span>
    </div>
  )
}
