import { useEffect, useState } from "react";

function Home() {
  const [url, setUrl] = useState("");
  const [shortUrl, setShortUrl] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const [stats, setStats] = useState({
    totalUrls: 0,
    totalClicks: 0,
  });

  const loadStats = async () => {
    try {
      const response = await fetch("http://localhost:5002/api/urls");
      const data = await response.json();

      const urls = data.data || [];

      const totalClicks = urls.reduce(
        (total, item) => total + Number(item.clicks),
        0
      );

      setStats({
        totalUrls: urls.length,
        totalClicks,
      });
    } catch (error) {
      console.error("Unable to load statistics:", error);
    }
  };

  useEffect(() => {
    loadStats();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!url.trim()) {
      setMessage("Please enter a URL.");
      return;
    }

    setLoading(true);
    setMessage("");
    setShortUrl("");

    try {
      const response = await fetch(
        "http://localhost:5002/api/shorten",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            originalUrl: url,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        setMessage(data.message || "Something went wrong.");
        return;
      }

      setShortUrl(
        `http://localhost:5002/api/short/${data.data.shortCode || data.data.short_code}`
      );

      setMessage(data.message);

      setUrl("");

      loadStats();
    } catch (error) {
      setMessage(
        "Unable to connect to the server. Make sure the backend is running."
      );
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(shortUrl);
    setMessage("Short URL copied!");
  };

  return (
    <main className="home">
      <section className="hero">
        <p className="badge">URL SHORTENER</p>

        <h1>
          Make your links
          <br />
          <span>short & simple.</span>
        </h1>

        <p className="subtitle">
          Transform long URLs into short, shareable links in seconds.
        </p>

        <form onSubmit={handleSubmit} className="shortener-form">
          <input
            type="url"
            placeholder="Paste your long URL here..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />

          <button type="submit" disabled={loading}>
            {loading ? "Shortening..." : "Shorten URL"}
          </button>
        </form>

        {message && <p className="message">{message}</p>}

        {shortUrl && (
          <div className="result">
            <div>
              <p>Your shortened URL:</p>

              <a
                href={shortUrl}
                target="_blank"
                rel="noreferrer"
              >
                {shortUrl}
              </a>
            </div>

            <button onClick={copyToClipboard}>
              Copy
            </button>
          </div>
        )}
      </section>

      <section className="stats">
        <div className="stat-card">
          <strong>{stats.totalUrls}</strong>
          <span>Total URLs</span>
        </div>

        <div className="stat-card">
          <strong>{stats.totalClicks}</strong>
          <span>Total Clicks</span>
        </div>

        <div className="stat-card">
          <strong>{stats.totalUrls}</strong>
          <span>Active Links</span>
        </div>
      </section>

      <section className="features">
        <div className="feature-card">
          <div className="feature-icon">⚡</div>

          <h3>Fast</h3>

          <p>
            Create short links instantly and share them anywhere.
          </p>
        </div>

        <div className="feature-card">
          <div className="feature-icon">🔗</div>

          <h3>Simple</h3>

          <p>
            Turn long URLs into clean, easy-to-share links.
          </p>
        </div>

        <div className="feature-card">
          <div className="feature-icon">📊</div>

          <h3>Trackable</h3>

          <p>
            Monitor how many times your shortened links are clicked.
          </p>
        </div>
      </section>
    </main>
  );
}

export default Home;