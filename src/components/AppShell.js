'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken, useAuth } from '@/lib/auth';
import Sidebar from './Sidebar';
import Topbar from './Topbar';

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export default function AppShell({ title, children }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const timerRef = useRef(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

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

  if (loading || !user) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9' }}>
      <div className="spinner-border text-primary" />
    </div>
  );

  return (
    <>
      <Sidebar mobileOpen={mobileNavOpen} onMobileClose={() => setMobileNavOpen(false)} />
      <Topbar title={title} onMenuClick={() => setMobileNavOpen(true)} />
      <main className="main-content">
        {children}
      </main>
    </>
  );
}
