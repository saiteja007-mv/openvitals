import { useState } from 'react'
import { api } from '../api'
import { Button, Card, Field, Input } from '../components/UI'

export default function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: { preventDefault: () => void }) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await api.login(password)
      onSuccess()
    } catch (err) {
      setError(err instanceof Error && err.message && err.message !== 'login failed' ? err.message : 'Incorrect password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <form onSubmit={submit} style={{ width: '100%', maxWidth: 360 }}>
        <Card className="elevated">
          <div className="brand" style={{ fontSize: 32, letterSpacing: '-1px' }}>Health MCP<span style={{ color: 'var(--mute)' }}>.</span></div>
          <div className="caption" style={{ marginBottom: 20 }}>Sign in to continue.</div>
          <div className="stack">
            <Field label="Password">
              <div className="password-input-wrap">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  autoFocus
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); if (error) setError('') }}
                  placeholder="Enter password"
                  autoComplete="current-password"
                  aria-invalid={!!error}
                  aria-describedby={error ? 'login-error' : undefined}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </Field>
            {error && <div id="login-error" className="caption net-neg" role="alert">{error}</div>}
            <Button type="submit" variant="primary" loading={loading} disabled={!password}>Log in</Button>
          </div>
        </Card>
      </form>
    </div>
  )
}
