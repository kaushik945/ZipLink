import session from 'express-session';
import pino from 'pino';
import { loadConfig } from '../src/config/env.js';
import { linkService } from '../src/services/links.js';
import { createApp } from '../src/app.js';

export const config = loadConfig({
  SESSION_SECRET: 'test-only-secret-with-more-than-32-chars',
  BCRYPT_ROUNDS: '10',
});
export const logger = pino({ level: 'silent' });
export const noCache = { resolve: (code, load) => load(), invalidate: async () => {} };
export function counters() {
  return {
    cacheHits: 0,
    cacheMisses: 0,
    cacheErrors: 0,
    cacheInvalidationFailures: 0,
    eventsAccepted: 0,
    eventsDropped: 0,
    redirects: 0,
    rateLimitErrors: 0,
  };
}
export function memoryRepository() {
  const rows = new Map();
  let sequence = 0;
  return {
    rows,
    async insert(userId, item) {
      if ([...rows.values()].some((row) => row.short_code === item.short_code))
        throw Object.assign(new Error(), { code: 'ER_DUP_ENTRY' });
      const row = {
        id: ++sequence,
        user_id: userId,
        clicks: 0,
        enabled: true,
        created_at: '2026-01-01 00:00:00',
        ...item,
      };
      rows.set(row.id, row);
      return row;
    },
    async owned(userId, id) {
      const row = rows.get(Number(id));
      return row?.user_id === userId && !row.deleted_at ? row : null;
    },
    async byCode(code) {
      return [...rows.values()].find((row) => row.short_code === code) || null;
    },
    async list(userId) {
      return {
        data: [...rows.values()].filter((row) => row.user_id === userId && !row.deleted_at),
        pagination: { hasMore: false, nextCursor: null },
      };
    },
    async update(userId, id, item) {
      const row = await this.owned(userId, id);
      if (row) Object.assign(row, item);
      return !!row;
    },
    async remove(userId, id) {
      const row = await this.owned(userId, id);
      if (row) row.deleted_at = new Date().toISOString();
      return !!row;
    },
  };
}
export function testApp(overrides = {}) {
  const repository = overrides.repository || memoryRepository();
  const accounts = new Map();
  let sequence = 0;
  const users = overrides.users || {
    async create(email, password_hash) {
      if (accounts.has(email)) throw Object.assign(new Error(), { code: 'ER_DUP_ENTRY' });
      const row = { id: ++sequence, email, password_hash };
      accounts.set(email, row);
      return row;
    },
    async findByEmail(email) {
      return accounts.get(email);
    },
    async findById(id) {
      const row = [...accounts.values()].find((account) => account.id === id);
      return row ? { id: row.id, email: row.email } : null;
    },
  };
  const deps = {
    config,
    logger,
    pool: { query: async () => [] },
    redis: { isReady: true, eval: async () => [1, 60000] },
    sessionStore: new session.MemoryStore(),
    metrics: counters(),
    producer: { enqueue() {} },
    analytics: { report: async () => ({ daily: [], totalClicks: 0 }) },
    links: linkService({ config, repository, cache: noCache }),
    users,
    ...overrides,
  };
  return { app: createApp(deps), deps, repository };
}
