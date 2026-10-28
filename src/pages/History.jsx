import { useEffect, useState } from "react";

function History() {
  const [urls, setUrls] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchUrls = async () => {
    try {
      const response = await fetch("http://localhost:5002/api/urls");
      const data = await response.json();

      setUrls(data.data || []);
    } catch (error) {
      console.error("Error loading URLs:", error);
      setUrls([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUrls();
  }, []);

  const deleteUrl = async (id) => {
    const confirmed = window.confirm(
      "Are you sure you want to delete this URL?"
    );

    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(
        `http://localhost:5002/api/urls/${id}`,
        {
          method: "DELETE",
        }
      );

      const data = await response.json();

      if (!response.ok) {
        alert(data.message || "Unable to delete URL.");
        return;
      }

      setUrls((currentUrls) =>
        currentUrls.filter((url) => url.id !== id)
      );
    } catch (error) {
      alert("Unable to connect to the server.");
    }
  };

  return (
    <main className="history-page">
      <section className="history-container">
        <p className="badge">YOUR LINKS</p>

        <h1>URL History</h1>

        <p className="subtitle">
          Manage your shortened links and track their performance.
        </p>

        {loading ? (
          <p className="message">Loading...</p>
        ) : urls.length === 0 ? (
          <div className="empty-state">
            <h2>No shortened URLs yet</h2>

            <p>
              Go back to the home page and create your first short link.
            </p>
          </div>
        ) : (
          <div className="url-list">
            {urls.map((item) => (
              <div className="url-card" key={item.id}>
                <div className="url-info">
                  <p className="original-url">
                    {item.original_url}
                  </p>

                  <a
                    href={`http://localhost:5002/api/short/${item.short_code}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    http://localhost:5002/api/short/
                    {item.short_code}
                  </a>

                  <p className="created-date">
                    Created:{" "}
                    {new Date(item.created_at).toLocaleString()}
                  </p>
                </div>

                <div className="url-actions">
                  <div className="clicks">
                    <strong>{item.clicks}</strong>
                    <span>clicks</span>
                  </div>

                  <button
                    className="delete-button"
                    onClick={() => deleteUrl(item.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

export default History;