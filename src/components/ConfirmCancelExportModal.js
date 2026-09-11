'use client';
import { useEffect } from 'react';

export default function ConfirmCancelExportModal({ show, onConfirm, onClose }) {
  useEffect(() => {
    if (!show) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [show, onClose]);

  if (!show) return null;

  return (
    <div
      className="modal show d-block"
      style={{ background: 'rgba(0,0,0,0.55)', zIndex: 1060 }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Confirm cancel download"
    >
      <div className="modal-dialog modal-dialog-centered" style={{ maxWidth: 380 }} onClick={e => e.stopPropagation()}>
        <div className="modal-content" style={{ borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ padding: '24px 22px', textAlign: 'center' }}>
            <div style={{ width: 52, height: 52, borderRadius: '50%', background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
              <i className="bi bi-exclamation-triangle" style={{ color: '#ef4444', fontSize: 22 }} />
            </div>
            <h6 style={{ fontWeight: 800, fontSize: 16, marginBottom: 6 }}>Cancel download?</h6>
            <p style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>
              Your Daily Work Sheet Excel is still preparing. If you cancel, the countdown will stop and you will need to start the export again.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button className="btn btn-outline-secondary btn-sm" onClick={onClose} style={{ fontSize: 12, padding: '6px 16px' }}>
                Keep Downloading
              </button>
              <button className="btn btn-danger btn-sm" onClick={onConfirm} style={{ fontSize: 12, padding: '6px 16px' }}>
                Yes, Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
