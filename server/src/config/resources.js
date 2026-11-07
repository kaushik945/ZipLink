import mysql from 'mysql2/promise';
import { createClient } from 'redis';
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: [
    'req.headers.cookie',
    'req.headers.authorization',
    'req.headers.x-csrf-token',
    'password',
    'password_hash',
    'secret',
  ],
});
export function createPool(config) {
  const pool = mysql.createPool(config.db);
  // mysql2's timezone option only controls JS conversion, not MySQL TIMESTAMP/session time.
  // Queue this before the first query on every new physical connection.
  pool.on('connection', (connection) => {
    connection.query("SET time_zone = '+00:00'", (error) => {
      if (error) {
        logger.error({ code: error.code }, 'Could not initialize UTC database session');
        connection.destroy();
      }
    });
  });
  return pool;
}
export function createRedis(config) {
  const client = createClient({
    url: config.redisUrl,
    disableOfflineQueue: true,
    commandsQueueMaxLength: 1000,
    commandOptions: { timeout: 1000 },
    socket: {
      connectTimeout: 2000,
      reconnectStrategy: (retries) => Math.min(100 * 2 ** Math.min(retries, 5), 3000),
    },
  });
  client.on('error', (error) => logger.error({ code: error.code }, 'Redis connection error'));
  return client;
}
export function queueConnection(config, worker = false) {
  const url = new URL(config.redisUrl);
  return {
    host: url.hostname.replace(/^\[|\]$/g, ''),
    port: Number(url.port || 6379),
    username: decodeURIComponent(url.username) || undefined,
    password: decodeURIComponent(url.password) || undefined,
    db: Number(url.pathname.slice(1) || 0),
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
    maxRetriesPerRequest: worker ? null : 1,
    enableOfflineQueue: worker,
    connectTimeout: 2000,
    ...(!worker ? { commandTimeout: 1500 } : {}),
  };
}
