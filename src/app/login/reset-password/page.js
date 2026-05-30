'use client';
import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const emailParam = searchParams.get('email');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!token || !emailParam) {
      setError('Invalid password reset link. Missing token or email.');
    }
  }, [token, emailParam]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    if (password !== confirmPassword) {
      return setError('Passwords do not match');
    }
    if (password.length < 6) {
      return setError('Password must be at least 6 characters');
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailParam, token, newPassword: password }),
      });
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error || 'Failed to reset password');
      setSuccess(true);
      setTimeout(() => router.push('/login'), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!token || !emailParam) {
    return (
      <div className="alert alert-danger" style={{ fontSize: 13, padding: '10px' }}>
        {error}
      </div>
    );
  }

  if (success) {
    return (
      <div className="text-center">
        <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#10b98120', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
          <i className="bi bi-check-lg" style={{ color: '#10b981', fontSize: 24 }} />
        </div>
        <h5 style={{ fontWeight: 700 }}>Password Reset Successful</h5>
        <p style={{ color: '#64748b', fontSize: 13, marginBottom: 24 }}>Your password has been updated. Redirecting to login...</p>
        <Link href="/login" className="btn btn-primary w-100" style={{ padding: '10px', fontWeight: 600 }}>Go to Login</Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <div className="alert alert-danger" style={{ fontSize: 13, padding: '10px' }}>{error}</div>}

      <div className="mb-3">
        <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>New Password</label>
        <div style={{ position: 'relative' }}>
          <i className="bi bi-lock" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: 14 }} />
          <input
            type="password"
            className="form-control"
            placeholder="••••••••"
            style={{ paddingLeft: 36 }}
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
        </div>
      </div>

      <div className="mb-4">
        <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Confirm New Password</label>
        <div style={{ position: 'relative' }}>
          <i className="bi bi-lock" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: 14 }} />
          <input
            type="password"
            className="form-control"
            placeholder="••••••••"
            style={{ paddingLeft: 36 }}
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            required
          />
        </div>
      </div>

      <button type="submit" className="btn btn-primary w-100" disabled={loading} style={{ padding: '10px', fontWeight: 600 }}>
        {loading ? <><span className="spinner-border spinner-border-sm me-2" />Resetting...</> : 'Reset Password'}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="login-page">
      <div style={{ width: '100%', maxWidth: 440, padding: '0 16px' }}>
        <div className="login-card">
          <h5 style={{ fontWeight: 700, marginBottom: 4 }}>Set New Password</h5>
          <p style={{ color: '#64748b', fontSize: 13, marginBottom: 24 }}>Enter your new password below</p>
          <Suspense fallback={<div className="text-center p-3"><div className="spinner-border text-primary" /></div>}>
            <ResetPasswordForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
