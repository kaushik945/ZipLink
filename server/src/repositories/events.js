import { validateEvent } from '../validators/events.js';

export function eventRepository(pool) {
  return {
    async persist(input) {
      const event = validateEvent(input);
      const db = await pool.getConnection();
      try {
        await db.beginTransaction();
        // A row lock serializes deletion against event persistence; no event for a tombstone.
        const [links] = await db.execute(
          'SELECT id FROM urls WHERE id=? AND deleted_at IS NULL FOR UPDATE',
          [event.linkId],
        );
        if (!links.length) {
          await db.commit();
          return false;
        }
        const [result] = await db.execute(
          'INSERT IGNORE INTO click_events(event_id,link_id,occurred_at,device,browser,referrer,is_bot) VALUES (?,?,?,?,?,?,?)',
          [
            event.eventId,
            event.linkId,
            new Date(event.timestamp).toISOString().slice(0, 23).replace('T', ' '),
            event.device,
            event.browser,
            event.referrer,
            event.isBot,
          ],
        );
        if (result.affectedRows === 1)
          await db.execute('UPDATE urls SET clicks=clicks+1 WHERE id=?', [event.linkId]);
        await db.commit();
        return result.affectedRows === 1;
      } catch (error) {
        await db.rollback();
        throw error;
      } finally {
        db.release();
      }
    },
  };
}
