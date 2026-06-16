'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken, useAuth } from '@/lib/auth';
import Sidebar from './Sidebar';
import Topbar from './Topbar';

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export default function AppShell({ title, children }) {
  const { user, loading, logout, isReadOnly } = useAuth();
  const router = useRouter();
  const timerRef = useRef(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const showToast = (msg) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2000);
  };

  const recordAction = (action, details = '', severity = 'low') => {
    const token = getToken();
    if (!token) return;
    fetch('/api/audit/action', {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        action,
        module: title || 'Application',
        details,
        severity,
      }),
    }).catch(() => {});
  };

  const resetTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      logout();
      router.replace('/login?reason=timeout');
    }, IDLE_TIMEOUT_MS);
  };

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    events.forEach(e => window.addEventListener(e, resetTimer, { passive: true }));
    resetTimer();
    return () => {
      events.forEach(e => window.removeEventListener(e, resetTimer));
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [user]);

  useEffect(() => {
    if (!user || !title) return;
    const token = getToken();
    if (!token) return;
    fetch('/api/audit/page-view', {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ module: title, details: `Opened ${title} module` }),
    }).catch(() => {});
  }, [user, title]);

  useEffect(() => {
    if (!user) return;

    const getElementLabel = (el) => {
      const explicit = el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('name');
      const text = (explicit || el.innerText || el.textContent || el.value || '').replace(/\s+/g, ' ').trim();
      return text || el.tagName.toLowerCase();
    };

    const handleClick = (event) => {
      const target = event.target?.closest?.('button, a, [role="button"], input[type="button"], input[type="submit"]');
      if (!target) return;
      const label = getElementLabel(target).slice(0, 120);
      const href = target.getAttribute('href');
      const action = target.tagName.toLowerCase() === 'a' ? 'Link Clicked' : 'Button Clicked';
      const details = `${label}${href ? ` -> ${href}` : ''}`;
      recordAction(action, details);
    };

    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, [user, title]);

  useEffect(() => {
    if (!isReadOnly) return;

    const mutationSelectors = 'button:not([data-readonly-allow]), input[type="submit"], input[type="button"]:not([data-readonly-allow]), [role="button"]:not([data-readonly-allow])';

    const handleMutationClick = (event) => {
      const target = event.target?.closest?.(mutationSelectors);
      if (!target) return;

      const isNavLink = target.tagName === 'A' && target.getAttribute('href');
      if (isNavLink) return;

      event.preventDefault();
      event.stopPropagation();
      showToast('Read-only mode: you cannot perform actions while viewing as this employee');
    };

    document.addEventListener('click', handleMutationClick, true);
    return () => document.removeEventListener('click', handleMutationClick, true);
  }, [isReadOnly]);

  if (loading || !user) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9' }}>
      <div className="spinner-border text-primary" />
    </div>
  );

  return (
    <>
      <Sidebar mobileOpen={mobileNavOpen} onMobileClose={() => setMobileNavOpen(false)} />
      <Topbar title={title} onMenuClick={() => setMobileNavOpen(true)} isReadOnly={isReadOnly} />
      <main className="main-content">
        {children}
      </main>
      {toast && <div style={{
        position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)',
        zIndex: 100000, background: '#1e293b', color: '#fff', padding: '10px 20px',
        borderRadius: 8, fontSize: 13, boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
        maxWidth: '90vw', textAlign: 'center',
      }}>{toast}</div>}
    </>
  );
}
