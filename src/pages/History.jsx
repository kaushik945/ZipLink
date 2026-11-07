import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon';
import CopyButton from '../components/CopyButton';
import LinkEditor from '../components/LinkEditor';
import { request, requestPage, shortLink } from '../lib/api';
function displayDate(value) {
  return value
    ? new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z').toLocaleDateString()
    : 'Never';
}
export default function History() {
  const [urls, setUrls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [cursor, setCursor] = useState(null);
  const [previous, setPrevious] = useState([]);
  const [pagination, setPagination] = useState({});
  const [busy, setBusy] = useState(null);
  const [editing, setEditing] = useState(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query);
      setCursor(null);
      setPrevious([]);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({
      search,
      status,
      limit: '20',
      ...(cursor ? { cursor } : {}),
    });
    requestPage(`/api/links?${params}`)
      .then((body) => {
        if (active) {
          setUrls(body.data);
          setPagination(body.pagination);
          setError('');
        }
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [search, status, cursor, refresh]);
  async function mutate(item, remove = false) {
    if (remove && !window.confirm('Delete this short link? Its code cannot be reused.')) return;
    setBusy(item.id);
    try {
      await request(`/api/links/${item.id}`, {
        method: remove ? 'DELETE' : 'PATCH',
        ...(!remove ? { body: JSON.stringify({ enabled: !item.enabled }) } : {}),
      });
      setRefresh((n) => n + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <main className="history-page page-shell">
      <div className="history-heading">
        <div>
          <p className="eyebrow">YOUR COLLECTION</p>
          <h1>
            Small links.
            <br />
            <span>All in one place.</span>
          </h1>
          <p className="subtitle">Manage your destinations. Make every connection count.</p>
        </div>
        <Link to="/" className="button button-primary">
          Create a link <Icon name="arrow" size={17} />
        </Link>
      </div>
      <section className="links-section" aria-label="Your shortened links">
        <div className="section-heading">
          <h2>My links</h2>
          <div className="history-tools">
            <label className="search-box">
              <Icon name="search" size={17} />
              <input
                aria-label="Search links"
                placeholder="Search all your links..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <select
              aria-label="Filter link status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setCursor(null);
                setPrevious([]);
                setLoading(true);
              }}
            >
              <option value="all">All statuses</option>
              <option value="enabled">Active</option>
              <option value="disabled">Disabled</option>
              <option value="expired">Expired</option>
            </select>
          </div>
        </div>
        {error && (
          <div className="notice" role="alert">
            {error}{' '}
            <button
              className="text-link"
              onClick={() => {
                setLoading(true);
                setRefresh((n) => n + 1);
              }}
            >
              Try again
            </button>
          </div>
        )}
        {loading ? (
          <div className="empty-state" role="status">
            Loading your links...
          </div>
        ) : urls.length ? (
          <div className="url-list">
            {urls.map((item) => (
              <article className="managed-link" key={item.id}>
                <div className="url-card">
                  <div className="url-symbol">
                    <Icon name="link" />
                  </div>
                  <div className="url-info">
                    <a
                      className="short-url"
                      href={shortLink(item)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {shortLink(item)} <Icon name="arrow" size={14} />
                    </a>
                    <p className="original-url" title={item.original_url}>
                      {item.original_url}
                    </p>
                    <p className="created-date">
                      Created {displayDate(item.created_at)} · Expires:{' '}
                      {displayDate(item.expires_at)} · {item.enabled ? 'Enabled' : 'Disabled'}
                    </p>
                  </div>
                  <div className="url-actions">
                    <div className="clicks">
                      <strong>{Number(item.clicks).toLocaleString()}</strong>
                      <span>clicks</span>
                    </div>
                    <CopyButton text={shortLink(item)} />
                    <button
                      className="icon-button"
                      aria-label={`Delete link ${item.short_code}`}
                      disabled={busy === item.id}
                      onClick={() => mutate(item, true)}
                    >
                      <Icon name="trash" size={18} />
                    </button>
                  </div>
                </div>
                <div className="link-controls">
                  <button
                    className="text-link"
                    onClick={() => setEditing(editing === item.id ? null : item.id)}
                  >
                    Edit destination
                  </button>
                  <button
                    className="text-link"
                    disabled={busy === item.id}
                    onClick={() => mutate(item)}
                  >
                    {item.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <Link className="text-link" to={`/analytics?link=${item.id}`}>
                    View analytics <Icon name="arrow" size={13} />
                  </Link>
                </div>
                {editing === item.id && (
                  <LinkEditor
                    item={item}
                    onSave={() => {
                      setEditing(null);
                      setRefresh((n) => n + 1);
                    }}
                    onCancel={() => setEditing(null)}
                  />
                )}
              </article>
            ))}
          </div>
        ) : (
          !error && (
            <div className="empty-state">
              <Icon name={query ? 'search' : 'link'} size={32} />
              <h2>
                {query || status !== 'all'
                  ? 'No matching links'
                  : 'Your next connection starts here.'}
              </h2>
              <p>
                {query || status !== 'all'
                  ? 'Try another search or filter.'
                  : 'Create your first short link and watch your collection grow.'}
              </p>
              <Link to="/" className="button button-primary">
                Shorten a link
              </Link>
            </div>
          )
        )}
        <div className="pagination">
          <button
            className="button button-secondary"
            disabled={!previous.length || loading}
            onClick={() => {
              setCursor(previous.at(-1));
              setPrevious((old) => old.slice(0, -1));
              setLoading(true);
            }}
          >
            Previous
          </button>
          <span>Page {previous.length + 1} · newest first</span>
          <button
            className="button button-secondary"
            disabled={!pagination.hasMore || loading}
            onClick={() => {
              setPrevious((old) => [...old, cursor]);
              setCursor(pagination.nextCursor);
              setLoading(true);
            }}
          >
            Next
          </button>
        </div>
      </section>
    </main>
  );
}
