import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
} from 'recharts';
import { request } from '../lib/api';
import Stats from '../components/Stats';
function chartData(rows, from, to, weekly) {
  const counts = new Map(rows.map((row) => [row.day, Number(row.clicks)]));
  const data = new Map();
  for (
    let stamp = Date.parse(from.slice(0, 10) + 'T00:00:00Z');
    stamp <= Date.parse(to.slice(0, 10) + 'T00:00:00Z');
    stamp += 86400000
  ) {
    const date = new Date(stamp);
    const day = date.toISOString().slice(0, 10);
    if (weekly) date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    const key = weekly ? date.toISOString().slice(0, 10) : day;
    data.set(key, (data.get(key) || 0) + (counts.get(day) || 0));
  }
  return [...data].map(([day, clicks]) => ({ day, clicks }));
}
function Breakdown({ title, rows }) {
  return (
    <section className="chart-card">
      <h2>{title}</h2>
      {rows.length ? (
        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ left: 12, right: 10 }}>
              <XAxis type="number" allowDecimals={false} />
              <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar
                dataKey="clicks"
                fill="#66665e"
                radius={[0, 3, 3, 0]}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="chart-empty">No events in this date range.</p>
      )}
    </section>
  );
}
export default function Analytics() {
  const [params] = useSearchParams();
  const linkId = params.get('link');
  const [days, setDays] = useState('30');
  const [weekly, setWeekly] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    const to = new Date();
    const from = new Date(+to - Number(days) * 86400000);
    const query = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
    request(
      `${linkId ? `/api/links/${encodeURIComponent(linkId)}/analytics` : '/api/analytics/overview'}?${query}`,
    )
      .then((report) => {
        if (active) {
          setData(report);
          setError('');
        }
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [days, linkId, refresh]);
  const series = useMemo(
    () => (data ? chartData(data.daily, data.range.from, data.range.to, weekly) : []),
    [data, weekly],
  );
  return (
    <main className="page-shell history-page">
      <div className="history-heading">
        <div>
          <p className="eyebrow">EVERY CONNECTION COUNTS</p>
          <h1>
            {linkId ? 'One link.' : 'Your reach.'}
            <br />
            <span>A clearer picture.</span>
          </h1>
          <p className="subtitle">
            Analytics update after background processing. All times are UTC.
          </p>
        </div>
        <div className="analytics-actions">
          <label>
            Range{' '}
            <select
              aria-label="Analytics date range"
              value={days}
              onChange={(e) => {
                setDays(e.target.value);
                setLoading(true);
              }}
            >
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </select>
          </label>
          <button
            className="button button-secondary"
            onClick={() => {
              setLoading(true);
              setRefresh((n) => n + 1);
            }}
          >
            Refresh
          </button>
          {linkId && (
            <Link className="text-link" to="/analytics">
              All links
            </Link>
          )}
        </div>
      </div>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <div className="empty-state" role="status">
          Loading analytics...
        </div>
      ) : (
        data &&
        !error && (
          <>
            <Stats summary={data} />
            <div className="analytics-totals">
              <p>
                <strong>{Number(data.totalClicks).toLocaleString()}</strong> clicks in selected
                range
              </p>
              <p>
                <strong>{Number(data.botClicks).toLocaleString()}</strong> detected bot clicks
                (included)
              </p>
            </div>
            <section className="chart-card">
              <div className="section-heading">
                <h2>Clicks over time</h2>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={weekly}
                    onChange={(e) => setWeekly(e.target.checked)}
                  />{' '}
                  Group by week
                </label>
              </div>
              {Number(data.totalClicks) ? (
                <div className="chart-container">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={series} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e5df" />
                      <XAxis dataKey="day" tick={{ fontSize: 10 }} minTickGap={25} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Area
                        type="monotone"
                        dataKey="clicks"
                        stroke="#33332c"
                        fill="#dfdfd6"
                        strokeWidth={2}
                        isAnimationActive={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="chart-empty">
                  No clicks yet. Share a link and refresh after the worker processes its events.
                </p>
              )}
            </section>
            <div className="breakdown-grid">
              <Breakdown title="Devices" rows={data.devices} />
              <Breakdown title="Browsers" rows={data.browsers} />
            </div>
            <section className="chart-card">
              <h2>Referrers</h2>
              {data.referrers.length ? (
                <ul className="analytics-list">
                  {data.referrers.map((row) => (
                    <li key={row.name}>
                      <span>{row.name}</span>
                      <strong>{row.clicks}</strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="chart-empty">No referrers recorded yet.</p>
              )}
            </section>
            <section className="chart-card">
              <h2>Top links</h2>
              {data.topLinks.length ? (
                <ul className="analytics-list">
                  {data.topLinks.map((item) => (
                    <li key={item.id}>
                      <Link to={`/analytics?link=${item.id}`}>
                        <strong>{item.short_code}</strong>
                        <span className="original-url">{item.original_url}</span>
                      </Link>
                      <strong>{item.clicks} clicks</strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="chart-empty">Your top-performing links will appear here.</p>
              )}
            </section>
            <p className="stats-notice">
              Totals include detected bots; bot detection is heuristic. Missing queue events are not
              counted. Lifetime totals may include legacy clicks without event details. Top
              breakdowns show up to 10 categories.
            </p>
          </>
        )
      )}
    </main>
  );
}
