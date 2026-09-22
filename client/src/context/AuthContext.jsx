import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, getToken, setToken } from '../api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await api.me();
      setUser(me);
    } catch {
      setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function login(email, password) {
    const res = await api.login(email, password);
    setToken(res.token);
    setUser({ email: res.email, apiKeys: res.apiKeys });
  }

  async function signup(email, password) {
    const res = await api.signup(email, password);
    setToken(res.token);
    setUser({ email: res.email, apiKeys: res.apiKeys });
  }

  async function googleSignIn(idToken) {
    const res = await api.googleAuth(idToken);
    setToken(res.token);
    setUser({ email: res.email, apiKeys: res.apiKeys });
  }

  function logout() {
    setToken(null);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, setUser, loading, login, signup, googleSignIn, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
