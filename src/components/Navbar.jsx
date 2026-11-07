import { Link, NavLink } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../context/auth';
import Icon from './Icon';
export default function Navbar() {
  const { user, loading, logout } = useAuth();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function signOut() {
    setBusy(true);
    try {
      await logout();
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <header className="navbar">
      <nav className="navbar-container" aria-label="Main navigation">
        <Link to="/" className="logo">
          <span className="brand-icon">
            <Icon name="link" />
          </span>
          ziplink.
        </Link>
        <div className="nav-links">
          <NavLink to="/" end>
            Shorten
          </NavLink>
          <NavLink to="/history">My links</NavLink>
          <NavLink to="/analytics">Analytics</NavLink>
        </div>
        <div className="account-actions">
          {!loading &&
            (user ? (
              <>
                <span className="account-email" title={user.email}>
                  {user.email}
                </span>
                <button className="text-link" disabled={busy} onClick={signOut}>
                  {busy ? 'Signing out...' : 'Sign out'}
                </button>
              </>
            ) : (
              <Link className="text-link" to="/login">
                Sign in <Icon name="arrow" size={14} />
              </Link>
            ))}
        </div>
      </nav>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
    </header>
  );
}
