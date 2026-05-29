'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import AppShell from '@/components/AppShell';

const MONTHS     = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

const TYPE_COLORS = {
  holiday: { bg: '#fee2e2', color: '#dc2626', label: 'Holiday' },
  leave:   { bg: '#dcfce7', color: '#16a34a', label: 'Leave' },
  task:    { bg: '#fef3c7', color: '#d97706', label: 'Task' },
  payroll: { bg: '#ede9fe', color: '#7c3aed', label: 'Payroll' },
};

export default function CalendarPage() {
  const { user } = useAuth();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [selectedDay, setSelectedDay] = useState(null);
  const [filterType, setFilterType] = useState('');

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

        // Approved leaves — one event per day of the leave range
        for (const l of (Array.isArray(leaves) ? leaves : [])) {
          const start = new Date(l.from), end = new Date(l.to);
          for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            all.push({
              id: `leave-${l._id}-${d.toISOString().slice(0,10)}`,
              title: `${l.userId?.name || 'Employee'} — ${l.type}`,
              date: d.toISOString().slice(0, 10),
              type: 'leave',
            });
          }
        }

        // Tasks with due dates
        for (const t of (Array.isArray(tasks) ? tasks : [])) {
          if (!t.due) continue;
          all.push({
            id: `task-${t._id}`,
            title: `Task: ${t.title}`,
            date: t.due,
            type: 'task',
          });
        }

        // Holidays from settings
        for (const h of (Array.isArray(holidays) ? holidays : [])) {
          all.push({
            id: `holiday-${h._id}`,
            title: h.name,
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

  return (
    <AppShell title="Calendar">
      <div className="page-header">
        <div><h4>Calendar</h4><p>Leaves, tasks, and holidays</p></div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20, alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>Filter:</span>
        <button onClick={() => setFilterType('')}
          style={{ padding: '4px 12px', borderRadius: 20, border: '1px solid #e2e8f0', background: !filterType ? '#1e293b' : '#fff', color: !filterType ? '#fff' : '#64748b', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
          All
        </button>
        {Object.entries(TYPE_COLORS).map(([key, val]) => (
          <button key={key} onClick={() => setFilterType(filterType === key ? '' : key)}
            style={{ padding: '4px 12px', borderRadius: 20, border: `1px solid ${val.color}40`, background: filterType === key ? val.color : val.bg, color: filterType === key ? '#fff' : val.color, fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
            {val.label}
          </button>
        ))}
      </div>

      {loading ? <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner-border text-primary" /></div> : (
        <div className="row g-3">
          <div className="col-lg-8">
            <div className="card p-3">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <button className="btn btn-sm btn-outline-secondary" onClick={() => setCurrentDate(new Date(year, month - 1, 1))}><i className="bi bi-chevron-left" /></button>
                <span style={{ fontWeight: 700, fontSize: 16 }}>{MONTHS[month]} {year}</span>
                <button className="btn btn-sm btn-outline-secondary" onClick={() => setCurrentDate(new Date(year, month + 1, 1))}><i className="bi bi-chevron-right" /></button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
                {DAYS_SHORT.map(d => (
                  <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#94a3b8', padding: '4px 0' }}>{d}</div>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
                {cells.map((day, i) => {
                  if (!day) return <div key={i} />;
                  const dayEvents = getEventsForDay(day);
                  const isSelected = selectedDay === day;
                  const isSun = (i % 7 === 0);
                  return (
                    <div key={i} onClick={() => setSelectedDay(day === selectedDay ? null : day)}
                      style={{
                        minHeight: 64, padding: '6px 4px', borderRadius: 8, cursor: 'pointer',
                        background: isSelected ? '#1e293b' : isToday(day) ? '#eff6ff' : '#fff',
                        border: isToday(day) ? '2px solid #3b82f6' : '1px solid #f1f5f9',
                        transition: 'all 0.1s',
                      }}>
                      <div style={{ fontSize: 12, fontWeight: isToday(day) ? 800 : 600, color: isSelected ? '#fff' : isSun ? '#ef4444' : '#1e293b', marginBottom: 4, textAlign: 'center' }}>{day}</div>
                      {dayEvents.slice(0, 2).map(ev => (
                        <div key={ev.id} style={{ fontSize: 9, background: isSelected ? 'rgba(255,255,255,0.2)' : TYPE_COLORS[ev.type]?.color + '20', color: isSelected ? '#fff' : TYPE_COLORS[ev.type]?.color, borderRadius: 3, padding: '1px 4px', marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 600 }}>
                          {ev.title}
                        </div>
                      ))}
                      {dayEvents.length > 2 && <div style={{ fontSize: 9, color: isSelected ? '#fff' : '#94a3b8', textAlign: 'center' }}>+{dayEvents.length - 2}</div>}
                    </div>
                  );
                })}
              </div>
            </div>

            {selectedDay && (
              <div className="card p-3 mt-3">
                <div className="section-title mb-3">
                  {MONTHS[month]} {selectedDay}, {year}
                  {selectedEvents.length === 0 && <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 400, marginLeft: 8 }}>— No events</span>}
                </div>
                {selectedEvents.map(ev => (
                  <div key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid #f8fafc' }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: TYPE_COLORS[ev.type]?.color, flexShrink: 0 }} />
                    <div style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{ev.title}</div>
                    <span className="badge" style={{ background: TYPE_COLORS[ev.type]?.bg, color: TYPE_COLORS[ev.type]?.color, fontSize: 10 }}>{TYPE_COLORS[ev.type]?.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="col-lg-4">
            <div className="card p-3">
              <div className="section-title mb-3">Upcoming Events</div>
              {upcomingEvents.length === 0
                ? <div className="empty-state" style={{ padding: '20px 0' }}><i className="bi bi-calendar3" /><h6>No upcoming events</h6></div>
                : upcomingEvents.map(ev => (
                  <div key={ev.id} style={{ display: 'flex', gap: 10, padding: '10px 0', borderBottom: '1px solid #f8fafc' }}>
                    <div style={{ width: 40, height: 40, borderRadius: 8, background: TYPE_COLORS[ev.type]?.color + '15', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <span style={{ fontSize: 14, fontWeight: 800, color: TYPE_COLORS[ev.type]?.color, lineHeight: 1 }}>{new Date(ev.date + 'T00:00:00').getDate()}</span>
                      <span style={{ fontSize: 9, color: TYPE_COLORS[ev.type]?.color, fontWeight: 600 }}>{MONTHS[new Date(ev.date + 'T00:00:00').getMonth()].slice(0, 3).toUpperCase()}</span>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: '#1e293b' }}>{ev.title}</div>
                      <span className="badge mt-1" style={{ background: TYPE_COLORS[ev.type]?.bg, color: TYPE_COLORS[ev.type]?.color, fontSize: 10 }}>{TYPE_COLORS[ev.type]?.label}</span>
                    </div>
                  </div>
                ))
              }
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
