import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/auth';
export default function ProtectedRoute({ children }) {
  const { user, loading, error, retry } = useAuth();
  const location = useLocation();
  if (loading)
    return (
      <main className="page-shell empty-state" role="status">
        Loading your session...
      </main>
    );
  if (error)
    return (
      <main className="page-shell empty-state">
        <p role="alert">{error}</p>
        <button className="button button-primary" onClick={retry}>
          Try again
        </button>
      </main>
    );
  return user ? children : <Navigate to="/login" replace state={{ from: location.pathname }} />;
}
