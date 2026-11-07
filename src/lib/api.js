export const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:5002').replace(
  /\/$/,
  '',
);
export const shortLink = (item) =>
  item.short_url ||
  `${API_BASE}/api/short/${encodeURIComponent(item.short_code || item.shortCode)}`;
let csrfToken = null;
let sessionRequest = null;
export function requestPage(path, options = {}) {
  // StrictMode and simultaneous writes must not create competing anonymous cookie sessions.
  if (path === '/api/auth/me' && (!options.method || options.method === 'GET')) {
    if (!sessionRequest) {
      sessionRequest = performRequest(path, options).finally(() => {
        sessionRequest = null;
      });
    }
    return sessionRequest;
  }
  return performRequest(path, options);
}
async function performRequest(path, options) {
  const method = options.method || 'GET';
  if (!['GET', 'HEAD'].includes(method) && !csrfToken) await requestPage('/api/auth/me');
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      credentials: 'include',
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
        ...(!['GET', 'HEAD'].includes(method) ? { 'X-CSRF-Token': csrfToken || '' } : {}),
      },
    });
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error('The server returned an unexpected response.');
  }
  if (body.data?.csrfToken) csrfToken = body.data.csrfToken;
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('ziplink:unauthenticated'));
    if (body.error?.code === 'CSRF') csrfToken = null;
    const error = new Error(
      body.error?.message || body.message || 'Something went wrong. Try again.',
    );
    error.status = response.status;
    throw error;
  }
  if (path === '/api/auth/logout') csrfToken = null;
  return body;
}
export async function request(path, options) {
  return (await requestPage(path, options)).data;
}
