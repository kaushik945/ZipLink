export async function up(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(254) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB`);
  await db.query(`CREATE TABLE IF NOT EXISTS urls (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, original_url TEXT NOT NULL,
    short_code VARCHAR(20) NOT NULL UNIQUE, clicks BIGINT UNSIGNED NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`);
  // Every step can be repeated after an interrupted MySQL DDL migration (DDL autocommits).
  for (const [column, definition] of Object.entries({
    user_id: 'BIGINT UNSIGNED NULL',
    expires_at: 'DATETIME(3) NULL',
    enabled: 'BOOLEAN NOT NULL DEFAULT TRUE',
    deleted_at: 'DATETIME(3) NULL',
    updated_at: 'DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)',
  })) {
    const [rows] = await db.execute(
      'SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=?',
      ['urls', column],
    );
    if (!rows.length) await db.query(`ALTER TABLE urls ADD COLUMN ${column} ${definition}`);
  }
  await db.query('UPDATE urls SET clicks=0 WHERE clicks IS NULL');
  await db.query(
    'ALTER TABLE urls MODIFY short_code VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, MODIFY clicks BIGINT UNSIGNED NOT NULL DEFAULT 0',
  );
  const [fk] = await db.execute(
    'SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND table_name=? AND constraint_name=?',
    ['urls', 'fk_urls_user'],
  );
  if (!fk.length)
    await db.query(
      'ALTER TABLE urls ADD CONSTRAINT fk_urls_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT',
    );
  for (const [name, columns] of Object.entries({
    idx_urls_owner_created: '(user_id, deleted_at, created_at DESC, id DESC)',
    idx_urls_created: '(created_at, id)',
  })) {
    const [rows] = await db.execute(
      'SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name=? AND index_name=?',
      ['urls', name],
    );
    if (!rows.length) await db.query(`CREATE INDEX ${name} ON urls ${columns}`);
  }
}
