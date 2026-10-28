import { Link } from "react-router-dom";

function Navbar() {
  return (
    <nav className="navbar">
      <div className="navbar-container">
        <Link to="/" className="logo">
          Shortly
        </Link>

        <div className="nav-links">
          <Link to="/">Shorten URL</Link>
          <Link to="/history">History</Link>
        </div>
      </div>
    </nav>
  );
}

export default Navbar;
