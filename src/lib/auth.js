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
};

export const ROLE_LABELS = {
  super_admin:  'Super Admin',
  admin_full:   'Admin',
  recruiter:    'Recruiter',
  team_admin:   'Team Admin',
  team_lead:    'Team Lead',
  employee:     'Employee',
  intern:       'Intern',
};

export const ROLE_COLORS = {
  super_admin:  '#8b5cf6',
  admin_full:   '#3b82f6',
  recruiter:    '#06b6d4',
  team_admin:   '#f97316',
  team_lead:    '#10b981',
  employee:     '#f59e0b',
  intern:       '#64748b',
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
    return { success: true, user: json.data.user, isFirstLogin: json.data.isFirstLogin };
  };

  const logout = () => {
    localStorage.removeItem('hrms_token');
    localStorage.removeItem('hrms_refresh');
    localStorage.removeItem('hrms_user');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
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
  dashboard:     { super_admin:'full', admin_full:'full', recruiter:'limited', team_admin:'team',  team_lead:'dept',  employee:'self',     intern:'limited' },
  employees:     { super_admin:'full', admin_full:'full', recruiter:'view',    team_admin:'team',  team_lead:'dept',  employee:'self',     intern:false },
  recruitment:   { super_admin:'full', admin_full:'full', recruiter:'full',    team_admin:false,   team_lead:'view',  employee:false,      intern:false },
  timecard:      { super_admin:'full', admin_full:'full', recruiter:'self',    team_admin:'team',  team_lead:'dept',  employee:'self',     intern:'self' },
  attendance:    { super_admin:'full', admin_full:'full', recruiter:'self',    team_admin:'team',  team_lead:'dept',  employee:'self',     intern:'self' },
  absence:       { super_admin:'full', admin_full:'full', recruiter:'self',    team_admin:'team',  team_lead:'dept',  employee:'self',     intern:'self' },
  leave:         { super_admin:'full', admin_full:'full', recruiter:'self',    team_admin:'team',  team_lead:'dept',  employee:'self',     intern:'self' },
  payroll:       { super_admin:'full', admin_full:'limited', recruiter:false,  team_admin:false,   team_lead:false,   employee:'self',     intern:false },
  payslip:       { super_admin:'full', admin_full:'limited', recruiter:false,  team_admin:false,   team_lead:false,   employee:'self',     intern:false },
  tasks:         { super_admin:'full', admin_full:'full', recruiter:'limited', team_admin:'team',  team_lead:'dept',  employee:'assigned', intern:'assigned' },
  projects:      { super_admin:'full', admin_full:'full', recruiter:'view',    team_admin:'team',  team_lead:'dept',  employee:'assigned', intern:'assigned' },
  performance:   { super_admin:'full', admin_full:'full', recruiter:'limited', team_admin:'team',  team_lead:'dept',  employee:'self',     intern:'limited' },
  documents:     { super_admin:'full', admin_full:'full', recruiter:'limited', team_admin:'team',  team_lead:'dept',  employee:'self',     intern:'limited' },
  finance:       { super_admin:'full', admin_full:'limited', recruiter:false,  team_admin:false,   team_lead:false,   employee:false,      intern:false },
  invoicing:     { super_admin:'full', admin_full:'limited', recruiter:false,  team_admin:false,   team_lead:false,   employee:false,      intern:false },
  inventory:     { super_admin:'full', admin_full:'full', recruiter:false,     team_admin:'team',  team_lead:'dept',  employee:false,      intern:false },
  reports:       { super_admin:'full', admin_full:'full', recruiter:'limited', team_admin:'team',  team_lead:'dept',  employee:'self',     intern:false },
  communication: { super_admin:'full', admin_full:'full', recruiter:false,     team_admin:'team',  team_lead:'dept',  employee:'view',     intern:'view' },
  calendar:      { super_admin:'full', admin_full:'full', recruiter:'self',    team_admin:'team',  team_lead:'dept',  employee:'self',     intern:'self' },
  monitoring:    { super_admin:'full', admin_full:'full', recruiter:false,     team_admin:'team',  team_lead:'dept',  employee:false,      intern:false },
  settings:      { super_admin:'full', admin_full:'limited', recruiter:false,  team_admin:false,   team_lead:false,   employee:false,      intern:false },
  audit:         { super_admin:'full', admin_full:'view',  recruiter:false,    team_admin:false,   team_lead:false,   employee:false,      intern:false },
  sme:           { super_admin:'full', admin_full:'full',  recruiter:'view',   team_admin:'team',  team_lead:'dept',  employee:'limited',  intern:'limited' },
};

export function hasAccess(role, module) {
  return !!(MODULE_ACCESS[module]?.[role]);
}
