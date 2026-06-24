'use client';
import { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

export const ROLES = {
  SUPER_ADMIN:  'super_admin',
  ADMIN_FULL:   'admin_full',
  RECRUITER:    'recruiter',
  TEAM_ADMIN:   'team_admin',
  TEAM_LEAD:    'team_lead',
  EMPLOYEE:     'employee',
  INTERN:       'intern',
  SME:          'sme',
};

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
    const token = localStorage.getItem('hrms_token');
    if (stored && token) setUser(JSON.parse(stored));
    setLoading(false);
  }, []);

  const login = async (email, password) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const json = await res.json();
    if (!res.ok) return { success: false, error: json.error || 'Login failed' };
    localStorage.setItem('hrms_token', json.data.token);
    localStorage.setItem('hrms_refresh', json.data.refreshToken);
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
    localStorage.removeItem('hrms_token');
    localStorage.removeItem('hrms_refresh');
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

export function getToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('hrms_token');
}

export function getRefreshToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('hrms_refresh');
}

export function setToken(token) {
  if (typeof window === 'undefined') return;
  localStorage.setItem('hrms_token', token);
}

// Module access matrix — mirrors server-side rbac.js
const MODULE_ACCESS = {
  dashboard:     { super_admin:'full', admin_full:'full', recruiter:'limited', team_lead:'dept',   team_admin:'team', employee:'self',     intern:'limited',  sme:'self' },
  employees:     { super_admin:'full', admin_full:'full', recruiter:'view',    team_lead:'dept',   team_admin:'team', employee:'self',     intern:false,      sme:false },
  recruitment:   { super_admin:'full', admin_full:'full', recruiter:'full',    team_lead:false,    team_admin:false,  employee:false,      intern:false,      sme:false },
  timecard:      { super_admin:'full', admin_full:'full', recruiter:false,     team_lead:'dept',   team_admin:'team', employee:'self',     intern:'self',     sme:false },
  attendance:    { super_admin:'full', admin_full:'full', recruiter:false,     team_lead:'dept',   team_admin:'team', employee:'self',     intern:'self',     sme:'self' },
  absence:       { super_admin:'full', admin_full:'full', recruiter:false,     team_lead:'dept',   team_admin:'team', employee:'self',     intern:'self',     sme:false },
  leave:         { super_admin:'full', admin_full:'full', recruiter:false,     team_lead:'dept',   team_admin:'team', employee:'self',     intern:'self',     sme:'self' },
  payroll:       { super_admin:'full', admin_full:'limited', recruiter:false,  team_lead:false,    team_admin:false,  employee:'self',     intern:false,      sme:'self' },
  payslip:       { super_admin:'full', admin_full:'limited', recruiter:false,  team_lead:false,    team_admin:false,  employee:'self',     intern:false,      sme:false },
  tasks:         { super_admin:'full', admin_full:'full', recruiter:false,     team_lead:'dept',   team_admin:'team', employee:'assigned', intern:'assigned', sme:'assigned' },
  projects:      { super_admin:'full', admin_full:'full', recruiter:false,     team_lead:'dept',   team_admin:'team', employee:'assigned', intern:'assigned', sme:'assigned' },
  performance:   { super_admin:'full', admin_full:'full', recruiter:'limited', team_lead:'dept',   team_admin:'team', employee:'self',     intern:'limited',  sme:false },
  documents:     { super_admin:'full', admin_full:'full', recruiter:'limited', team_lead:'dept',   team_admin:'team', employee:'self',     intern:'limited',  sme:false },
  finance:       { super_admin:'full', admin_full:'limited', recruiter:false,  team_lead:false,    team_admin:false,  employee:false,      intern:false,      sme:false },
  invoicing:     { super_admin:'full', admin_full:'limited', recruiter:false,  team_lead:false,    team_admin:false,  employee:false,      intern:false,      sme:false },
  inventory:     { super_admin:'full', admin_full:'full', recruiter:false,     team_lead:'dept',   team_admin:'team', employee:false,      intern:false,      sme:false },
  reports:       { super_admin:'full', admin_full:'full', recruiter:'limited', team_lead:'dept',   team_admin:'team', employee:'self',     intern:false,      sme:false },
  communication: { super_admin:'full', admin_full:'full', recruiter:false,     team_lead:'dept',   team_admin:'team', employee:'view',     intern:'view',     sme:false },
  calendar:      { super_admin:'full', admin_full:'full', recruiter:'self',    team_lead:'dept',   team_admin:'team', employee:'self',     intern:'self',     sme:'self' },
  monitoring:    { super_admin:'full', admin_full:'full', recruiter:false,     team_lead:'dept',   team_admin:'team', employee:false,      intern:false,      sme:false },
  core_hr:       { super_admin:'full', admin_full:'full', recruiter:'view',    team_lead:'dept',   team_admin:'team', employee:false,      intern:false,      sme:false },
  self_service:  { super_admin:'full', admin_full:'full', recruiter:'self',    team_lead:'self',   team_admin:'self', employee:'self',     intern:'self',     sme:'self' },
  settings:      { super_admin:'full', admin_full:'limited', recruiter:false,  team_lead:false,    team_admin:false,  employee:false,      intern:false,      sme:false },
  audit:         { super_admin:'full', admin_full:'view',  recruiter:false,    team_lead:false,    team_admin:false,  employee:false,      intern:false,      sme:false },
  sme:           { super_admin:'full', admin_full:false,   recruiter:false,    team_lead:false,    team_admin:false,  employee:false,      intern:false,      sme:false },
};

export function hasAccess(role, module) {
  return !!(MODULE_ACCESS[module]?.[role]);
}
