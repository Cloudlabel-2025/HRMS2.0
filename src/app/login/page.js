'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const result = await login(form.email, form.password);
    setLoading(false);
    if (result.success) {
      router.push(result.isFirstLogin ? '/settings?firstLogin=1' : '/dashboard');
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
                />
              </div>
            </div>

            <div className="mb-4">
              <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Password</label>
              <div style={{ position: 'relative' }}>
                <i className="bi bi-lock" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: 14 }} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="form-control"
                  placeholder="••••••••"
                  style={{ paddingLeft: 36, paddingRight: 36 }}
                  value={form.password}
                  onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                  required
                />
                <i
                  className={`bi bi-eye${showPassword ? '-slash' : ''}`}
                  onClick={() => setShowPassword(p => !p)}
                  style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: 14, cursor: 'pointer' }}
                />
              </div>
            </div>

            <button type="submit" className="btn btn-primary w-100" disabled={loading} style={{ padding: '10px', fontWeight: 600 }}>
              {loading ? <><span className="spinner-border spinner-border-sm me-2" />Signing in...</> : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
