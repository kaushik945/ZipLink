import { assert } from '../utils/errors.js';

export function dateRange(query) {
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from ? new Date(query.from) : new Date(to.getTime() - 30 * 86400000);
  assert(
    typeof (query.from ?? '') === 'string' &&
      typeof (query.to ?? '') === 'string' &&
      Number.isFinite(+from) &&
      Number.isFinite(+to) &&
      from < to &&
      to - from <= 366 * 86400000,
    400,
    'INVALID_RANGE',
    'Choose a valid date range of at most 366 days.',
  );
  const sql = (value) => value.toISOString().slice(0, 23).replace('T', ' ');
  return { from: sql(from), to: sql(to) };
}
export function analyticsRepository(pool) {
  return {
    async report(userId, range, linkId = null) {
      const scope = 'u.user_id=? AND u.deleted_at IS NULL' + (linkId ? ' AND u.id=?' : '');
      const owner = linkId ? [userId, linkId] : [userId];
      const where = `${scope} AND e.occurred_at>=? AND e.occurred_at<?`;
      const args = [...owner, range.from, range.to];
      const [summary] = await pool.execute(
        `SELECT COUNT(*) totalClicks,COALESCE(SUM(e.is_bot),0) botClicks FROM click_events e JOIN urls u ON u.id=e.link_id WHERE ${where}`,
        args,
      );
      const [[links]] = await pool.execute(
        `SELECT COUNT(*) totalLinks,COALESCE(SUM(enabled=1 AND (expires_at IS NULL OR expires_at>UTC_TIMESTAMP(3))),0) activeLinks,COALESCE(SUM(clicks),0) lifetimeClicks FROM urls u WHERE ${scope}`,
        owner,
      );
      const [daily] = await pool.execute(
        `SELECT DATE_FORMAT(e.occurred_at,'%Y-%m-%d') day,COUNT(*) clicks FROM click_events e JOIN urls u ON u.id=e.link_id WHERE ${where} GROUP BY day ORDER BY day`,
        args,
      );
      const breakdown = async (column) => {
        const [rows] = await pool.execute(
          `SELECT e.${column} name,COUNT(*) clicks FROM click_events e JOIN urls u ON u.id=e.link_id WHERE ${where} GROUP BY e.${column} ORDER BY clicks DESC LIMIT 10`,
          args,
        );
        return rows;
      };
      const [devices, browsers, referrers] = await Promise.all(
        ['device', 'browser', 'referrer'].map(breakdown),
      );
      const [topLinks] = await pool.execute(
        `SELECT u.id,u.short_code,u.original_url,COUNT(*) clicks FROM click_events e JOIN urls u ON u.id=e.link_id WHERE ${where} GROUP BY u.id,u.short_code,u.original_url ORDER BY clicks DESC,u.id DESC LIMIT 10`,
        args,
      );
      return {
        ...summary[0],
        ...links,
        daily,
        devices,
        browsers,
        referrers,
        topLinks,
        range,
        consistency: 'eventual',
        includesBots: true,
      };
    },
  };
}
