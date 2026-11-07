import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import Home from './pages/Home';
import History from './pages/History';
import Login from './pages/Login';
import { lazy, Suspense } from 'react';
const Analytics = lazy(() => import('./pages/Analytics'));
import AuthProvider from './context/AuthProvider';
import ProtectedRoute from './components/ProtectedRoute';
function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Navbar />
        <Suspense
          fallback={
            <main className="page-shell empty-state" role="status">
              Loading page...
            </main>
          }
        >
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login key="login" />} />
            <Route path="/register" element={<Login key="register" register />} />
            <Route
              path="/history"
              element={
                <ProtectedRoute>
                  <History />
                </ProtectedRoute>
              }
            />
            <Route
              path="/analytics"
              element={
                <ProtectedRoute>
                  <Analytics />
                </ProtectedRoute>
              }
            />
            <Route
              path="*"
              element={
                <main className="page-shell empty-state">
                  <h1>Page not found</h1>
                  <a className="button button-primary" href="/">
                    Return home
                  </a>
                </main>
              }
            />
          </Routes>
        </Suspense>
        <footer className="footer page-shell">
          <span className="footer-brand">ziplink.</span>
          <p>Make it short. Make it count.</p>
          <span>Built for the way you share.</span>
        </footer>
      </AuthProvider>
    </BrowserRouter>
  );
}
export default App;
