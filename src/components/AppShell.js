'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { getWorkProgressExportJob } from '@/lib/work-progress-export';

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export default function AppShell({ title, children }) {
  const { user, loading, logout, isReadOnly } = useAuth();
  const router = useRouter();
  const timerRef = useRef(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [weeklyGoals, setWeeklyGoals] = useState([]);
  const [weeklyGoalForm, setWeeklyGoalForm] = useState({ progress: '', remark: '' });
  const [savingWeeklyGoal, setSavingWeeklyGoal] = useState(false);
  const toastTimer = useRef(null);

  const showToast = (msg) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2000);
  };

  const recordAction = (action, details = '', severity = 'low') => {
    fetch('/api/audit/action', {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
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
      const exportJob = getWorkProgressExportJob();
      if (exportJob && ['pending', 'exporting'].includes(exportJob.status)) {
        resetTimer();
        return;
      }
      logout();
      router.replace('/login?reason=timeout');
    }, IDLE_TIMEOUT_MS);
  };

  useLayoutEffect(() => {
    if (!loading && !user) router.replace('/login');
    if (!loading && user?.portalAccess === 'alumni') router.replace('/alumni');
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
    fetch('/api/audit/page-view', {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ module: title, details: `Opened ${title} module` }),
    }).catch(() => {});
  }, [user, title]);

  useEffect(() => {
    if (!user || ['super_admin', 'admin_full'].includes(user.role)) return;
    const checkWeeklyGoalUpdates = () => fetch('/api/performance/goals/weekly-update', { credentials: 'same-origin' })
      .then(response => response.ok ? response.json() : null)
      .then(result => {
        const goals = result?.data?.goals || [];
        if (goals.length) {
          setWeeklyGoals(current => current.length ? current : goals);
          setWeeklyGoalForm(current => current.remark ? current : { progress: goals[0].progress ?? 0, remark: '' });
        }
      }).catch(() => {});
    checkWeeklyGoalUpdates();
    const interval = setInterval(checkWeeklyGoalUpdates, 30000);
    return () => clearInterval(interval);
  }, [user]);

  const submitWeeklyGoal = async () => {
    const goal = weeklyGoals[0];
    if (!goal || !weeklyGoalForm.remark.trim()) return showToast('Please add your weekly work update');
    setSavingWeeklyGoal(true);
    try {
      const response = await fetch('/api/performance/goals/weekly-update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ goalId: goal._id, ...weeklyGoalForm }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to save update');
      const remaining = weeklyGoals.slice(1);
      setWeeklyGoals(remaining);
      setWeeklyGoalForm({ progress: remaining[0]?.progress ?? 0, remark: '' });
    } catch (error) { showToast(error.message); } finally { setSavingWeeklyGoal(false); }
  };

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

  if (loading || !user || user.portalAccess === 'alumni') return (
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
      {weeklyGoals[0] && <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)', zIndex: 10000 }}><div className="modal-dialog modal-dialog-centered"><div className="modal-content"><div className="modal-header"><h5 className="modal-title">Friday Goal Update</h5></div><div className="modal-body"><p style={{ fontSize: 13, color: '#64748b' }}>Update your progress for <strong>{weeklyGoals[0].title}</strong>.</p><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Progress: {weeklyGoalForm.progress}%</label><input type="range" min="0" max="100" className="form-range" value={weeklyGoalForm.progress} onChange={e => setWeeklyGoalForm(form => ({ ...form, progress: +e.target.value }))} /><label className="form-label mt-3" style={{ fontSize: 13, fontWeight: 600 }}>What did you complete this week? *</label><textarea className="form-control" rows="3" value={weeklyGoalForm.remark} onChange={e => setWeeklyGoalForm(form => ({ ...form, remark: e.target.value }))} /></div><div className="modal-footer"><button className="btn btn-primary" disabled={savingWeeklyGoal} onClick={submitWeeklyGoal}>{savingWeeklyGoal ? 'Saving...' : 'Save Update'}</button></div></div></div></div>}
      {toast && <div style={{
        position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)',
        zIndex: 100000, background: '#1e293b', color: '#fff', padding: '10px 20px',
        borderRadius: 8, fontSize: 13, boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
        maxWidth: '90vw', textAlign: 'center',
      }}>{toast}</div>}
    </>
  );
}
