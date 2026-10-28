# ZipLink — URL Shortener

A full-stack URL shortening application built with **React, Node.js, Express.js, and MySQL**. ZipLink converts long URLs into compact, shareable links while tracking clicks and maintaining a history of shortened URLs through a responsive dashboard.

## ✨ Features

- **URL Shortening:** Convert long URLs into compact, shareable links.
- **URL Validation:** Validate URLs before processing them.
- **Unique Short Codes:** Generate unique identifiers for shortened links.
- **Duplicate Detection:** Check for existing URLs to avoid unnecessary duplicate entries.
- **Instant Redirection:** Redirect users to the original URL using a short link.
- **Click Analytics:** Track the number of clicks on each shortened URL.
- **URL History:** View previously shortened URLs and their details.
- **Link Management:** Delete shortened URLs when they are no longer needed.
- **Dashboard Statistics:** View key metrics for managed links.
- **Responsive UI:** Access the application across desktop and mobile devices.
- **Persistent Storage:** Store URL records and click counts in MySQL.

## 🛠️ Tech Stack

| Category | Technologies |
|---|---|
| Frontend | React, Vite, React Router, JavaScript, HTML, CSS |
| Backend | Node.js, Express.js |
| Database | MySQL |
| Database Driver | MySQL2 |
| Configuration | dotenv |
| Middleware | CORS |

## ⚙️ How It Works

1. The user enters a long URL through the React interface.
2. The frontend sends a request to the Express.js API.
3. The backend validates the URL and checks for an existing record.
4. A unique short code is generated for a new URL.
5. The original URL, short code, and metadata are stored in MySQL.
6. The application returns a shareable shortened URL.
7. When someone opens the short link, the backend retrieves the original URL.
8. The click counter is incremented, and the user is redirected to the destination.

## 📁 Project Structure

```text
ziplink-url-shortener/
├── server/
│   └── server.cjs
├── src/
│   ├── components/
│   │   └── Navbar.jsx
│   ├── pages/
│   │   ├── Home.jsx
│   │   └── History.jsx
│   ├── App.jsx
│   ├── index.css
│   └── main.jsx
├── .env
├── .gitignore
├── package.json
└── README.md
```

## 🚀 Getting Started

### Prerequisites

Make sure you have the following installed:

- [Node.js](https://nodejs.org/)
- [MySQL](https://dev.mysql.com/downloads/)
- npm (included with Node.js)

### 1. Clone the repository

```bash
git clone <your-github-repository-url>
cd ziplink-url-shortener
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure the database

Log in to MySQL and execute the following SQL commands:

```sql
CREATE DATABASE url_shortener;

USE url_shortener;

CREATE TABLE urls (
    id INT AUTO_INCREMENT PRIMARY KEY,
    original_url TEXT NOT NULL,
    short_code VARCHAR(20) NOT NULL UNIQUE,
    clicks INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 4. Configure environment variables

Create a `.env` file in the project root:

```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=url_shortener
```

Replace the placeholder password with your local MySQL password.

**Security note:** Never commit your `.env` file or database credentials to GitHub. Add `.env` to `.gitignore`.

### 5. Start the backend

Open a terminal in the project root and run:

```bash
node server/server.cjs
```

The backend runs at:

`http://localhost:5002`

### 6. Start the frontend

Open a second terminal in the project root and run:

```bash
npm run dev
```

Open the Vite development URL shown in your terminal, typically:

`http://localhost:5173`

## 🔌 API Endpoints

Base URL: `http://localhost:5002`

| Method | Endpoint | Description |
|---|---|---|
| GET | `/` | Check backend availability |
| POST | `/api/shorten` | Create a shortened URL |
| GET | `/api/urls` | Retrieve shortened URL history |
| GET | `/api/short/:shortCode` | Redirect to the original URL |
| DELETE | `/api/urls/:id` | Delete a shortened URL |

### Example: Shorten a URL

**Request**

```http
POST /api/shorten
Content-Type: application/json
```

```json
{
  "url": "https://example.com/some/long/path"
}
```

**Response example**

```json
{
  "shortCode": "aB12xY",
  "shortUrl": "http://localhost:5002/api/short/aB12xY"
}
```

*Note: The exact request and response fields depend on your backend implementation. Adjust this example if your API uses a different format.*

## 🗄️ Database Schema

The `urls` table stores the following information:

| Column | Type | Purpose |
|---|---|---|
| `id` | INT | Unique record identifier |
| `original_url` | TEXT | Destination URL |
| `short_code` | VARCHAR(20) | Unique short identifier |
| `clicks` | INT | Number of recorded clicks |
| `created_at` | TIMESTAMP | Record creation time |

The unique constraint on `short_code` prevents duplicate short codes at the database level.

## 🔮 Future Enhancements

- User authentication and personalized dashboards
- Custom short URLs and aliases
- QR code generation
- Link expiration and automatic cleanup
- Advanced click analytics and traffic insights
- Password-protected links
- Rate limiting and abuse prevention
- Cloud deployment with a production database

## 👨‍💻 Author

**Kaushik Mishra**

B.Tech. Computer Science and Engineering  
National Institute of Technology, Raipur

---

Built to explore full-stack development, REST API design, database integration, URL redirection, and application-level analytics.
