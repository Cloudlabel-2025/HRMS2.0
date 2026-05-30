'use client';
import { useState } from 'react';
import Link from 'next/link';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error || 'Failed to request password reset');
      setMessage(data.data.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div style={{ width: '100%', maxWidth: 440, padding: '0 16px' }}>
        <div className="login-card">
          <h5 style={{ fontWeight: 700, marginBottom: 4 }}>Reset Password</h5>
          <p style={{ color: '#64748b', fontSize: 13, marginBottom: 24 }}>Enter your email and we will send you a reset link</p>

          {error && <div className="alert alert-danger" style={{ fontSize: 13, padding: '10px' }}>{error}</div>}
          {message && <div className="alert alert-success" style={{ fontSize: 13, padding: '10px' }}>{message}</div>}

          {!message && (
            <form onSubmit={handleSubmit}>
              <div className="mb-4">
                <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Email Address</label>
                <div style={{ position: 'relative' }}>
                  <i className="bi bi-envelope" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: 14 }} />
                  <input
                    type="email"
                    className="form-control"
                    placeholder="you@company.com"
                    style={{ paddingLeft: 36 }}
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                  />
                </div>
              </div>

              <button type="submit" className="btn btn-primary w-100 mb-3" disabled={loading} style={{ padding: '10px', fontWeight: 600 }}>
                {loading ? <><span className="spinner-border spinner-border-sm me-2" />Sending...</> : 'Send Reset Link'}
              </button>
            </form>
          )}

          <div style={{ textAlign: 'center' }}>
            <Link href="/login" style={{ fontSize: 13, textDecoration: 'none', color: '#3b82f6', fontWeight: 600 }}>
              <i className="bi bi-arrow-left me-1" /> Back to Login
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
