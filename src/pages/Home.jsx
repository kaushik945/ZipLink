import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon';
import CopyButton from '../components/CopyButton';
import Stats from '../components/Stats';
import { request, shortLink } from '../lib/api';
import { useAuth } from '../context/auth';
export default function Home() {
  const { user, loading: sessionLoading, error: sessionError } = useAuth();
  const [url, setUrl] = useState('');
  const [alias, setAlias] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState(null);
  const [statsState, setStatsState] = useState('loading');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!user) return;
    let active = true;
    request('/api/analytics/overview')
      .then((data) => {
        if (active) {
          setSummary({ owner: user.id, data });
          setStatsState('ready');
        }
      })
      .catch(() => {
        if (active) setStatsState('error');
      });
    return () => {
      active = false;
    };
  }, [user, refresh]);
  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setResult(null);
    try {
      const parsed = new URL(url.trim());
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
    } catch {
      setError('Enter a complete http:// or https:// URL.');
      return;
    }
    setLoading(true);
    try {
      const data = await request('/api/links', {
        method: 'POST',
        body: JSON.stringify({
          originalUrl: url.trim(),
          ...(alias ? { alias } : {}),
          ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
        }),
      });
      setResult({ ...data, owner: user.id });
      setUrl('');
      setAlias('');
      setExpiresAt('');
      setRefresh((n) => n + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <main className="home page-shell">
      <section className="hero">
        <div className="eyebrow">
          <span className="status-dot" /> THE LITTLE LINK THAT GOES A LONG WAY
        </div>
        <h1>
          Long story.
          <br />
          <span>Short link.</span>
          <span className="heading-star" aria-hidden="true">
            &#10035;
          </span>
        </h1>
        <p className="subtitle">
          Good things come in small links. Turn your long URLs into
          <br className="desktop-break" /> clean, shareable connections in a single click.
        </p>
        <section className="shortener-panel" aria-label="Create a short link">
          <div className="panel-top">
            <span>
              <Icon name="link" size={17} /> Make it short
            </span>
            <span className="panel-caption">SIMPLE. SECURE. YOURS.</span>
          </div>
          {user ? (
            <form onSubmit={handleSubmit} noValidate>
              <label htmlFor="long-url">Your long URL</label>
              <div className="shortener-form">
                <Icon name="link" />
                <input
                  id="long-url"
                  type="url"
                  maxLength={4096}
                  placeholder="https://example.com/your-very-long-link"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  required
                  aria-describedby={error ? 'url-error' : 'url-hint'}
                  aria-invalid={Boolean(error)}
                />
                <button className="button button-primary" disabled={loading}>
                  {loading ? 'Shortening...' : 'Shorten link'}
                  <Icon name="arrow" size={18} />
                </button>
              </div>
              <details className="link-options">
                <summary>Custom alias & expiration</summary>
                <div className="field-grid">
                  <label>
                    Custom alias (optional)
                    <input
                      className="field"
                      value={alias}
                      maxLength={40}
                      placeholder="my-link"
                      onChange={(e) => setAlias(e.target.value)}
                    />
                  </label>
                  <label>
                    Expires at (your local time)
                    <input
                      className="field"
                      type="datetime-local"
                      value={expiresAt}
                      onChange={(e) => setExpiresAt(e.target.value)}
                    />
                  </label>
                </div>
                <p className="form-hint">
                  Aliases are case-sensitive. Leave expiration blank for no expiry.
                </p>
              </details>
              <p id="url-hint" className="form-hint">
                <Icon name="check" size={13} /> Saved privately to your account. Redirects stay
                public.
              </p>
              {error && (
                <p className="notice" id="url-error" role="alert">
                  {error}
                </p>
              )}
            </form>
          ) : (
            <div className="signed-out-prompt">
              {sessionLoading ? (
                <p role="status">Loading your session...</p>
              ) : (
                <>
                  <h2>Your links deserve a home.</h2>
                  <p>
                    {sessionError ||
                      'Sign in to create links, keep them organized, and see every connection.'}
                  </p>
                  <Link className="button button-primary" to="/login">
                    Sign in to shorten <Icon name="arrow" size={17} />
                  </Link>
                  <Link className="text-link" to="/register">
                    Create an account
                  </Link>
                </>
              )}
            </div>
          )}
          {user && result?.owner === user.id && (
            <div className="result" role="status">
              <div>
                <span className="result-label">Ready to go. Your short link:</span>
                <a href={shortLink(result)} target="_blank" rel="noreferrer">
                  {shortLink(result)}
                </a>
              </div>
              <CopyButton text={shortLink(result)} />
            </div>
          )}
        </section>
        <div className="hero-footnote">
          <span>One link. Endless destinations.</span>
          <span className="tiny-line" />
          <Link to="/history">
            Explore your links <Icon name="arrow" size={14} />
          </Link>
        </div>
      </section>
      {user && (
        <section className="overview">
          <div className="section-heading">
            <div>
              <p className="eyebrow">A LITTLE PERSPECTIVE</p>
              <h2>Your links, at a glance.</h2>
            </div>
            <Link className="text-link" to="/analytics">
              View analytics <Icon name="arrow" size={16} />
            </Link>
          </div>
          <Stats
            summary={summary?.owner === user.id ? summary.data : null}
            loading={statsState === 'loading'}
            unavailable={statsState === 'error'}
          />
          {statsState === 'error' && (
            <p className="stats-notice">
              Statistics unavailable.{' '}
              <button className="text-link" onClick={() => setRefresh((n) => n + 1)}>
                Try again
              </button>
            </p>
          )}
        </section>
      )}
      <section className="features" aria-label="Why ZipLink">
        {[
          [
            '01',
            'bolt',
            'Less friction. More sharing.',
            'Turn lengthy URLs into compact links, with optional aliases and expiration.',
          ],
          [
            '02',
            'link',
            'Your links. Your control.',
            'Keep your collection private. Update destinations or disable links whenever you need.',
          ],
          [
            '03',
            'chart',
            'Every click tells a story.',
            'Explore daily trends, devices, and referrers. Analytics update as events are processed.',
          ],
        ].map(([number, icon, title, text]) => (
          <article className="feature-card" key={number}>
            <div className="feature-top">
              <span>{number}</span>
              <Icon name={icon} size={23} />
            </div>
            <h3>{title}</h3>
            <p>{text}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
