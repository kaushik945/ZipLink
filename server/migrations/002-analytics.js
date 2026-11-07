export async function up(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS click_events (
    event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    link_id INT NOT NULL, occurred_at DATETIME(3) NOT NULL,
    device VARCHAR(16) NOT NULL, browser VARCHAR(24) NOT NULL,
    referrer VARCHAR(253) NOT NULL, is_bot BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT fk_events_link FOREIGN KEY (link_id) REFERENCES urls(id) ON DELETE CASCADE,
    INDEX idx_events_link_time (link_id, occurred_at), INDEX idx_events_time (occurred_at, link_id)
  ) ENGINE=InnoDB`);
}
