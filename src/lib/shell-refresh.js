'use client';
import { createContext, useContext, useState, useCallback } from 'react';

const ShellRefreshContext = createContext(null);

export function ShellRefreshProvider({ children }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const triggerRefresh = useCallback(() => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshKey(k => k + 1);
    setTimeout(() => setRefreshing(false), 600);
  }, [refreshing]);

  return (
    <ShellRefreshContext.Provider value={{ refreshKey, refreshing, triggerRefresh }}>
      {children}
    </ShellRefreshContext.Provider>
  );
}

export function useShellRefresh() {
  const ctx = useContext(ShellRefreshContext);
  if (!ctx) throw new Error('useShellRefresh must be used inside ShellRefreshProvider');
  return ctx;
}
