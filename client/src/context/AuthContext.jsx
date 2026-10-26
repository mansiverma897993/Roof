import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api('/auth/me')
      .then((data) => setUser(data.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);
  const login = async (email, password) => {
    const data = await api('/auth/login', { method: 'POST', body: { email, password } });
    setUser(data.user);
  };
  const register = async (name, email, password) => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const data = await api('/auth/register', {
      method: 'POST',
      body: { name, email, password, ...(timeZone ? { timeZone } : {}) },
    });
    setUser(data.user);
  };
  const logout = async () => {
    await api('/auth/logout', { method: 'POST' });
    setUser(null);
  };
  const deleteAccount = async (password) => {
    await api('/auth/me', { method: 'DELETE', body: { password } });
    setUser(null);
  };
  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, deleteAccount }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
