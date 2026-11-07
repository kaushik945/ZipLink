import { useEffect, useState } from 'react';
import { AuthContext } from './auth';
import { request } from '../lib/api';
export default function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    request('/api/auth/me')
      .then((data) => {
        if (active) {
          setUser(data.user);
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
  }, [retry]);
  useEffect(() => {
    const expire = () => setUser(null);
    window.addEventListener('ziplink:unauthenticated', expire);
    return () => window.removeEventListener('ziplink:unauthenticated', expire);
  }, []);
  async function authenticate(mode, email, password) {
    const data = await request(`/api/auth/${mode}`, {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setUser(data.user);
    setError('');
  }
  async function logout() {
    await request('/api/auth/logout', { method: 'POST' });
    setUser(null);
  }
  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        error,
        authenticate,
        logout,
        retry: () => {
          setLoading(true);
          setRetry((n) => n + 1);
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
