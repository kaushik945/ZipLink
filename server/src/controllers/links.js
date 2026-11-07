import { id, linkInput, listInput } from '../validators/links.js';
import { dateRange } from '../repositories/analytics.js';

export function linkController({ links, analytics, producer, config, metrics }) {
  function present(row) {
    return {
      ...row,
      short_url: `${config.publicBaseUrl}/${row.short_code}`,
      enabled: Boolean(row.enabled),
    };
  }
  return {
    async create(req, res) {
      const row = await links.create(req.session.userId, linkInput(req.body));
      res.status(201).json({ success: true, data: present(row) });
    },
    async list(req, res) {
      const result = await links.list(req.session.userId, listInput(req.query));
      res.json({ success: true, data: result.data.map(present), pagination: result.pagination });
    },
    async details(req, res) {
      res.json({
        success: true,
        data: present(await links.owned(req.session.userId, id(req.params.id))),
      });
    },
    async update(req, res) {
      const row = await links.update(
        req.session.userId,
        id(req.params.id),
        linkInput(req.body, true),
      );
      res.json({ success: true, data: present(row) });
    },
    async remove(req, res) {
      await links.remove(req.session.userId, id(req.params.id));
      res.json({ success: true, data: null });
    },
    async redirect(req, res) {
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(req.params.shortCode))
        return res
          .status(404)
          .json({ success: false, error: { code: 'NOT_FOUND', message: 'Short link not found.' } });
      const row = await links.resolve(req.params.shortCode);
      producer.enqueue(row, req);
      metrics.redirects++;
      res.set('Cache-Control', 'no-store');
      res.set('Referrer-Policy', 'no-referrer');
      res.redirect(302, row.original_url);
    },
    async overview(req, res) {
      res.json({
        success: true,
        data: await analytics.report(req.session.userId, dateRange(req.query)),
      });
    },
    async analytics(req, res) {
      const linkId = id(req.params.id);
      await links.owned(req.session.userId, linkId);
      const report = await analytics.report(req.session.userId, dateRange(req.query), linkId);
      res.json({
        success: true,
        data: req.path.endsWith('/timeseries')
          ? { daily: report.daily, range: report.range, consistency: 'eventual' }
          : report,
      });
    },
  };
}
