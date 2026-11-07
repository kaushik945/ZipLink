import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/auth';
export default function Login({ register = false }) {
  const { user, authenticate } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const destination = ['/history', '/analytics', '/'].includes(location.state?.from)
    ? location.state.from
    : '/history';
  if (user) return <Navigate to={destination} replace />;
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await authenticate(register ? 'register' : 'login', email, password);
      navigate(destination, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="page-shell auth-page">
      <section className="shortener-panel">
        <div className="panel-top">
          <h1>{register ? 'A home for your links.' : 'Welcome back.'}</h1>
        </div>
        <form onSubmit={submit}>
          <label htmlFor="email">Email</label>
          <input
            className="field"
            id="email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <label htmlFor="password">Password</label>
          <input
            className="field"
            id="password"
            type="password"
            autoComplete={register ? 'new-password' : 'current-password'}
            required
            minLength={12}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="form-hint">12+ characters, maximum 72 UTF-8 bytes.</p>
          {error && (
            <p className="notice" role="alert">
              {error}
            </p>
          )}
          <button className="button button-primary" disabled={busy}>
            {busy ? 'Please wait...' : register ? 'Create account' : 'Sign in'}
          </button>
          <p className="auth-switch">
            {register ? 'Already have an account?' : 'New to ZipLink?'}{' '}
            <Link to={register ? '/login' : '/register'} state={location.state}>
              {register ? 'Sign in' : 'Create an account'}
            </Link>
          </p>
        </form>
      </section>
    </main>
  );
}
