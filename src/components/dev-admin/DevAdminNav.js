'use client';
import { useAuth } from '@/lib/auth';
import { DEV_ADMIN_EMAILS } from '@/lib/permissions';

export const devNavBtnStyle = (active) => ({
  padding: '10px 20px',
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 600,
  border: 'none',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  transition: 'all 0.2s',
  textDecoration: 'none',
  background: active ? '#ffffff' : 'rgba(255,255,255,0.1)',
  color: active ? '#312e81' : '#ffffff',
});

export default function DevAdminNav({ title, subtitle, children }) {
  const { user } = useAuth();
  return (
    <div style={{
      background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4338ca 100%)',
      borderRadius: 16,
      padding: '24px 28px',
      color: '#fff',
      marginBottom: 24,
      boxShadow: '0 10px 25px -5px rgba(67, 56, 202, 0.3)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span className="badge" style={{ background: '#6366f1', color: '#fff', fontSize: 11, padding: '4px 10px', textTransform: 'uppercase', tracking: '0.05em' }}>
              Phase 1 Testing Instance
            </span>
            <span className="badge" style={{ background: 'rgba(255,255,255,0.15)', color: '#e0e7ff', fontSize: 11, padding: '4px 10px' }}>
              <i className="bi bi-shield-check me-1" />Dev Admin Authorized
            </span>
          </div>
          <h3 style={{ fontWeight: 700, margin: 0, fontSize: 22, color: '#ffffff' }}>
            {title}
          </h3>
          <p style={{ margin: '6px 0 0', color: '#c7d2fe', fontSize: 13 }}>
            {subtitle}
          </p>
        </div>
        <div style={{ background: 'rgba(255, 255, 255, 0.1)', padding: '10px 16px', borderRadius: 12, backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.15)', textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: '#a5b4fc', textTransform: 'uppercase', fontWeight: 600 }}>Active Session</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{user?.email || DEV_ADMIN_EMAILS[0]}</div>
          <div style={{ fontSize: 11, color: '#cbd5e1' }}>Role: Super Admin</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 24, borderTop: '1px solid rgba(255,255,255,0.15)', paddingTop: 16, flexWrap: 'wrap' }}>
        {children}
      </div>
    </div>
  );
}
