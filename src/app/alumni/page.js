'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

const CLEARANCE_LABELS = {
  assetReturned: 'Assets returned',
  accessRevoked: 'Access closed',
  finalSettlement: 'Final settlement',
  exitInterviewDone: 'Exit interview',
  nocIssued: 'NOC issued',
  relievingLetter: 'Relieving letter',
};

const formatDate = value => value
  ? new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value))
  : '—';
const label = value => String(value || '—').replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());

function Detail({ caption, value }) {
  return <div style={{padding:'14px 16px',background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:12}}><div style={{fontSize:11,fontWeight:700,color:'#94a3b8',textTransform:'uppercase',letterSpacing:.5,marginBottom:4}}>{caption}</div><div style={{fontSize:14,fontWeight:650,color:'#1e293b'}}>{value || '—'}</div></div>;
}

export default function AlumniPortalPage() {
  const { user, loading: authLoading, logout } = useAuth();
  const router = useRouter();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const historyGuarded = useRef(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) return router.replace('/login');
    if (user.portalAccess !== 'alumni') return router.replace('/dashboard');
    fetch('/api/alumni/me', { credentials: 'same-origin' })
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Unable to load alumni profile');
        setData(result.data);
      })
      .catch(e => setError(e.message));
  }, [user, authLoading, router]);

  useEffect(() => {
    if (authLoading || user?.portalAccess !== 'alumni') return;

    // Keep one same-page history entry so the browser Back button is handled
    // inside the portal instead of leaving the app/new-tab landing page.
    if (!historyGuarded.current) {
      window.history.pushState({ alumniPortalGuard: true }, '', window.location.href);
      historyGuarded.current = true;
    }
    const handleBack = () => {
      logout();
      window.location.replace('/login');
    };
    window.addEventListener('popstate', handleBack);
    return () => window.removeEventListener('popstate', handleBack);
  }, [user, authLoading, logout]);

  const signOut = () => {
    logout();
    router.replace('/login');
  };

  if (authLoading || !user || (!data && !error)) return <div style={{minHeight:'100vh',display:'grid',placeItems:'center',background:'#f1f5f9'}}><div className="spinner-border text-primary" /></div>;

  const employment = data?.employment || {};
  const checklist = employment.clearanceChecklist || {};
  const completed = Object.values(checklist).filter(Boolean).length;

  return (
    <div style={{minHeight:'100vh',background:'linear-gradient(180deg,#0f172a 0,#1e293b 260px,#f1f5f9 260px)',padding:'28px 16px 48px'}}>
      <div style={{maxWidth:960,margin:'0 auto'}}>
        <header style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,marginBottom:30,color:'#fff'}}>
          <div style={{display:'flex',alignItems:'center',gap:12}}><div style={{width:44,height:44,borderRadius:13,background:'linear-gradient(135deg,#14b8a6,#3b82f6)',display:'grid',placeItems:'center'}}><i className="bi bi-mortarboard-fill" style={{fontSize:20}} /></div><div><div style={{fontSize:20,fontWeight:800}}>CHC Alumni Portal</div><div style={{fontSize:12,color:'#cbd5e1'}}>Your employment exit information</div></div></div>
          <button className="btn btn-outline-light btn-sm" onClick={signOut}><i className="bi bi-box-arrow-right me-2" />Sign out</button>
        </header>

        {error ? <div className="alert alert-danger">{error}</div> : <>
          <section style={{background:'#fff',borderRadius:18,padding:24,boxShadow:'0 18px 45px rgba(15,23,42,.16)',marginBottom:20}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'start',gap:16,flexWrap:'wrap',marginBottom:22}}><div><div style={{fontSize:12,color:'#64748b',fontWeight:700,textTransform:'uppercase'}}>Welcome back</div><h2 style={{fontSize:25,fontWeight:800,color:'#0f172a',margin:'3px 0'}}>{data.person.name}</h2><div style={{fontSize:13,color:'#64748b'}}>{data.person.email}</div></div><span style={{padding:'6px 13px',borderRadius:20,background:employment.employmentStatus === 'terminated' ? '#fef2f2' : '#f0fdfa',color:employment.employmentStatus === 'terminated' ? '#dc2626' : '#0f766e',fontSize:12,fontWeight:750}}>{label(employment.employmentStatus)}</span></div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:12}}><Detail caption="Employee number" value={employment.employeeNumber} /><Detail caption="Department" value={employment.department} /><Detail caption="Last designation" value={employment.designation} /><Detail caption="Last working date" value={formatDate(employment.lastWorkingDate)} /></div>
          </section>

          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(300px,1fr))',gap:20}}>
            <section style={{background:'#fff',borderRadius:16,padding:22,border:'1px solid #e2e8f0'}}><h5 style={{fontWeight:800,color:'#0f172a',marginBottom:18}}><i className="bi bi-briefcase me-2 text-primary" />Employment summary</h5><div style={{display:'grid',gap:12}}><Detail caption="Hire date" value={formatDate(employment.hireDate)} /><Detail caption="Separation type" value={label(employment.separationType)} /><Detail caption="Notice period" value={`${employment.noticePeriodDays || 0} days`} /><Detail caption="Settlement" value={label(employment.settlementStatus)} /></div></section>
            <section style={{background:'#fff',borderRadius:16,padding:22,border:'1px solid #e2e8f0'}}><div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}><h5 style={{fontWeight:800,color:'#0f172a',margin:0}}><i className="bi bi-clipboard-check me-2 text-success" />Exit clearance</h5><span style={{fontSize:12,fontWeight:700,color:'#64748b'}}>{completed}/6</span></div><div style={{display:'grid',gap:9}}>{Object.entries(CLEARANCE_LABELS).map(([key,text]) => <div key={key} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',borderRadius:10,background:checklist[key] ? '#f0fdf4' : '#f8fafc',color:checklist[key] ? '#15803d' : '#64748b',fontSize:13,fontWeight:600}}><i className={`bi ${checklist[key] ? 'bi-check-circle-fill' : 'bi-circle'}`} />{text}</div>)}</div>{employment.isLocked && <div className="alert alert-success py-2 mt-3 mb-0" style={{fontSize:12}}>Exit clearance completed on {formatDate(employment.clearedAt)}.</div>}</section>
          </div>
          <div style={{marginTop:20,padding:'14px 18px',borderRadius:12,background:'#e0f2fe',color:'#075985',fontSize:13}}><i className="bi bi-info-circle me-2" />For corrections, settlement questions, or employment letters, please contact HR.</div>
        </>}
      </div>
    </div>
  );
}
