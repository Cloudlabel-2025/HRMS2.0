'use client';

export default function ShiftMaster({
  shifts,
  loading,
  endingSessions,
  title = 'Shift Management',
  onAdd,
  onEdit,
  onDelete,
  onEndSession,
  formatTime,
}) {
  const fmt = formatTime || ((t) => t || '');
  return (
    <div className="card p-3 p-md-4">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
        <div className="section-title" style={{ margin: 0 }}>{title}</div>
        <button className="btn btn-primary btn-sm" onClick={onAdd}>
          <i className="bi bi-plus-lg me-1" />Add Shift
        </button>
      </div>
      {loading ? (
        <div style={{ textAlign: 'center', padding: 20 }}><div className="spinner-border text-primary spinner-border-sm" /></div>
      ) : (
        <div className="row g-3">
          {shifts.length === 0 && <div className="col-12"><div className="empty-state" style={{ padding: 20 }}><i className="bi bi-clock" /><h6>No shifts defined</h6></div></div>}
          {shifts.map(s => (
            <div key={s._id} className="col-md-6">
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{s.name}</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn btn-sm btn-outline-warning" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => onEndSession(s)} disabled={endingSessions}>End Session</button>
                    <button className="btn btn-sm btn-outline-primary" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => onEdit(s)}>Edit</button>
                    <button className="btn btn-sm btn-outline-danger"  style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => onDelete(s._id)}>Delete</button>
                  </div>
                </div>
                <div style={{ fontSize: 13, color: '#64748b' }}>
                  <i className="bi bi-clock me-2" />
                  {s.startTime && s.endTime ? `${fmt(s.startTime)} – ${fmt(s.endTime)}` : 'No timing set'}
                </div>
                {Array.isArray(s.breaks) && s.breaks.length > 0 && (
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                    <i className="bi bi-cup me-2" />
                    {s.breaks.map(b => {
                      const hrs = Math.floor((b.maxDuration || 0) / 60);
                      const mins = (b.maxDuration || 0) % 60;
                      const durStr = hrs > 0 ? (mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`) : `${mins}m`;
                      return `${b.name || b.type || 'Break'} ${b.maxCount || 1}x ${durStr}`;
                    }).join(', ')}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
