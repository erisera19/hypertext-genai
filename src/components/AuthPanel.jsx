import { useEffect, useRef, useState } from 'react'
import { login, register } from '../core/api'

/**
 * Sign in or create an account.
 *
 * An account is what turns the margin rail from something that lasts one
 * sitting into a library: what you opened, and what you asked of it. The
 * reader is told that plainly here, because the tool works perfectly well
 * without one and the reason to sign up should be the honest one.
 */
export default function AuthPanel({ onClose, onSignedIn, canSignUp = true }) {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const emailRef = useRef(null)

  // A closed study hands out accounts in advance, so there is no sign-up to
  // offer and the panel must not show a door the server has locked.
  const creating = canSignUp && mode === 'create'

  useEffect(() => {
    emailRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const user = creating
        ? await register({ email, password })
        : await login({ email, password })
      onSignedIn(user)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="auth"
        role="dialog"
        aria-modal="true"
        aria-label={creating ? 'Create an account' : 'Sign in'}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="auth__title">{creating ? 'Create an account' : 'Sign in'}</h2>
        <p className="auth__lede">
          Your highlights and the answers to them are kept, so a document you
          open again comes back marked up the way you left it.
        </p>

        <form className="auth__form" onSubmit={submit}>
          <label className="auth__field">
            <span>Email</span>
            <input
              ref={emailRef}
              type="email"
              value={email}
              autoComplete="email"
              required
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          <label className="auth__field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              autoComplete={creating ? 'new-password' : 'current-password'}
              required
              minLength={creating ? 8 : undefined}
              onChange={(e) => setPassword(e.target.value)}
            />
            {creating && <small className="auth__hint">At least 8 characters.</small>}
          </label>

          {error && <p className="auth__error">{error}</p>}

          <div className="auth__actions">
            <button className="btn" type="submit" disabled={busy}>
              {busy ? 'Working…' : creating ? 'Create account' : 'Sign in'}
            </button>
            {canSignUp && (
              <button className="auth__switch" type="button" onClick={() => { setMode(creating ? 'login' : 'create'); setError(null) }}>
                {creating ? 'I already have an account' : 'Create an account instead'}
              </button>
            )}
          </div>
        </form>

        <p className="auth__note">
          Signing in stores your documents and notes on this machine's local
          server. You can keep using the reader without an account - nothing is
          saved then.
        </p>
      </div>
    </div>
  )
}
