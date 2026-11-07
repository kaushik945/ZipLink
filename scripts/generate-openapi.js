import { writeFileSync } from 'node:fs';
import { format } from 'prettier';
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema) => ({ 'application/json': { schema } });
const response = (description, schema) => ({
  description,
  ...(schema ? { content: json(schema) } : {}),
});
const envelope = (data) => ({
  type: 'object',
  required: ['success', 'data'],
  properties: { success: { const: true }, data },
});
const errors = Object.fromEntries(
  [400, 401, 403, 404, 409, 413, 429, 500, 503].map((status) => [
    status,
    response(
      {
        400: 'Invalid payload, date range or cursor',
        401: 'Authentication required or invalid login',
        403: 'Invalid CSRF token or disallowed origin',
        404: 'Endpoint or owned link not found',
        409: 'Email or alias already exists',
        413: 'JSON body exceeds 16 KB',
        429: 'Rate limit exceeded; Retry-After header is seconds',
        500: 'Unexpected internal error; no SQL or secrets exposed',
        503: 'Session/rate service unavailable or allocation retries exhausted',
      }[status],
      ref('Error'),
    ),
  ]),
);
errors[429].headers = {
  'Retry-After': { schema: { type: 'integer' }, description: 'Seconds to wait before retrying' },
};
const csrf = {
  in: 'header',
  name: 'X-CSRF-Token',
  required: true,
  schema: { type: 'string', minLength: 64, maxLength: 64 },
  description:
    'Fetch /api/auth/me with the same cookie jar. Login/registration rotate both session and token.',
};
const id = {
  in: 'path',
  name: 'id',
  required: true,
  schema: { type: 'integer', minimum: 1, maximum: 2147483647 },
};
const dates = ['from', 'to'].map((name) => ({
  in: 'query',
  name,
  schema: { type: 'string', format: 'date-time' },
  description: `${name === 'from' ? 'Inclusive' : 'Exclusive'} UTC timestamp; default last 30 days; maximum range 366 days.`,
}));
function operation(
  summary,
  schema,
  {
    method = 'get',
    input,
    parameters = [],
    publicRoute = false,
    status = 200,
    description = '',
  } = {},
) {
  return {
    summary,
    description,
    security: publicRoute ? [] : [{ cookieSession: [] }],
    parameters: [...parameters, ...(!['get', 'head'].includes(method) ? [csrf] : [])],
    ...(input ? { requestBody: { required: true, content: json(ref(input)) } } : {}),
    responses: { [status]: response('Success', schema), ...errors },
  };
}
const paths = {
  '/health': {
    get: operation(
      'Liveness without dependencies',
      envelope({ type: 'object', properties: { status: { const: 'live' } } }),
      { publicRoute: true },
    ),
  },
  '/ready': {
    get: operation('Readiness: MySQL reachable and Redis ready', envelope({ type: 'object' }), {
      publicRoute: true,
    }),
  },
  '/api/auth/me': {
    get: operation(
      'Get profile and CSRF token (also for anonymous sessions)',
      envelope(ref('Session')),
      {
        publicRoute: true,
        description:
          'Creates an anonymous cookie-backed CSRF session if necessary. 300 requests per minute per IP or authenticated user.',
      },
    ),
  },
  '/api/auth/register': {
    post: operation('Register and sign in', envelope(ref('Session')), {
      method: 'post',
      input: 'Credentials',
      publicRoute: true,
      status: 201,
      description:
        '5 attempts/hour/IP. Passwords are bcrypt-hashed. CSRF required even before login.',
    }),
  },
  '/api/auth/login': {
    post: operation('Sign in and rotate session', envelope(ref('Session')), {
      method: 'post',
      input: 'Credentials',
      publicRoute: true,
      description:
        '10 attempts/15 minutes/IP, including signed-in callers. Generic invalid-login response.',
    }),
  },
  '/api/auth/logout': {
    post: operation('Invalidate session in Redis and clear cookie', envelope({ type: 'null' }), {
      method: 'post',
    }),
  },
  '/api/links': {
    get: operation(
      'List only owned non-deleted links',
      {
        allOf: [
          envelope({ type: 'array', items: ref('Link') }),
          { type: 'object', properties: { pagination: ref('Pagination') } },
        ],
      },
      {
        parameters: [
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          },
          {
            name: 'cursor',
            in: 'query',
            schema: { type: 'string' },
            description:
              'Opaque nextCursor from preceding page; stable created_at DESC, id DESC order. Keep filters unchanged.',
          },
          {
            name: 'search',
            in: 'query',
            schema: { type: 'string', maxLength: 100 },
            description:
              'Literal substring of destination or alias; no SQL wildcard interpretation.',
          },
          {
            name: 'status',
            in: 'query',
            schema: {
              type: 'string',
              enum: ['all', 'enabled', 'disabled', 'expired'],
              default: 'all',
            },
          },
        ],
        description: '300 management requests/minute/user. Legacy unowned links are never listed.',
      },
    ),
    post: operation('Create an owned link', envelope(ref('Link')), {
      method: 'post',
      input: 'CreateLink',
      status: 201,
      description:
        '30 creations/minute/user, in addition to management limit. Same destinations may produce different links. Base62 codes and aliases share one case-sensitive unique namespace. Tombstones cannot be reused.',
    }),
  },
  '/api/links/{id}': {
    get: operation('Retrieve owned link', envelope(ref('Link')), { parameters: [id] }),
    patch: operation('Update destination, enabled state or expiration', envelope(ref('Link')), {
      method: 'patch',
      input: 'UpdateLink',
      parameters: [id],
      description:
        'Aliases and ownership are immutable. Cache invalidation is best effort; default maximum stale cache lifetime is 60 seconds.',
    }),
    delete: operation(
      'Soft delete owned link and retain code tombstone',
      envelope({ type: 'null' }),
      { method: 'delete', parameters: [id] },
    ),
  },
  '/api/analytics/overview': {
    get: operation('Owner-wide analytics', envelope(ref('Analytics')), {
      parameters: dates,
      description:
        'Eventually consistent. Range totals include bots, exclude deleted links. Lifetime counters may include legacy counts. No raw IPs or user agents. Breakdowns limited to top 10 categories.',
    }),
  },
  '/api/links/{id}/analytics': {
    get: operation('Owned-link analytics', envelope(ref('Analytics')), {
      parameters: [id, ...dates],
    }),
  },
  '/api/links/{id}/analytics/timeseries': {
    get: operation(
      'Owned-link daily UTC counts',
      envelope({
        type: 'object',
        properties: {
          daily: { type: 'array', items: ref('Day') },
          range: ref('Range'),
          consistency: { const: 'eventual' },
        },
      }),
      { parameters: [id, ...dates] },
    ),
  },
};
const redirect = {
  summary: 'Resolve public link without a session',
  description:
    'GET records an asynchronous click attempt. HEAD redirects without recording a click. 6000 requests/minute/IP; fails open if Redis rate service is unavailable. Cache-aside with MySQL fallback. Disabled, expired, deleted and unsafe legacy links return 410; never-created links return 404. Queue failure does not prevent a redirect. No destination is fetched by this server.',
  security: [],
  parameters: [
    {
      name: 'shortCode',
      in: 'path',
      required: true,
      schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,40}$' },
    },
  ],
  responses: {
    302: {
      description: 'Temporary redirect',
      headers: {
        Location: { schema: { type: 'string', format: 'uri' } },
        'Cache-Control': { schema: { const: 'no-store' } },
      },
    },
    404: errors[404],
    410: response('Expired, disabled, deleted or policy-blocked legacy link', ref('Error')),
    429: errors[429],
    500: errors[500],
  },
};
for (const path of ['/{shortCode}', '/api/short/{shortCode}'])
  paths[path] = {
    get: redirect,
    head: {
      ...redirect,
      description: 'Same resolution as GET, without a click event or response body.',
    },
  };
paths['/api/shorten'] = {
  post: {
    ...paths['/api/links'].post,
    deprecated: true,
    summary: 'Compatibility alias for POST /api/links (authentication now required)',
  },
};
paths['/api/urls'] = { get: { ...paths['/api/links'].get, deprecated: true } };
paths['/api/urls/{id}'] = { delete: { ...paths['/api/links/{id}'].delete, deprecated: true } };
const fields = {
  originalUrl: {
    type: 'string',
    format: 'uri',
    maxLength: 4096,
    example: 'https://example.com/a/long/path?campaign=launch',
    description:
      'HTTP(S), public hostname, no IP literals/credentials/control characters. WHATWG canonicalization; path/query order and fragment retained.',
  },
  expiresAt: { type: ['string', 'null'], format: 'date-time', example: '2030-01-01T00:00:00Z' },
  enabled: { type: 'boolean', default: true },
};
const spec = {
  openapi: '3.1.0',
  info: {
    title: 'ZipLink API',
    version: '2.0.0',
    description:
      'Cookie sessions, synchronizer-token CSRF, owner-only link management and eventually consistent analytics. Use the same cookie jar for /api/auth/me and subsequent calls. Production uses Secure __Host-ziplink.sid; development uses ziplink.sid. Unexpected origins are rejected. All writes require X-CSRF-Token. Redis failures fail closed for management, fail open for public redirect rate limiting.',
  },
  servers: [
    {
      url: 'http://localhost:5002',
      description: 'Local API; configure PUBLIC_BASE_URL for deployment',
    },
  ],
  paths,
  components: {
    securitySchemes: {
      cookieSession: {
        type: 'apiKey',
        in: 'cookie',
        name: 'ziplink.sid',
        description: 'Production cookie name is __Host-ziplink.sid.',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        required: ['success', 'error'],
        properties: {
          success: { const: false },
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              requestId: { type: 'string' },
            },
          },
        },
        example: { success: false, error: { code: 'NOT_FOUND', message: 'Link not found.' } },
      },
      Credentials: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email', maxLength: 254 },
          password: {
            type: 'string',
            minLength: 12,
            description: 'Maximum 72 UTF-8 bytes (bcrypt input limit).',
          },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: ['integer', 'string'] },
          email: { type: 'string', format: 'email' },
          created_at: { type: 'string', description: 'MySQL UTC datetime when present' },
        },
      },
      Session: {
        type: 'object',
        properties: {
          user: { anyOf: [ref('User'), { type: 'null' }] },
          csrfToken: { type: 'string' },
        },
      },
      CreateLink: {
        type: 'object',
        additionalProperties: false,
        required: ['originalUrl'],
        properties: {
          ...fields,
          alias: {
            type: 'string',
            pattern: '^[A-Za-z0-9_-]{3,40}$',
            example: 'Launch-2027',
            description: 'Case sensitive. Reserved route names are forbidden case insensitively.',
          },
        },
      },
      UpdateLink: {
        type: 'object',
        additionalProperties: false,
        minProperties: 1,
        properties: fields,
      },
      Link: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          user_id: { type: ['integer', 'string'] },
          original_url: { type: 'string' },
          short_code: { type: 'string' },
          short_url: { type: 'string', format: 'uri' },
          enabled: { type: 'boolean' },
          clicks: { type: ['integer', 'string'] },
          expires_at: { type: ['string', 'null'] },
          created_at: { type: 'string' },
          updated_at: { type: 'string' },
          deleted_at: { type: 'null' },
        },
      },
      Pagination: {
        type: 'object',
        properties: { hasMore: { type: 'boolean' }, nextCursor: { type: ['string', 'null'] } },
      },
      Day: {
        type: 'object',
        properties: { day: { type: 'string', format: 'date' }, clicks: { type: 'integer' } },
      },
      Range: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } },
      Breakdown: {
        type: 'object',
        properties: { name: { type: 'string' }, clicks: { type: 'integer' } },
      },
      Analytics: {
        type: 'object',
        properties: {
          totalClicks: { type: 'integer' },
          botClicks: { type: ['integer', 'string'] },
          totalLinks: { type: 'integer' },
          activeLinks: { type: ['integer', 'string'] },
          lifetimeClicks: { type: ['integer', 'string'] },
          daily: { type: 'array', items: ref('Day') },
          devices: { type: 'array', items: ref('Breakdown') },
          browsers: { type: 'array', items: ref('Breakdown') },
          referrers: { type: 'array', items: ref('Breakdown') },
          topLinks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'integer' },
                short_code: { type: 'string' },
                original_url: { type: 'string' },
                clicks: { type: 'integer' },
              },
            },
          },
          range: ref('Range'),
          consistency: { const: 'eventual' },
          includesBots: { const: true },
        },
      },
    },
  },
};
writeFileSync(
  new URL('../server/openapi.json', import.meta.url),
  await format(JSON.stringify(spec), { parser: 'json', printWidth: 100 }),
);
