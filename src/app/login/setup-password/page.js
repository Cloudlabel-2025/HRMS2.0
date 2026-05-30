'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

export default function SetupPasswordPage() {
  const router = useRouter();
  const { user, logout } = useAuth();
  
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      return setError('New passwords do not match');
    }
    if (newPassword.length < 6) {
      return setError('Password must be at least 6 characters');
    }

    setLoading(true);
    try {
      const token = localStorage.getItem('hrms_token');
      const res = await fetch('/api/auth/setup-password', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error || 'Failed to set up password');
      
      setSuccess(true);
      setTimeout(() => {
        logout();
        router.push('/login');
      }, 3000);
      
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="login-page">
        <div style={{ width: '100%', maxWidth: 440, padding: '0 16px' }}>
          <div className="login-card text-center">
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#10b98120', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <i className="bi bi-check-lg" style={{ color: '#10b981', fontSize: 24 }} />
            </div>
            <h5 style={{ fontWeight: 700 }}>Setup Complete</h5>
            <p style={{ color: '#64748b', fontSize: 13, marginBottom: 24 }}>Your password has been securely updated. You must now log in with your new credentials.</p>
            <p style={{ color: '#94a3b8', fontSize: 12 }}>Redirecting to login...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div style={{ width: '100%', maxWidth: 440, padding: '0 16px' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <h4 style={{ color: '#fff', fontWeight: 700, margin: 0 }}>Welcome, {user?.name?.split(' ')[0] || 'User'}!</h4>
          <p style={{ color: '#94a3b8', fontSize: 13, margin: '4px 0 0' }}>Please set up your permanent password</p>
        </div>

        <div className="login-card">
          <div className="alert alert-warning d-flex align-items-center gap-2 py-2 mb-4" style={{ fontSize: 13, borderRadius: 8 }}>
            <i className="bi bi-shield-lock-fill" />
            You are required to change your temporary password before accessing the system.
          </div>

          {error && <div className="alert alert-danger" style={{ fontSize: 13, padding: '10px' }}>{error}</div>}

          <form onSubmit={handleSubmit}>
            <div className="mb-3">
              <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Temporary Password</label>
              <div style={{ position: 'relative' }}>
                <i className="bi bi-key" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: 14 }} />
                <input
                  type="password"
                  className="form-control"
                  placeholder="Enter temporary password"
                  style={{ paddingLeft: 36 }}
                  value={currentPassword}
                  onChange={e => setCurrentPassword(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="mb-3">
              <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>New Password</label>
              <div style={{ position: 'relative' }}>
                <i className="bi bi-lock" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: 14 }} />
                <input
                  type="password"
                  className="form-control"
                  placeholder="••••••••"
                  style={{ paddingLeft: 36 }}
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="mb-4">
              <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Confirm New Password</label>
              <div style={{ position: 'relative' }}>
                <i className="bi bi-lock-fill" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: 14 }} />
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
              {loading ? <><span className="spinner-border spinner-border-sm me-2" />Updating...</> : 'Save & Continue to Login'}
            </button>
            
            <button type="button" className="btn btn-light w-100 mt-2" onClick={() => logout()} style={{ padding: '10px', fontWeight: 600, fontSize: 13 }}>
              Cancel & Log Out
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
