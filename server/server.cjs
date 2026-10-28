const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const mysql = require("mysql2/promise");
require("dotenv").config();

const app = express();
const PORT = 5002;

app.use(cors());
app.use(express.json());

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "url_shortener",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

app.get("/", (req, res) => {
  res.json({
    message: "URL Shortener backend is running",
  });
});

app.post("/api/shorten", async (req, res) => {
  const { originalUrl } = req.body;

  if (!originalUrl) {
    return res.status(400).json({
      success: false,
      message: "Please provide a URL.",
    });
  }

  try {
    new URL(originalUrl);
  } catch {
    return res.status(400).json({
      success: false,
      message: "Please provide a valid URL.",
    });
  }

  try {
    const [existing] = await pool.execute(
      "SELECT * FROM urls WHERE original_url = ? LIMIT 1",
      [originalUrl]
    );

    if (existing.length > 0) {
      return res.json({
        success: true,
        message: "URL already shortened.",
        data: existing[0],
      });
    }

    const shortCode = crypto.randomBytes(4).toString("hex");

    const [result] = await pool.execute(
      `INSERT INTO urls (original_url, short_code)
       VALUES (?, ?)`,
      [originalUrl, shortCode]
    );

    const [newUrl] = await pool.execute(
      "SELECT * FROM urls WHERE id = ?",
      [result.insertId]
    );

    res.status(201).json({
      success: true,
      message: "URL shortened successfully.",
      data: newUrl[0],
    });
  } catch (error) {
    console.error("Database error:", error);

    res.status(500).json({
      success: false,
      message: "Unable to save URL to database.",
    });
  }
});

app.get("/api/urls", async (req, res) => {
  try {
    const [urls] = await pool.execute(
      "SELECT * FROM urls ORDER BY created_at DESC"
    );

    res.json({
      success: true,
      data: urls,
    });
  } catch (error) {
    console.error("Database error:", error);

    res.status(500).json({
      success: false,
      message: "Unable to retrieve URLs.",
    });
  }
});

app.get("/api/short/:shortCode", async (req, res) => {
  const { shortCode } = req.params;

  try {
    const [urls] = await pool.execute(
      "SELECT * FROM urls WHERE short_code = ? LIMIT 1",
      [shortCode]
    );

    if (urls.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Short URL not found.",
      });
    }

    const url = urls[0];

    await pool.execute(
      "UPDATE urls SET clicks = clicks + 1 WHERE id = ?",
      [url.id]
    );

    res.redirect(url.original_url);
  } catch (error) {
    console.error("Database error:", error);

    res.status(500).json({
      success: false,
      message: "Unable to process short URL.",
    });
  }
});

app.delete("/api/urls/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const [result] = await pool.execute(
      "DELETE FROM urls WHERE id = ?",
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "URL not found.",
      });
    }

    res.json({
      success: true,
      message: "URL deleted successfully.",
    });
  } catch (error) {
    console.error("Database error:", error);

    res.status(500).json({
      success: false,
      message: "Unable to delete URL.",
    });
  }
});

app.listen(PORT, () => {
  console.log(
    `URL Shortener backend running on http://localhost:${PORT}`
  );
});