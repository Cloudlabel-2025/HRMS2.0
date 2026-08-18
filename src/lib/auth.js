'use client';
import { createContext, useContext, useState, useEffect } from 'react';
import { hasAccess } from '@/lib/permissions';
export { hasAccess };

const AuthContext = createContext(null);

export const ROLE_LABELS = {
  super_admin:  'Super Admin',
  admin_full:   'Admin',
  recruiter:    'Recruiter',
  team_admin:   'Team Admin',
  team_lead:    'Team Lead',
  employee:     'Employee',
  intern:       'Intern',
  sme:          'SME',
};

export const ROLE_COLORS = {
  super_admin:  '#8b5cf6',
  admin_full:   '#3b82f6',
  recruiter:    '#06b6d4',
  team_admin:   '#f97316',
  team_lead:    '#10b981',
  employee:     '#f59e0b',
  intern:       '#64748b',
  sme:          '#0891b2',
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem('hrms_user');
    if (stored) setUser(JSON.parse(stored));
    fetch('/api/auth/me', { credentials: 'same-origin' })
      .then(async res => {
        if (!res.ok) throw new Error('No active session');
        const json = await res.json();
        localStorage.setItem('hrms_user', JSON.stringify(json.data));
        setUser(json.data);
      })
      .catch(() => {
        localStorage.removeItem('hrms_user');
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (email, password) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const json = await res.json();
    if (!res.ok) return { success: false, error: json.error || 'Login failed' };
    localStorage.setItem('hrms_user', JSON.stringify(json.data.user));
    setUser(json.data.user);
    return {
      success: true,
      user: json.data.user,
      isFirstLogin: json.data.isFirstLogin,
      needsLateLogoutReason: json.data.needsLateLogoutReason,
      lateLogoutDate: json.data.lateLogoutDate,
    };
  };

  const logout = () => {
    // Keep the revocation request alive when logout is immediately followed by
    // a full-page redirect (the alumni portal's Back-button flow does this).
    void fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', keepalive: true }).catch(() => {});
    localStorage.removeItem('hrms_user');
    localStorage.removeItem('hrms_impersonated_user');
    window.__impersonatedUser = null;
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

// Impersonation state — persisted in localStorage to survive page reloads
export function setImpersonatedUser(user) {
  window.__impersonatedUser = user;
  localStorage.setItem('hrms_impersonated_user', JSON.stringify(user));
  window.dispatchEvent(new CustomEvent('impersonation'));
}
export function clearImpersonatedUser() {
  window.__impersonatedUser = null;
  localStorage.removeItem('hrms_impersonated_user');
  window.dispatchEvent(new CustomEvent('impersonation'));
}
export function isImpersonating() {
  return typeof window !== 'undefined' && !!window.__impersonatedUser;
}

export function useAuth() {
  const auth = useContext(AuthContext);
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    // Restore impersonation from localStorage (survives full page reloads)
    if (typeof window !== 'undefined' && !window.__impersonatedUser) {
      const stored = localStorage.getItem('hrms_impersonated_user');
      if (stored) {
        try { window.__impersonatedUser = JSON.parse(stored); } catch {}
      }
    }
    const handler = () => forceUpdate(n => n + 1);
    window.addEventListener('impersonation', handler);
    handler();
    return () => window.removeEventListener('impersonation', handler);
  }, []);

  if (!auth) return null;
  if (typeof window !== 'undefined' && window.__impersonatedUser) {
    return { ...auth, user: window.__impersonatedUser, realUser: auth.user, isReadOnly: true };
  }
  return { ...auth, isReadOnly: false };
}

/** Client-side helper: can the given user view employees in targetDepartment? */
export function canAccessDepartment(user, targetDepartment) {
  if (!user) return false;
  if (['super_admin', 'admin_full', 'recruiter'].includes(user.role)) return true;
  // Only team_lead and team_admin get cross-department visibility
  if (!['team_lead', 'team_admin'].includes(user.role)) {
    return user.department === targetDepartment;
  }
  const visible = user.visibleDepartments || [];
  return user.department === targetDepartment || visible.includes(targetDepartment);
}
