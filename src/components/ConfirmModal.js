'use client';

export default function ConfirmModal({
  open,
  title = 'Confirm',
  children,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'primary',
  confirming = false,
  onConfirm,
  onClose,
}) {
  if (!open) return null;
  return (
    <div className="modal show d-block" style={{ background: 'rgba(15,23,42,0.55)', zIndex: 1060 }} onClick={onClose}>
      <div className="modal-dialog modal-dialog-centered" style={{ maxWidth: 420, animation: 'dropIn 0.2s cubic-bezier(0.4,0,0.2,1)' }} onClick={e => e.stopPropagation()}>
        <div className="modal-content" style={{ borderRadius: 16, border: 'none', boxShadow: '0 20px 60px rgba(0,0,0,0.15)', overflow: 'hidden' }}>
          <div className="modal-header" style={{ borderBottom: '1px solid #f1f5f9' }}>
            <h5 className="modal-title" style={{ fontSize: 16, fontWeight: 700 }}>{title}</h5>
            <button className="btn-close" onClick={onClose} aria-label="Close" />
          </div>
          <div className="modal-body">{children}</div>
          <div className="modal-footer" style={{ borderTop: '1px solid #f1f5f9' }}>
            <button className="btn btn-outline-secondary" onClick={onClose} disabled={confirming}>{cancelText}</button>
            <button className={`btn btn-${variant}`} onClick={onConfirm} disabled={confirming}>
              {confirming ? <><span className="spinner-border spinner-border-sm me-2" />Processing...</> : confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
