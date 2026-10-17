'use client';
import { useId } from 'react';

export default function LeaveTypeBalanceFields({ config, configs, onChange }) {
  const id = useId();
  const candidates = configs.filter(type => type.code !== config.code && type.enabled !== false && type.balanceMode !== 'linked');
  return (
    <fieldset className="border rounded-3 p-3">
      <legend className="float-none w-auto px-2 mb-2" style={{ fontSize: 13, fontWeight: 700 }}><i className="bi bi-link-45deg me-1" aria-hidden="true" />Link leave types</legend>
      <div className="form-check form-switch">
        <input id={`${id}-mode`} className="form-check-input" type="checkbox" role="switch" checked={config.balanceMode === 'linked'} onChange={event => onChange({ balanceMode: event.target.checked ? 'linked' : 'own' })} />
        <label htmlFor={`${id}-mode`} className="form-check-label fw-semibold">Link this leave type to other leave types</label>
      </div>
      {config.balanceMode === 'linked' && (
        <>
          <div className="form-check mt-3">
            <input id={`${id}-all`} className="form-check-input" type="checkbox" checked={!!config.linkAllLeaveTypes} onChange={event => onChange({ linkAllLeaveTypes: event.target.checked })} />
            <label htmlFor={`${id}-all`} className="form-check-label">Link all standard leave types</label>
          </div>
          <fieldset className="mt-3" disabled={!!config.linkAllLeaveTypes}>
            <legend style={{ fontSize: 12, fontWeight: 600 }}>Allowed underlying leave types</legend>
            {candidates.map(type => (
              <div className="form-check" key={type.code}>
                <input id={`${id}-${type.code}`} className="form-check-input" type="checkbox" checked={config.linkAllLeaveTypes || (config.linkedLeaveTypes || []).includes(type.code)} onChange={event => onChange({ linkedLeaveTypes: event.target.checked ? [...(config.linkedLeaveTypes || []), type.code] : (config.linkedLeaveTypes || []).filter(code => code !== type.code) })} />
                <label htmlFor={`${id}-${type.code}`} className="form-check-label">{type.name} ({type.code})</label>
              </div>
            ))}
            {!candidates.length && <p className="text-secondary mb-0">Add a standard leave type first.</p>}
          </fieldset>
          <label htmlFor={`${id}-approver`} className="form-label mt-3">Classification & approval by</label>
          <input id={`${id}-approver`} className="form-control" value="Super Admin" readOnly />
          <label htmlFor={`${id}-deduct`} className="form-label mt-3">Deduct balance from</label>
          <input id={`${id}-deduct`} className="form-control" value="Underlying leave type selected at approval" readOnly />
        </>
      )}
    </fieldset>
  );
}
