'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Late logout reason modal
  const [showLateLogoutModal, setShowLateLogoutModal] = useState(false);
  const [lateLogoutDate, setLateLogoutDate] = useState(null);
  const [lateLogoutReason, setLateLogoutReason] = useState('');
  const [submittingReason, setSubmittingReason] = useState(false);
  const [reasonError, setReasonError] = useState('');

  const submitLateLogoutReason = async (e) => {
    e.preventDefault();
    if (!lateLogoutReason || lateLogoutReason.trim().length < 5) {
      setReasonError('Please provide a valid reason (at least 5 characters).');
      return;
    }
    setSubmittingReason(true);
    setReasonError('');
    try {
      const token = localStorage.getItem('hrms_token');
      const res = await fetch('/api/attendance/late-logout-reason', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ date: lateLogoutDate, reason: lateLogoutReason.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        setReasonError(json.error || 'Failed to submit reason.');
        setSubmittingReason(false);
        return;
      }
    } catch {
      setReasonError('Network error. Please try again.');
      setSubmittingReason(false);
      return;
    }
    setSubmittingReason(false);
    setShowLateLogoutModal(false);
    router.push('/dashboard');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const result = await login(form.email, form.password);
    setLoading(false);
    if (result.success) {
      if (result.needsLateLogoutReason && result.lateLogoutDate) {
        setLateLogoutDate(result.lateLogoutDate);
        setShowLateLogoutModal(true);
      } else if (result.isFirstLogin) {
        router.push('/login/setup-password');
      } else {
        router.push('/dashboard');
      }
    } else {
      setError(result.error);
    }
  };

  return (
    <div className="login-page">
      <div style={{ width: '100%', maxWidth: 440, padding: '0 16px' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
            <i className="bi bi-hexagon-fill" style={{ color: '#fff', fontSize: 24 }} />
          </div>
          <h4 style={{ color: '#fff', fontWeight: 700, margin: 0 }}>HRMS Pro</h4>
          <p style={{ color: '#94a3b8', fontSize: 13, margin: '4px 0 0' }}>Enterprise Human Resource Management</p>
        </div>

        <div className="login-card">
          <h5 style={{ fontWeight: 700, marginBottom: 4 }}>Welcome back</h5>
          <p style={{ color: '#64748b', fontSize: 13, marginBottom: 24 }}>Sign in to your account to continue</p>

          {error && (
            <div className="alert alert-danger d-flex align-items-center gap-2 py-2" style={{ fontSize: 13, borderRadius: 8 }}>
              <i className="bi bi-exclamation-circle" />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="mb-3">
              <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Email Address</label>
              <div style={{ position: 'relative' }}>
                <i className="bi bi-envelope" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: 14 }} />
                <input
                  type="email"
                  className="form-control"
                  placeholder="you@company.com"
                  style={{ paddingLeft: 36 }}
                  value={form.email}
                  onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                  required
                  suppressHydrationWarning
                />
              </div>
            </div>

            <div className="mb-4">
              <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Password</label>
              <div style={{ position: 'relative', marginBottom: 8 }}>
                <i className="bi bi-lock" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: 14 }} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="form-control"
                  placeholder="••••••••"
                  style={{ paddingLeft: 36, paddingRight: 36 }}
                  value={form.password}
                  onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                  required
                  suppressHydrationWarning
                />
                <i
                  className={`bi bi-eye${showPassword ? '-slash' : ''}`}
                  onClick={() => setShowPassword(p => !p)}
                  style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: 14, cursor: 'pointer' }}
                />
              </div>
              <div style={{ textAlign: 'right' }}>
                <Link href="/login/forgot-password" style={{ fontSize: 13, textDecoration: 'none', color: '#3b82f6', fontWeight: 600 }}>Forgot Password?</Link>
              </div>
            </div>

            <button type="submit" className="btn btn-primary w-100" disabled={loading} style={{ padding: '10px', fontWeight: 600 }} suppressHydrationWarning>
              {loading ? <><span className="spinner-border spinner-border-sm me-2" />Signing in...</> : 'Sign In'}
            </button>
          </form>
        </div>
      </div>

      {/* Late Logout Reason Modal */}
      {showLateLogoutModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 16,
        }}>
          <div style={{
            background: '#fff', borderRadius: 16, padding: 32,
            maxWidth: 480, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          }}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{
                width: 48, height: 48, borderRadius: 12,
                background: 'linear-gradient(135deg, #f59e0b, #ef4444)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 12px',
              }}>
                <i className="bi bi-clock-history" style={{ color: '#fff', fontSize: 22 }} />
              </div>
              <h5 style={{ fontWeight: 700, margin: 0 }}>Late Logout Detected</h5>
              <p style={{ color: '#64748b', fontSize: 13, marginTop: 4, marginBottom: 0 }}>
                You were auto-logged out on <strong>{lateLogoutDate}</strong> because you forgot to log out after your shift ended.
                Please provide a reason below.
              </p>
            </div>

            <form onSubmit={submitLateLogoutReason}>
              <div className="mb-3">
                <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>
                  Reason for late logout
                </label>
                <textarea
                  className="form-control"
                  rows={3}
                  placeholder="e.g., I was working on an urgent task and forgot to log out..."
                  value={lateLogoutReason}
                  onChange={e => { setLateLogoutReason(e.target.value); setReasonError(''); }}
                  style={{ fontSize: 14, borderRadius: 8 }}
                  required
                  suppressHydrationWarning
                />
                {reasonError && (
                  <div style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>
                    <i className="bi bi-exclamation-circle me-1" />
                    {reasonError}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="submit"
                  className="btn btn-primary w-100"
                  disabled={submittingReason}
                  style={{ padding: '10px', fontWeight: 600, borderRadius: 8 }}
                  suppressHydrationWarning
                >
                  {submittingReason ? (
                    <><span className="spinner-border spinner-border-sm me-2" />Submitting...</>
                  ) : 'Submit & Continue'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
