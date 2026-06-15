'use client';
import { useState, useEffect, useRef } from 'react';
import { useAuth, ROLE_COLORS } from '@/lib/auth';
import { api } from '@/lib/api';
import { useSettings } from '@/lib/settings';
import AppShell from '@/components/AppShell';

const MONTHS     = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

const TYPE_COLORS = {
  holiday: { bg: '#fee2e2', color: '#dc2626', label: 'Holiday', icon: 'bi-balloon' },
  leave:   { bg: '#dcfce7', color: '#16a34a', label: 'Leave',   icon: 'bi-calendar-check' },
  task:    { bg: '#fef3c7', color: '#d97706', label: 'Task',    icon: 'bi-check2-square' },
  payroll: { bg: '#ede9fe', color: '#7c3aed', label: 'Payroll', icon: 'bi-cash-stack' },
};

export default function CalendarPage() {
  const { user } = useAuth();
  const { formatDate } = useSettings();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [selectedDay, setSelectedDay] = useState(null);
  const [filterType, setFilterType] = useState('');
  const [viewMode, setViewMode] = useState('month');
  const gridRef = useRef(null);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      try {
        const [leaves, tasks, holidays] = await Promise.all([
          api.get('/api/leave?status=approved'),
          api.get('/api/tasks'),
          api.get('/api/settings?type=holidays'),
        ]);

        const all = [];

        for (const l of (Array.isArray(leaves) ? leaves : [])) {
          const start = new Date(l.from), end = new Date(l.to);
          for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            all.push({
              id: `leave-${l._id}-${d.toISOString().slice(0,10)}`,
              title: `${l.userId?.name || 'Employee'} — ${l.type}`,
              subtitle: l.reason,
              date: d.toISOString().slice(0, 10),
              type: 'leave',
            });
          }
        }

        for (const t of (Array.isArray(tasks) ? tasks : [])) {
          if (!t.due) continue;
          all.push({
            id: `task-${t._id}`,
            title: t.title,
            subtitle: t.projectId?.name,
            date: t.due,
            type: 'task',
          });
        }

        for (const h of (Array.isArray(holidays) ? holidays : [])) {
          all.push({
            id: `holiday-${h._id}`,
            title: h.name,
            subtitle: h.type,
            date: h.date,
            type: 'holiday',
          });
        }

        setEvents(all);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user]);

  const year     = currentDate.getFullYear();
  const month    = currentDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const getEventsForDay = (day) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return events.filter(e => e.date === dateStr && (!filterType || e.type === filterType));
  };

  const today = new Date();
  const isToday = (d) => d === today.getDate() && month === today.getMonth() && year === today.getFullYear();

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const selectedEvents = selectedDay ? getEventsForDay(selectedDay) : [];

  const upcomingEvents = events
    .filter(e => e.date >= today.toISOString().slice(0, 10) && (!filterType || e.type === filterType))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 8);

  const eventCounts = {};
  for (const e of events) {
    if (!filterType || e.type === filterType) {
      eventCounts[e.date] = (eventCounts[e.date] || 0) + 1;
    }
  }

  const scrollToToday = () => {
    setCurrentDate(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDay(today.getDate());
  };

  return (
    <AppShell title="Calendar">
      {/* Header */}
      <div style={{
        background: `linear-gradient(135deg, ${ROLE_COLORS[user?.role] || '#3b82f6'} 0%, #1e293b 100%)`,
        borderRadius: 20, padding: '24px 28px', marginBottom: 24,
        color: '#fff', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: '-40px', right: '-20px', width: 200, height: 200, borderRadius: '50%', background: 'rgba(255,255,255,0.04)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: '-60px', left: '25%', width: 140, height: 140, borderRadius: '50%', background: 'rgba(255,255,255,0.03)', pointerEvents: 'none' }} />
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h5 style={{ margin: 0, fontWeight: 700, fontSize: 20, letterSpacing: '-0.01em' }}>
              <i className="bi bi-calendar3 me-2" style={{ opacity: 0.8 }} />Calendar
            </h5>
            <p style={{ margin: '4px 0 0', opacity: 0.75, fontSize: 13 }}>
              {MONTHS[month]} {year} · {events.length} event{events.length !== 1 ? 's' : ''} · {formatDate(new Date(), { weekday: true })}
            </p>
          </div>
          <button onClick={scrollToToday} style={{
            padding: '8px 18px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.25)',
            background: 'rgba(255,255,255,0.1)', color: '#fff', fontSize: 13, fontWeight: 600,
            cursor: 'pointer', backdropFilter: 'blur(4px)', transition: 'all 0.2s',
          }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.2)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}>
            <i className="bi bi-dot me-1" style={{ fontSize: 18, verticalAlign: 'middle' }} />Today
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20, alignItems: 'center' }}>
        {[
          { key: '', label: 'All', icon: 'bi-funnel' },
          ...Object.entries(TYPE_COLORS).map(([key, val]) => ({ key, label: val.label, icon: val.icon, color: val.color, bg: val.bg })),
        ].map(item => {
          const active = filterType === item.key;
          const isColored = item.color;
          return (
            <button key={item.key} onClick={() => setFilterType(active ? '' : item.key)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '7px 16px', borderRadius: 999,
                border: isColored ? `1.5px solid ${item.color}30` : `1.5px solid #e2e8f0`,
                background: active ? (isColored ? item.color : '#1e293b') : (isColored ? item.bg : '#fff'),
                color: active ? '#fff' : (isColored ? item.color : '#64748b'),
                fontSize: 12.5, cursor: 'pointer', fontWeight: 600,
                boxShadow: active ? `0 2px 8px ${isColored ? item.color + '40' : 'rgba(0,0,0,0.1)'}` : 'none',
                transition: 'all 0.2s',
              }}>
              <i className={`bi ${item.icon}`} style={{ fontSize: 13 }} />
              {item.label}
              {!item.key && <span style={{
                background: 'rgba(255,255,255,0.2)', borderRadius: 10,
                padding: '1px 7px', fontSize: 11, marginLeft: 2,
              }}>{events.length}</span>}
            </button>
          );
        })}
      </div>

      {loading ? <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner-border text-primary" /></div> : (
        <div className="row g-3">
          <div className="col-lg-8">
            {/* Calendar Card */}
            <div className="card" style={{ border: 'none', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', borderRadius: 16, overflow: 'hidden' }}>
              {/* Navigation */}
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '16px 20px', borderBottom: '1px solid #f1f5f9',
                background: '#fafbfc',
              }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-sm" style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 10px', background: '#fff' }}
                    onClick={() => setCurrentDate(new Date(year, month - 1, 1))}>
                    <i className="bi bi-chevron-left" style={{ fontSize: 13 }} />
                  </button>
                  <button className="btn btn-sm" style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 10px', background: '#fff' }}
                    onClick={() => setCurrentDate(new Date(year, month + 1, 1))}>
                    <i className="bi bi-chevron-right" style={{ fontSize: 13 }} />
                  </button>
                </div>
                <span style={{ fontWeight: 700, fontSize: 17, color: '#0f172a' }}>{MONTHS[month]} {year}</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  {['month', 'list'].map(v => (
                    <button key={v} onClick={() => setViewMode(v)}
                      style={{
                        padding: '5px 12px', borderRadius: 8, border: 'none',
                        background: viewMode === v ? '#1e293b' : 'transparent',
                        color: viewMode === v ? '#fff' : '#64748b',
                        fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        transition: 'all 0.15s',
                      }}>
                      <i className={`bi ${v === 'month' ? 'bi-calendar3' : 'bi-list-ul'} me-1`} />
                      {v === 'month' ? 'Month' : 'List'}
                    </button>
                  ))}
                </div>
              </div>

              {viewMode === 'month' ? (
                <>
                  {/* Weekday headers */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0, padding: '8px 12px 0', background: '#fafbfc' }}>
                    {DAYS_SHORT.map(d => (
                      <div key={d} style={{
                        textAlign: 'center', fontSize: 11, fontWeight: 700,
                        color: d === 'Sun' ? '#ef4444' : '#94a3b8',
                        padding: '6px 0', letterSpacing: 0.3, textTransform: 'uppercase',
                      }}>{d}</div>
                    ))}
                  </div>

                  {/* Grid */}
                  <div ref={gridRef} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0, padding: '4px 12px 16px' }}>
                    {cells.map((day, i) => {
                      if (!day) return <div key={i} />;
                      const dayEvents = getEventsForDay(day);
                      const isSelected = selectedDay === day;
                      const isSun = (i % 7 === 0);
                      const count = eventCounts[`${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`] || 0;
                      const typeColors = [...new Set(dayEvents.map(e => e.type))].map(t => TYPE_COLORS[t]?.color).filter(Boolean);
                      const bgTint = typeColors.length > 0 ? typeColors[0] + '12' : 'transparent';
                      return (
                        <div key={i} onClick={() => setSelectedDay(day === selectedDay ? null : day)}
                          style={{
                            minHeight: 80, padding: '8px 6px', cursor: 'pointer',
                            background: isSelected ? '#1e293b' : isToday(day) ? '#eff6ff' : bgTint,
                            borderRight: (i + 1) % 7 === 0 ? 'none' : '1px solid #f1f5f9',
                            borderBottom: '1px solid #f1f5f9',
                            transition: 'all 0.15s',
                            position: 'relative',
                          }}
                          onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = isToday(day) ? '#dbeafe' : '#f1f5f9'; }}
                          onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = isToday(day) ? '#eff6ff' : (count > 0 ? bgTint : 'transparent'); }}>
                          <div style={{
                            fontSize: 12, fontWeight: isToday(day) ? 800 : 600,
                            color: isSelected ? '#fff' : isToday(day) ? '#fff' : (isSun ? '#ef4444' : '#1e293b'),
                            width: 24, height: 24, lineHeight: '24px', borderRadius: '50%',
                            margin: '0 auto',
                            background: isToday(day) ? (isSelected ? 'transparent' : '#3b82f6') : 'transparent',
                          }}>{day}</div>
                          {count > 0 && (
                            <div style={{ display: 'flex', justifyContent: 'center', gap: 3, marginTop: 6 }}>
                              {typeColors.slice(0, 4).map((color, ci) => (
                                <div key={ci} style={{
                                  width: 6, height: 6, borderRadius: '50%',
                                  background: isSelected ? '#fff' : color,
                                  opacity: isSelected ? 0.8 : 0.9,
                                }} />
                              ))}
                              {typeColors.length > 4 && (
                                <div style={{
                                  fontSize: 8, color: isSelected ? 'rgba(255,255,255,0.7)' : '#94a3b8',
                                  fontWeight: 700, lineHeight: '6px',
                                }}>+{typeColors.length - 4}</div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                /* List View */
                <div style={{ padding: '12px 20px 20px' }}>
                  {events.filter(e => !filterType || e.type === filterType).length === 0 ? (
                    <div className="empty-state" style={{ padding: '30px 0' }}><i className="bi bi-calendar3" /><h6>No events this month</h6></div>
                  ) : (
                    events
                      .filter(e => e.date.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`) && (!filterType || e.type === filterType))
                      .sort((a, b) => a.date.localeCompare(b.date))
                      .map(ev => (
                        <div key={ev.id} style={{
                          display: 'flex', alignItems: 'center', gap: 12,
                          padding: '12px 14px', borderRadius: 10,
                          border: '1px solid #f1f5f9', marginBottom: 6,
                          transition: 'all 0.15s',
                        }}
                          onMouseEnter={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.04)'; }}
                          onMouseLeave={e => { e.currentTarget.style.borderColor = '#f1f5f9'; e.currentTarget.style.boxShadow = 'none'; }}>
                          <div style={{
                            width: 44, height: 44, borderRadius: 10, flexShrink: 0,
                            background: TYPE_COLORS[ev.type]?.color + '12',
                            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                          }}>
                            <span style={{ fontSize: 15, fontWeight: 800, color: TYPE_COLORS[ev.type]?.color, lineHeight: 1 }}>{new Date(ev.date + 'T00:00:00').getDate()}</span>
                            <span style={{ fontSize: 8, color: TYPE_COLORS[ev.type]?.color, fontWeight: 700, textTransform: 'uppercase' }}>{MONTHS[new Date(ev.date + 'T00:00:00').getMonth()].slice(0, 3)}</span>
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{ev.title}</div>
                            {ev.subtitle && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>{ev.subtitle}</div>}
                          </div>
                          <span className="badge" style={{
                            background: TYPE_COLORS[ev.type]?.bg, color: TYPE_COLORS[ev.type]?.color,
                            fontSize: 10, fontWeight: 600, padding: '4px 10px', borderRadius: 20, flexShrink: 0,
                          }}>
                            <i className={`bi ${TYPE_COLORS[ev.type]?.icon} me-1`} style={{ fontSize: 9 }} />
                            {TYPE_COLORS[ev.type]?.label}
                          </span>
                        </div>
                      ))
                  )}
                </div>
              )}
            </div>

            {/* Selected Day Detail */}
            {selectedDay && viewMode === 'month' && (
              <div className="card mt-3" style={{ border: 'none', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', borderRadius: 16, overflow: 'hidden' }}>
                <div style={{
                  padding: '16px 20px', borderBottom: '1px solid #f1f5f9',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  <div className="section-title" style={{ margin: 0 }}>
                    <i className="bi bi-calendar-event me-2" style={{ color: '#3b82f6' }} />
                    {MONTHS[month]} {selectedDay}, {year}
                    {selectedEvents.length === 0 && <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 400, marginLeft: 8 }}>— No events</span>}
                  </div>
                  <button className="btn btn-sm btn-outline-secondary" style={{ borderRadius: 8, padding: '4px 10px', fontSize: 12 }}
                    onClick={() => setSelectedDay(null)}>
                    <i className="bi bi-x" />
                  </button>
                </div>
                <div style={{ padding: '4px 8px' }}>
                  {selectedEvents.length === 0 && (
                    <div className="empty-state" style={{ padding: '20px 0' }}>
                      <i className="bi bi-calendar-check" />
                      <h6>No events on this day</h6>
                    </div>
                  )}
                  {selectedEvents.map(ev => (
                    <div key={ev.id} style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '14px 12px', margin: '4px 0', borderRadius: 10,
                      border: '1px solid #f1f5f9',
                      transition: 'all 0.15s',
                    }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.background = '#fafbfc'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = '#f1f5f9'; e.currentTarget.style.background = 'transparent'; }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: 10,
                        background: TYPE_COLORS[ev.type]?.color + '15',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>
                        <i className={`bi ${TYPE_COLORS[ev.type]?.icon}`} style={{ color: TYPE_COLORS[ev.type]?.color, fontSize: 16 }} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{ev.title}</div>
                        {ev.subtitle && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>{ev.subtitle}</div>}
                      </div>
                      <span className="badge" style={{
                        background: TYPE_COLORS[ev.type]?.bg, color: TYPE_COLORS[ev.type]?.color,
                        fontSize: 10, fontWeight: 600, padding: '4px 10px', borderRadius: 20, flexShrink: 0,
                      }}>{TYPE_COLORS[ev.type]?.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Upcoming Events Sidebar */}
          <div className="col-lg-4">
            <div className="card" style={{ border: 'none', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', borderRadius: 16, overflow: 'hidden' }}>
              <div style={{
                padding: '16px 20px', borderBottom: '1px solid #f1f5f9',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: 'linear-gradient(135deg, #3b82f615, #8b5cf615)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <i className="bi bi-skip-forward" style={{ color: '#3b82f6', fontSize: 14 }} />
                </div>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>Upcoming Events</span>
              </div>
              <div style={{ padding: '8px 16px 16px' }}>
                {(upcomingEvents.length === 0) ? (
                  <div className="empty-state" style={{ padding: '30px 0' }}>
                    <i className="bi bi-calendar3" />
                    <h6>No upcoming events</h6>
                  </div>
                ) : (
                  upcomingEvents.map((ev, i) => {
                    const evDate = new Date(ev.date + 'T00:00:00');
                    const isPast = ev.date < today.toISOString().slice(0, 10);
                    return (
                      <div key={ev.id} style={{
                        display: 'flex', gap: 12,
                        padding: '12px 0',
                        borderBottom: i < upcomingEvents.length - 1 ? '1px solid #f1f5f9' : 'none',
                        opacity: isPast ? 0.5 : 1,
                      }}>
                        <div style={{
                          width: 44, height: 44, borderRadius: 10, flexShrink: 0,
                          background: TYPE_COLORS[ev.type]?.color + '12',
                          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <span style={{ fontSize: 15, fontWeight: 800, color: TYPE_COLORS[ev.type]?.color, lineHeight: 1 }}>{evDate.getDate()}</span>
                          <span style={{ fontSize: 8, color: TYPE_COLORS[ev.type]?.color, fontWeight: 700, textTransform: 'uppercase' }}>{MONTHS[evDate.getMonth()].slice(0, 3)}</span>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 600, color: '#0f172a', lineHeight: 1.4 }}>{ev.title}</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                            <span className="badge" style={{
                              background: TYPE_COLORS[ev.type]?.bg, color: TYPE_COLORS[ev.type]?.color,
                              fontSize: 9, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                            }}>
                              <i className={`bi ${TYPE_COLORS[ev.type]?.icon} me-1`} style={{ fontSize: 8 }} />
                              {TYPE_COLORS[ev.type]?.label}
                            </span>
                            {isPast && <span style={{ fontSize: 10, color: '#94a3b8' }}>Past</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
