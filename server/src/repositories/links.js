export function linkRepository(pool) {
  return {
    async insert(userId, item) {
      const [result] = await pool.execute(
        'INSERT INTO urls(user_id,original_url,short_code,expires_at,enabled) VALUES (?,?,?,?,?)',
        [userId, item.original_url, item.short_code, item.expires_at ?? null, item.enabled ?? true],
      );
      return this.owned(userId, result.insertId);
    },
    async owned(userId, id) {
      const [rows] = await pool.execute(
        'SELECT * FROM urls WHERE id=? AND user_id=? AND deleted_at IS NULL',
        [id, userId],
      );
      return rows[0];
    },
    async byCode(code) {
      const [rows] = await pool.execute(
        'SELECT id,original_url,short_code,enabled,expires_at,deleted_at FROM urls WHERE short_code=? LIMIT 1',
        [code],
      );
      return rows[0] || null;
    },
    async list(userId, { limit, cursor, search, status }) {
      const conditions = ['user_id=?', 'deleted_at IS NULL'];
      const params = [userId];
      if (cursor) {
        conditions.push('(created_at < ? OR (created_at = ? AND id < ?))');
        params.push(cursor.t, cursor.t, cursor.id);
      }
      if (search) {
        conditions.push('(LOCATE(?, original_url)>0 OR LOCATE(?, short_code)>0)');
        params.push(search, search);
      }
      if (status === 'enabled')
        conditions.push('enabled=1 AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP(3))');
      if (status === 'disabled') conditions.push('enabled=0');
      if (status === 'expired') conditions.push('expires_at <= UTC_TIMESTAMP(3)');
      // limit is validated and bounded before interpolation; all user data uses placeholders.
      const [rows] = await pool.execute(
        `SELECT * FROM urls WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC,id DESC LIMIT ${limit + 1}`,
        params,
      );
      const hasMore = rows.length > limit;
      const data = rows.slice(0, limit);
      const last = data.at(-1);
      return {
        data,
        pagination: {
          hasMore,
          nextCursor: hasMore
            ? Buffer.from(JSON.stringify({ t: last.created_at, id: last.id })).toString('base64url')
            : null,
        },
      };
    },
    async update(userId, id, item) {
      const entries = Object.entries(item);
      const [result] = await pool.execute(
        `UPDATE urls SET ${entries.map(([key]) => `${key}=?`).join(',')} WHERE id=? AND user_id=? AND deleted_at IS NULL`,
        [...entries.map(([, value]) => value), id, userId],
      );
      return result.affectedRows > 0;
    },
    async remove(userId, id) {
      const [result] = await pool.execute(
        'UPDATE urls SET deleted_at=UTC_TIMESTAMP(3),enabled=0 WHERE id=? AND user_id=? AND deleted_at IS NULL',
        [id, userId],
      );
      return result.affectedRows > 0;
    },
  };
}
