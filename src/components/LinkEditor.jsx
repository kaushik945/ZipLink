import { useState } from 'react';
import { request } from '../lib/api';
export default function LinkEditor({ item, onSave, onCancel }) {
  const [url, setUrl] = useState(item.original_url);
  const [expiresAt, setExpiresAt] = useState('');
  const [changeExpiry, setChangeExpiry] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = await request(`/api/links/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          originalUrl: url,
          ...(changeExpiry
            ? { expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null }
            : {}),
        }),
      });
      onSave(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="link-editor" onSubmit={submit}>
      <label htmlFor={`edit-${item.id}`}>Destination URL</label>
      <input
        className="field"
        id={`edit-${item.id}`}
        type="url"
        required
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        maxLength={4096}
      />
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={changeExpiry}
          onChange={(e) => setChangeExpiry(e.target.checked)}
        />{' '}
        Change expiration (leave date empty to remove it)
      </label>
      {changeExpiry && (
        <input
          aria-label="New expiration"
          className="field"
          type="datetime-local"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
        />
      )}
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      <div className="editor-actions">
        <button className="button button-primary" disabled={busy}>
          {busy ? 'Saving...' : 'Save changes'}
        </button>
        <button className="button button-secondary" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
