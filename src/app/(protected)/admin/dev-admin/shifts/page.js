'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useSettings } from '@/lib/settings';
import AppShell from '@/components/AppShell';
import ConfirmModal from '@/components/ConfirmModal';
import ShiftMaster from '@/components/dev-admin/ShiftMaster';
import ShiftFormModal, { DEFAULT_SHIFT_FORM, validateShiftForm } from '@/components/dev-admin/ShiftFormModal';

export default function DevAdminShiftsPage() {
  const { user } = useAuth();
  const { formatTime } = useSettings();
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [modalForm, setModalForm] = useState({});
  const [shiftErrs, setShiftErrs] = useState({});
  const [endingSessions, setEndingSessions] = useState(false);
  const [endSessionTarget, setEndSessionTarget] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

  const load = async () => {
    setLoading(true);
    try {
      const s = await api.get('/api/settings?type=shifts');
      setShifts(Array.isArray(s) ? s : []);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (user) load(); }, [user]);

  const saveShift = async () => {
    const errs = validateShiftForm(modalForm);
    setShiftErrs(errs);
    if (Object.keys(errs).length > 0) return;
    setSaving(true);
    try {
      if (modalForm._id) {
        const { _id, createdAt, updatedAt, __v, members, ...clean } = modalForm;
        await api.put('/api/settings', { type: 'shifts', id: modalForm._id, ...clean });
      } else {
        await api.post('/api/settings', { type: 'shifts', ...modalForm });
      }
      showToast('Saved successfully');
      setShowForm(false);
      load();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const deleteShift = async (id) => {
    if (!confirm('Are you sure you want to delete this?')) return;
    try {
      await api.delete('/api/settings', { type: 'shifts', id });
      showToast('Deleted');
      load();
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const confirmEndSessions = async () => {
    if (!endSessionTarget) return;
    setEndingSessions(true);
    try {
      const res = await api.post('/api/attendance/end-shift-sessions', { shiftId: endSessionTarget._id });
      showToast(res?.message || 'Sessions ended');
      setEndSessionTarget(null);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setEndingSessions(false);
    }
  };

  return (
    <AppShell title="Shifts">
      {toast && (
        <div className="toast-container-custom">
          <div className={'toast-custom ' + toast.type}>
            <i className={'bi ' + (toast.type === 'success' ? 'bi-check-circle' : 'bi-exclamation-circle') + ' me-2'} />{toast.msg}
          </div>
        </div>
      )}

      <div className="page-header">
        <div><h4>Shifts</h4><p>Create, edit and manage shift definitions, work-hour policy and breaks</p></div>
      </div>

      <ShiftMaster
        shifts={shifts}
        loading={loading}
        endingSessions={endingSessions}
        formatTime={formatTime}
        onAdd={() => { setModalForm({ ...DEFAULT_SHIFT_FORM }); setShiftErrs({}); setShowForm(true); }}
        onEdit={(s) => { setModalForm({ ...s }); setShiftErrs({}); setShowForm(true); }}
        onDelete={deleteShift}
        onEndSession={setEndSessionTarget}
      />

      {showForm && (
        <ShiftFormModal
          form={modalForm}
          setForm={setModalForm}
          errors={shiftErrs}
          setErrors={setShiftErrs}
          saving={saving}
          onSave={saveShift}
          onClose={() => setShowForm(false)}
        />
      )}

      <ConfirmModal
        open={!!endSessionTarget}
        title="End Active Sessions"
        confirmText="End Sessions"
        variant="danger"
        confirming={endingSessions}
        onClose={() => setEndSessionTarget(null)}
        onConfirm={confirmEndSessions}
      >
        <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>
          End all active sessions for <strong>{endSessionTarget?.name}</strong>? This will clock out
          every employee currently clocked in on this shift.
        </p>
      </ConfirmModal>
    </AppShell>
  );
}
