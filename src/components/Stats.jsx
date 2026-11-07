import Icon from './Icon';
export default function Stats({ summary, unavailable, loading }) {
  return (
    <section className="stats" aria-label="Link statistics">
      {[
        ['link', 'Links created', summary?.totalLinks, 'Your non-deleted links'],
        [
          'chart',
          'Lifetime clicks',
          summary?.lifetimeClicks,
          'Includes legacy counters and detected bots',
        ],
        ['globe', 'Active links', summary?.activeLinks, 'Enabled and not expired'],
      ].map(([icon, label, value, caption]) => (
        <article className="stat-card" key={label}>
          <div className="stat-label">
            <span>{label}</span>
            <Icon name={icon} size={18} />
          </div>
          <strong>
            {loading || unavailable || value == null ? '\u2014' : Number(value).toLocaleString()}
          </strong>
          <p>{caption}</p>
        </article>
      ))}
    </section>
  );
}
