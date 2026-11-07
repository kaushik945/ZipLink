import net from 'node:net';
import { assert } from '../utils/errors.js';

export const RESERVED = new Set([
  'api',
  'health',
  'ready',
  'metrics',
  'favicon',
  'robots',
  'admin',
  'login',
  'register',
  'logout',
  'history',
  'analytics',
]);
export function normalizeUrl(value) {
  assert(
    typeof value === 'string' &&
      value.length <= 4096 &&
      [...value].every(
        (character) =>
          character.charCodeAt(0) > 32 && character.charCodeAt(0) !== 127 && character !== '\\',
      ),
    400,
    'INVALID_URL',
    'Use an HTTP(S) URL without whitespace, control characters or backslashes (maximum 4096 characters).',
  );
  let url;
  try {
    url = new URL(value);
  } catch {
    assert(false, 400, 'INVALID_URL', 'Invalid destination URL.');
  }
  assert(
    ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password,
    400,
    'INVALID_URL',
    'Only HTTP(S) URLs without embedded credentials are allowed.',
  );
  const host = url.hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  // Conservative abuse guard, not an SSRF boundary: this application never fetches destinations.
  assert(
    !net.isIP(host) &&
      host.includes('.') &&
      !/(^|\.)(localhost|local|internal|test|invalid|onion)$/.test(host),
    400,
    'UNSAFE_DESTINATION',
    'Use a public hostname; IP literals and local/internal destinations are not allowed.',
  );
  assert(url.href.length <= 4096, 400, 'INVALID_URL', 'Normalized URL exceeds 4096 characters.');
  return url.href;
}
export function alias(value) {
  assert(
    typeof value === 'string' &&
      /^[A-Za-z0-9_-]{3,40}$/.test(value) &&
      !RESERVED.has(value.toLowerCase()),
    400,
    'INVALID_ALIAS',
    'Alias must be 3-40 letters, digits, hyphens or underscores and must not be a reserved route.',
  );
  return value;
}
export function linkInput(body, partial = false) {
  assert(
    body && typeof body === 'object' && !Array.isArray(body),
    400,
    'INVALID_BODY',
    'A JSON object is required.',
  );
  const allowed = partial
    ? ['originalUrl', 'expiresAt', 'enabled']
    : ['originalUrl', 'expiresAt', 'enabled', 'alias'];
  assert(
    Object.keys(body).length > 0 &&
      Object.keys(body).every((key) => allowed.includes(key) && body[key] !== undefined),
    400,
    'INVALID_BODY',
    'Unknown or immutable fields.',
  );
  const result = {};
  if (!partial || body.originalUrl !== undefined)
    result.original_url = normalizeUrl(body.originalUrl);
  if (body.alias !== undefined) result.short_code = alias(body.alias);
  if (body.enabled !== undefined) {
    assert(typeof body.enabled === 'boolean', 400, 'INVALID_BODY', 'enabled must be a boolean.');
    result.enabled = body.enabled;
  }
  if (body.expiresAt !== undefined) {
    assert(
      body.expiresAt === null ||
        (typeof body.expiresAt === 'string' &&
          /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(body.expiresAt) &&
          Number.isFinite(Date.parse(body.expiresAt)) &&
          Date.parse(body.expiresAt) > Date.now()),
      400,
      'INVALID_EXPIRATION',
      'expiresAt must be null or a future ISO timestamp with timezone.',
    );
    result.expires_at =
      body.expiresAt === null
        ? null
        : new Date(body.expiresAt).toISOString().slice(0, 23).replace('T', ' ');
  }
  return result;
}
export function id(value) {
  assert(
    typeof value === 'string' && /^[1-9]\d{0,9}$/.test(value) && Number(value) <= 2147483647,
    400,
    'INVALID_ID',
    'Invalid link ID.',
  );
  return Number(value);
}
export function listInput(query) {
  const limit = query.limit === undefined ? 20 : Number(query.limit);
  assert(
    Number.isSafeInteger(limit) && limit >= 1 && limit <= 100,
    400,
    'INVALID_LIMIT',
    'limit must be 1-100.',
  );
  const search = query.search || '';
  assert(
    typeof search === 'string' &&
      search.length <= 100 &&
      ['all', 'enabled', 'disabled', 'expired'].includes(query.status || 'all'),
    400,
    'INVALID_FILTER',
    'Invalid search or status filter.',
  );
  let cursor = null;
  if (query.cursor !== undefined) {
    try {
      assert(
        typeof query.cursor === 'string' && query.cursor.length <= 300,
        400,
        'INVALID_CURSOR',
        'Invalid cursor.',
      );
      cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString());
    } catch {
      assert(false, 400, 'INVALID_CURSOR', 'Invalid cursor.');
    }
    assert(
      cursor &&
        typeof cursor.t === 'string' &&
        /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d{1,6})?$/.test(cursor.t) &&
        Number.isFinite(sqlTime(cursor.t)) &&
        Number.isSafeInteger(cursor.id) &&
        cursor.id > 0 &&
        cursor.id <= 2147483647,
      400,
      'INVALID_CURSOR',
      'Invalid cursor.',
    );
  }
  return { limit, search, status: query.status || 'all', cursor };
}
export function sqlTime(value) {
  return value
    ? new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`).getTime()
    : null;
}
