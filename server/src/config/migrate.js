import { pathToFileURL } from 'node:url';
import { loadConfig } from './env.js';
import { createPool, logger } from './resources.js';
import * as foundation from '../../migrations/001-foundation.js';
import * as analytics from '../../migrations/002-analytics.js';

export async function migrate(pool) {
  const db = await pool.getConnection();
  try {
    const [[lock]] = await db.query(
      "SELECT GET_LOCK(CONCAT(DATABASE(), ':ziplink:migrate'), 30) acquired",
    );
    if (Number(lock.acquired) !== 1) throw new Error('Could not acquire migration lock');
    await db.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(100) PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB',
    );
    for (const [version, migration] of [
      ['001-foundation', foundation],
      ['002-analytics', analytics],
    ]) {
      const [rows] = await db.execute('SELECT version FROM schema_migrations WHERE version=?', [
        version,
      ]);
      if (!rows.length) {
        await migration.up(db);
        await db.execute('INSERT INTO schema_migrations(version) VALUES (?)', [version]);
        logger.info({ version }, 'Migration applied');
      }
    }
  } finally {
    await db.query("SELECT RELEASE_LOCK(CONCAT(DATABASE(), ':ziplink:migrate'))");
    db.release();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pool = createPool(loadConfig());
  try {
    await migrate(pool);
  } finally {
    await pool.end();
  }
}
