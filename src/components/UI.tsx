import React from 'react'

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'subtle' | 'danger'
  size?: 'md' | 'sm'
  loading?: boolean
}
export function Button({ variant = 'primary', size = 'md', loading, children, className = '', disabled, ...rest }: BtnProps) {
  const cls = `btn btn-${variant} ${size === 'sm' ? 'btn-sm' : ''} ${className}`.trim()
  return (
    <button className={cls} disabled={disabled || loading} {...rest}>
      {loading && <span className="spin" />}
      {children}
    </button>
  )
}

export function Card({ children, soft, dark, className = '', onClick }: { children: React.ReactNode; soft?: boolean; dark?: boolean; className?: string; onClick?: () => void }) {
  const base = dark ? 'card-dark' : soft ? 'card-soft' : 'card'
  return <div className={`${base} ${className}`.trim()} onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>{children}</div>
}

export function Stat({ label, value, unit }: { label: string; value: React.ReactNode; unit?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value ?? '—'}{unit && value != null ? <span className="stat-unit">{unit}</span> : null}</div>
    </div>
  )
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="field"><span className="label">{label}</span>{children}</label>
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className="input" {...props} />
}
export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="select" {...props} />
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>
}

export function Loading() {
  return <div className="center-load"><span className="spin spin-dark" /></div>
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row between" style={{ marginBottom: 16 }}>
          <h3>{title}</h3>
          <button className="iconbtn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Toast({ message }: { message: string }) {
  return <div className="toast">{message}</div>
}

export function useToast() {
  const [msg, setMsg] = React.useState<string | null>(null)
  const show = React.useCallback((m: string) => {
    setMsg(m)
    window.setTimeout(() => setMsg(null), 2600)
  }, [])
  const node = msg ? <Toast message={msg} /> : null
  return { show, node }
}
