'use client';
import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useSettings } from '@/lib/settings';
import AppShell from '@/components/AppShell';

const STATUS_STYLE = {
  present: { bg: '#dcfce7', color: '#16a34a' },
  absent: { bg: '#fee2e2', color: '#dc2626' },
  late: { bg: '#fef3c7', color: '#d97706' },
  leave: { bg: '#dbeafe', color: '#2563eb' },
  holiday: { bg: '#f1f5f9', color: '#64748b' },
};

const WP_STATUS_STYLE = {
  pending: { bg: '#f8fafc', color: '#94a3b8' },
  work_in_progress: { bg: '#dbeafe', color: '#2563eb' },
  completed: { bg: '#dcfce7', color: '#16a34a' },
  task_blocked: { bg: '#fef3c7', color: '#d97706' },
  stopped: { bg: '#fee2e2', color: '#dc2626' },
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatMins(mins) {
  if (!mins) return '--';
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function toCsvRows(cycles) {
  const rows = [['Cycle', 'Date', 'Status', 'Clock In', 'Clock Out', 'Hours', '#', 'Type', 'Task Details', 'Start Time', 'End Time', 'Task Status', 'Remarks', 'Feedback']];
  for (const cycle of cycles) {
    for (const d of cycle.dates) {
      if (!d.workProgress?.length) {
        rows.push([cycle.label, d.date, d.status, d.clockIn || '', d.clockOut || '', formatMins(d.hoursWorked), '', '', '', '', '', '', '', '']);
        continue;
      }
      for (let i = 0; i < d.workProgress.length; i++) {
        const wp = d.workProgress[i];
        rows.push([
          cycle.label, d.date, d.status, d.clockIn || '', d.clockOut || '', formatMins(d.hoursWorked),
          String(i + 1), wp.type || 'task', wp.taskDetails || '', wp.startTime || '', wp.endTime || '',
          wp.status || '', wp.remarks || '', wp.feedback || '',
        ]);
      }
    }
  }
  return rows;
}

function triggerDownload(rows, filename) {
  const csv = '\uFEFF' + rows.map(r => r.map(c => `"${(c || '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function FilterCard({ children }) {
  return (
    <div className="card" style={{ borderRadius: 12, marginBottom: 16 }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 10 }}>
        <i className="bi bi-funnel" style={{ color: '#3b82f6', fontSize: 15 }} />
        <span style={{ fontWeight: 750, fontSize: 14.5 }}>Filters</span>
      </div>
      <div style={{ padding: '14px 20px' }}>{children}</div>
    </div>
  );
}

function DownloadTimerModal({ show, remaining, onClose }) {
  if (!show) return null;
  const pct = remaining <= 0 ? 100 : ((1800 - remaining) / 1800) * 100;
  return (
    <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="modal-dialog modal-dialog-centered" style={{ maxWidth: 400 }}>
        <div className="modal-content" style={{ borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ padding: '28px 24px', textAlign: 'center' }}>
            <div style={{
              width: 64, height: 64, borderRadius: '50%', background: '#eff6ff',
              display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px',
            }}>
              <i className="bi bi-download" style={{ fontSize: 28, color: '#3b82f6' }} />
            </div>
            <h6 style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>Preparing Download</h6>
            <p style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>
              Large dataset — download will be ready in approximately 30 minutes
            </p>
            <div style={{ fontSize: 42, fontWeight: 800, fontFamily: 'monospace', color: '#1e293b', marginBottom: 16 }}>
              {formatDuration(remaining)}
            </div>
            <div style={{ height: 8, borderRadius: 4, background: '#f1f5f9', overflow: 'hidden', marginBottom: 20 }}>
              <div style={{ height: '100%', borderRadius: 4, background: 'linear-gradient(90deg, #3b82f6, #2563eb)', width: `${pct}%`, transition: 'width 1s linear' }} />
            </div>
            {remaining <= 0 ? (
              <div className="alert alert-success py-2" style={{ fontSize: 13, margin: 0 }}>
                <i className="bi bi-check-circle me-2" />Download started!
              </div>
            ) : (
              <button className="btn btn-outline-secondary btn-sm" onClick={onClose} style={{ fontSize: 12 }}>
                Minimize
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function WorkProgressPage() {
  const { id } = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { formatDate } = useSettings();

  const [cycles, setCycles] = useState([]);
  const [employee, setEmployee] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedCycle, setExpandedCycle] = useState(null);
  const [expandedDate, setExpandedDate] = useState(null);
  const [toast, setToast] = useState({ msg: '', type: 'success' });

  // Filters
  const [filterFromMonth, setFilterFromMonth] = useState('');
  const [filterToMonth, setFilterToMonth] = useState('');
  const [filterFromDate, setFilterFromDate] = useState('');
  const [filterToDate, setFilterToDate] = useState('');

  // Download timer
  const [showTimer, setShowTimer] = useState(false);
  const [downloadRemaining, setDownloadRemaining] = useState(0);
  const timerRef = useRef(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast({ msg: '', type: 'success' }), 3000);
  };

  useEffect(() => {
    if (!id) return;
    Promise.all([
      api.get(`/api/employees/${id}/work-progress`),
      api.get(`/api/employees/${id}`),
    ])
      .then(([cyclesData, empData]) => {
        setCycles(cyclesData || []);
        setEmployee(empData);
      })
      .catch(e => {
        showToast(e.message, 'error');
        setTimeout(() => router.push('/employees'), 2000);
      })
      .finally(() => setLoading(false));
  }, [id, router]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const toggleCycle = (key) => {
    setExpandedCycle(prev => prev === key ? null : key);
    setExpandedDate(null);
  };

  const toggleDate = (dateId) => {
    setExpandedDate(prev => prev === dateId ? null : dateId);
  };

  const resetFilters = () => {
    setFilterFromMonth('');
    setFilterToMonth('');
    setFilterFromDate('');
    setFilterToDate('');
  };

  // Build available month options from data
  const monthOptions = useMemo(() => {
    const seen = new Set();
    const opts = [];
    for (const cycle of cycles) {
      if (!seen.has(cycle.key)) {
        seen.add(cycle.key);
        opts.push({ key: cycle.key, label: cycle.label });
      }
    }
    return opts;
  }, [cycles]);

  // Apply filters
  const filteredCycles = useMemo(() => {
    let filtered = cycles;

    if (filterFromMonth) {
      filtered = filtered.filter(c => c.key >= filterFromMonth);
    }
    if (filterToMonth) {
      filtered = filtered.filter(c => c.key <= filterToMonth);
    }

    // Date-level filtering
    if (filterFromDate || filterToDate) {
      filtered = filtered.map(c => {
        const dates = c.dates.filter(d => {
          if (filterFromDate && d.date < filterFromDate) return false;
          if (filterToDate && d.date > filterToDate) return false;
          return true;
        });
        return { ...c, dates };
      }).filter(c => c.dates.length > 0);
    }

    return filtered;
  }, [cycles, filterFromMonth, filterToMonth, filterFromDate, filterToDate]);

  const totalEntryCount = useMemo(() => {
    let count = 0;
    for (const c of filteredCycles) {
      for (const d of c.dates) {
        count += d.workProgress?.length || 0;
      }
    }
    return count;
  }, [filteredCycles]);

  const handleDownload = () => {
    const rows = toCsvRows(filteredCycles);
    const entryCount = rows.length - 1; // minus header

    if (entryCount <= 5) {
      triggerDownload(rows, `work_progress_${employee?.name || 'export'}.csv`);
      showToast('Downloaded successfully');
      return;
    }

    // More than 5 entries — start 30-min timer
    if (timerRef.current) clearInterval(timerRef.current);
    setDownloadRemaining(1800);
    setShowTimer(true);

    timerRef.current = setInterval(() => {
      setDownloadRemaining(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          timerRef.current = null;
          triggerDownload(rows, `work_progress_${employee?.name || 'export'}.csv`);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const closeTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setShowTimer(false);
    setDownloadRemaining(0);
  };

  if (loading) return (
    <AppShell title="Loading...">
      <div style={{ textAlign: 'center', padding: 100 }}><div className="spinner-border text-primary" /></div>
    </AppShell>
  );

  return (
    <AppShell title={employee ? `${employee.name} - Work Progress` : 'Work Progress'}>
      {toast.msg && (
        <div className="toast-container-custom">
          <div className={`toast-custom ${toast.type}`}>
            <i className={`bi ${toast.type === 'success' ? 'bi-check-circle' : 'bi-exclamation-circle'} me-2`} />{toast.msg}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="card mb-4" style={{ borderRadius: 16, border: 'none' }}>
        <div style={{ padding: '20px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button onClick={() => router.back()} className="btn btn-sm" style={{ padding: '6px 10px', borderRadius: 8, background: '#f1f5f9', border: 'none', color: '#64748b' }}>
                <i className="bi bi-arrow-left" />
              </button>
              <div>
                <h4 style={{ margin: 0, fontWeight: 800, fontSize: 20, color: '#0f172a' }}>
                  <i className="bi bi-list-check me-2" style={{ color: '#3b82f6' }} />Work Progress
                </h4>
                {employee && (
                  <div style={{ fontSize: 14, color: '#64748b', marginTop: 2 }}>
                    {employee.name} &bull; {employee.department || 'No Department'}
                  </div>
                )}
              </div>
            </div>
            <button className="btn btn-primary" style={{ fontSize: 13, padding: '8px 20px' }} onClick={handleDownload} disabled={filteredCycles.length === 0}>
              <i className="bi bi-download me-2" />Download{filteredCycles.length > 0 ? ` (${totalEntryCount} entries)` : ''}
            </button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <FilterCard>
        <div className="row g-3 align-items-end">
          <div className="col-md-3">
            <label className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>From Month</label>
            <select className="form-select" style={{ fontSize: 13 }} value={filterFromMonth} onChange={e => setFilterFromMonth(e.target.value)}>
              <option value="">All Months</option>
              {monthOptions.map(opt => (
                <option key={opt.key} value={opt.key}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="col-md-3">
            <label className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>To Month</label>
            <select className="form-select" style={{ fontSize: 13 }} value={filterToMonth} onChange={e => setFilterToMonth(e.target.value)}>
              <option value="">All Months</option>
              {monthOptions.map(opt => (
                <option key={opt.key} value={opt.key}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="col-md-2">
            <label className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>From Date</label>
            <input type="date" className="form-control" style={{ fontSize: 13 }} value={filterFromDate} onChange={e => setFilterFromDate(e.target.value)} />
          </div>
          <div className="col-md-2">
            <label className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>To Date</label>
            <input type="date" className="form-control" style={{ fontSize: 13 }} value={filterToDate} onChange={e => setFilterToDate(e.target.value)} />
          </div>
          <div className="col-md-2">
            <button className="btn btn-outline-secondary w-100" style={{ fontSize: 13 }} onClick={resetFilters}>
              <i className="bi bi-x-circle me-1" />Clear
            </button>
          </div>
        </div>
      </FilterCard>

      {filteredCycles.length === 0 ? (
        <div className="card" style={{ borderRadius: 12 }}>
          <div className="empty-state">
            <i className="bi bi-journal-text" />
            <p>No work progress records match the selected filters</p>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filteredCycles.map(cycle => {
            const isCycleOpen = expandedCycle === cycle.key;
            return (
              <div key={cycle.key} className="card" style={{ borderRadius: 12, overflow: 'hidden', border: 'none', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                {/* Cycle header (month) */}
                <button
                  onClick={() => toggleCycle(cycle.key)}
                  style={{
                    width: '100%', padding: '16px 20px', border: 'none', background: isCycleOpen ? '#f8fafc' : '#fff',
                    display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', textAlign: 'left',
                    transition: 'background 0.15s',
                  }}
                >
                  <div style={{
                    width: 40, height: 40, borderRadius: 10,
                    background: isCycleOpen ? '#3b82f615' : '#f1f5f9',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                    <i className="bi bi-calendar3" style={{ color: isCycleOpen ? '#3b82f6' : '#64748b', fontSize: 16 }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: '#1e293b' }}>{cycle.label}</div>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                      {cycle.dates.length} day{cycle.dates.length > 1 ? 's' : ''} with work entries
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, color: '#94a3b8' }}>
                      {cycle.dates.reduce((sum, d) => sum + (d.workProgress?.length || 0), 0)} entries
                    </span>
                    <i className={`bi ${isCycleOpen ? 'bi-chevron-up' : 'bi-chevron-down'}`} style={{ color: '#94a3b8', fontSize: 14 }} />
                  </div>
                </button>

                {/* Dates inside the cycle */}
                {isCycleOpen && (
                  <div style={{ borderTop: '1px solid #f1f5f9' }}>
                    {cycle.dates.map(dateEntry => {
                      const isDateOpen = expandedDate === dateEntry._id;
                      return (
                        <div key={dateEntry._id}>
                          {/* Date row (clickable) */}
                          <button
                            onClick={() => toggleDate(dateEntry._id)}
                            style={{
                              width: '100%', padding: '10px 20px 10px 28px', border: 'none', borderBottom: '1px solid #f1f5f9',
                              background: isDateOpen ? '#f0f7ff' : '#fafbfc',
                              display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', textAlign: 'left',
                            }}
                          >
                            <div style={{ fontWeight: 700, fontSize: 14, color: '#1e293b', minWidth: 120 }}>
                              <i className="bi bi-calendar-day me-2" style={{ color: '#3b82f6' }} />
                              {formatDate(dateEntry.date)}
                            </div>
                            <span className="badge" style={{
                              background: (STATUS_STYLE[dateEntry.status] || STATUS_STYLE.present).bg,
                              color: (STATUS_STYLE[dateEntry.status] || STATUS_STYLE.present).color,
                              fontSize: 11, fontWeight: 600,
                            }}>
                              {dateEntry.status}
                            </span>
                            <div style={{ fontSize: 13, color: '#64748b' }}>
                              <i className="bi bi-box-arrow-in-right me-1" />{dateEntry.clockIn || '--'}
                            </div>
                            <div style={{ fontSize: 13, color: '#64748b' }}>
                              <i className="bi bi-box-arrow-right me-1" />{dateEntry.clockOut || '--'}
                            </div>
                            <div style={{ fontSize: 13, color: '#64748b' }}>
                              <i className="bi bi-clock me-1" />{formatMins(dateEntry.hoursWorked)}
                            </div>
                            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontSize: 12, color: '#94a3b8' }}>
                                {dateEntry.workProgress?.length || 0} task{dateEntry.workProgress?.length !== 1 ? 's' : ''}
                              </span>
                              <i className={`bi ${isDateOpen ? 'bi-chevron-up' : 'bi-chevron-down'}`} style={{ color: '#94a3b8', fontSize: 13 }} />
                            </div>
                          </button>

                          {/* Work progress table for the date */}
                          {isDateOpen && (
                            <div style={{ borderBottom: '1px solid #f1f5f9' }}>
                              {dateEntry.workProgress?.length > 0 ? (
                                <div style={{ padding: '12px 20px 16px 28px' }}>
                                  <div className="table-responsive">
                                    <table className="table mb-0" style={{ fontSize: 13 }}>
                                      <thead>
                                        <tr>
                                          <th style={{ width: 50 }}>#</th>
                                          <th style={{ minWidth: 200 }}>Task Details</th>
                                          <th style={{ width: 100 }}>Start</th>
                                          <th style={{ width: 100 }}>End</th>
                                          <th style={{ width: 140 }}>Status</th>
                                          <th style={{ minWidth: 160 }}>Remarks</th>
                                          <th style={{ minWidth: 160 }}>Feedback</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {dateEntry.workProgress.map((wp, idx) => {
                                          const isBreak = wp.type === 'break' || wp.type === 'lunch';
                                          const st = WP_STATUS_STYLE[wp.status] || WP_STATUS_STYLE.pending;
                                          return (
                                            <tr key={idx} style={{ background: isBreak ? '#f8fafc' : 'transparent' }}>
                                              <td style={{ fontWeight: 700, color: '#94a3b8' }}>{idx + 1}</td>
                                              <td>
                                                {isBreak ? (
                                                  <span className="badge" style={{
                                                    background: wp.type === 'lunch' ? '#f5f3ff' : '#fffbeb',
                                                    color: wp.type === 'lunch' ? '#7c3aed' : '#d97706',
                                                    fontSize: 11.5, fontWeight: 700,
                                                  }}>
                                                    <i className={`bi ${wp.type === 'lunch' ? 'bi-egg-fried' : 'bi-cup-hot'} me-1`} />
                                                    {wp.type === 'lunch' ? 'Lunch break' : 'Break'}
                                                  </span>
                                                ) : (
                                                  <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
                                                    {wp.taskDetails || '—'}
                                                  </span>
                                                )}
                                              </td>
                                              <td style={{ fontSize: 13, fontWeight: 600 }}>{wp.startTime || '--'}</td>
                                              <td style={{ fontSize: 13, fontWeight: 600 }}>{wp.endTime || '--'}</td>
                                              <td>
                                                <span style={{
                                                  fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                                                  background: st.bg, color: st.color, textTransform: 'capitalize',
                                                }}>
                                                  {wp.status?.replace(/_/g, ' ') || 'pending'}
                                                </span>
                                              </td>
                                              <td style={{ fontSize: 12, color: '#64748b', maxWidth: 200 }}>
                                                {wp.remarks || '—'}
                                              </td>
                                              <td style={{ fontSize: 12, color: '#64748b', maxWidth: 200 }}>
                                                {wp.feedback || '—'}
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              ) : (
                                <div style={{ padding: '12px 20px 12px 28px', fontSize: 13, color: '#94a3b8', fontStyle: 'italic' }}>
                                  No work entries for this date
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Download timer modal */}
      <DownloadTimerModal
        show={showTimer}
        remaining={downloadRemaining}
        onClose={closeTimer}
      />
    </AppShell>
  );
}
