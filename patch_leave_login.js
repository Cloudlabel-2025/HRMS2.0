const fs = require('fs');

// ─── LEAVE PAGE ───────────────────────────────────────────────────────────────
let leave = fs.readFileSync('src/app/leave/page.js', 'utf8');

// Add import
leave = leave.replace(
  `'use client';\r\nimport { useState, useEffect } from 'react';`,
  `'use client';\nimport { useState, useEffect } from 'react';\nimport { useFormErrors } from '@/lib/useFormErrors';`
);

// Add hook
leave = leave.replace(
  `  const { user } = useAuth();`,
  `  const { user } = useAuth();
  const { errors: leaveErrs, setErrors: setLeaveErrs, clearError: clearLeaveErr, clearAll: clearLeaveErrs, Err: LErr } = useFormErrors();`
);

// Replace handleApply validation
leave = leave.replace(
  `  const handleApply = async () => {\n    if (!form.from || !form.to || !form.reason) { showToast('Please fill all fields', 'error'); return; }`,
  `  const handleApply = async () => {
    const errs = {};
    if (!form.from) errs.from = 'From date is required';
    if (!form.to) errs.to = 'To date is required';
    else if (form.from && form.to && new Date(form.to) < new Date(form.from)) errs.to = 'To date must be after from date';
    if (!form.reason.trim()) errs.reason = 'Reason is required';
    if (Object.keys(errs).length) { setLeaveErrs(errs); return; }`
);

// Clear on modal close
leave = leave.replace(
  `<button className="btn btn-close" onClick={() => setShowModal(false)} />`,
  `<button className="btn btn-close" onClick={() => { setShowModal(false); clearLeaveErrs(); }} />`
);
leave = leave.replace(
  `<button className="btn btn-outline-secondary" onClick={() => setShowModal(false)}>Cancel</button>`,
  `<button className="btn btn-outline-secondary" onClick={() => { setShowModal(false); clearLeaveErrs(); }}>Cancel</button>`
);

// From Date field
leave = leave.replace(
  `                    <input type="date" className="form-control" value={form.from} onChange={e => setForm(p => ({ ...p, from: e.target.value }))} />`,
  `                    <input type="date" className={\`form-control \${leaveErrs.from ? 'is-invalid' : ''}\`} value={form.from} onChange={e => { setForm(p => ({ ...p, from: e.target.value })); clearLeaveErr('from'); }} />
                    <LErr f="from" />`
);

// To Date field
leave = leave.replace(
  `                    <input type="date" className="form-control" value={form.to} onChange={e => setForm(p => ({ ...p, to: e.target.value }))} />`,
  `                    <input type="date" className={\`form-control \${leaveErrs.to ? 'is-invalid' : ''}\`} value={form.to} onChange={e => { setForm(p => ({ ...p, to: e.target.value })); clearLeaveErr('to'); }} />
                    <LErr f="to" />`
);

// Reason textarea
leave = leave.replace(
  `                  <textarea className="form-control" rows={3} value={form.reason} onChange={e => setForm(p => ({ ...p, reason: e.target.value }))} />`,
  `                  <textarea className={\`form-control \${leaveErrs.reason ? 'is-invalid' : ''}\`} rows={3} value={form.reason} onChange={e => { setForm(p => ({ ...p, reason: e.target.value })); clearLeaveErr('reason'); }} />
                  <LErr f="reason" />`
);

fs.writeFileSync('src/app/leave/page.js', leave, 'utf8');
console.log('leave - setLeaveErrs:', leave.includes('setLeaveErrs(errs)') ? 'OK' : 'MISS');
console.log('leave - LErr from:', leave.includes('<LErr f="from"') ? 'OK' : 'MISS');
console.log('leave - LErr to:', leave.includes('<LErr f="to"') ? 'OK' : 'MISS');
console.log('leave - LErr reason:', leave.includes('<LErr f="reason"') ? 'OK' : 'MISS');

// ─── LOGIN PAGE ───────────────────────────────────────────────────────────────
let login = fs.readFileSync('src/app/login/page.js', 'utf8');

login = login.replace(
  `'use client';\r\nimport { useState } from 'react';`,
  `'use client';\nimport { useState } from 'react';\nimport { useFormErrors } from '@/lib/useFormErrors';`
);

login = login.replace(
  `  const [error, setError] = useState('');`,
  `  const [error, setError] = useState('');
  const { errors: loginErrs, setErrors: setLoginErrs, clearError: clearLoginErr, Err: LoginErr } = useFormErrors();`
);

// Add client-side field validation before submit
login = login.replace(
  `  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);`,
  `  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const errs = {};
    if (!form.email.trim()) errs.email = 'Email is required';
    else if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(form.email)) errs.email = 'Enter a valid email address';
    if (!form.password) errs.password = 'Password is required';
    if (Object.keys(errs).length) { setLoginErrs(errs); return; }
    setLoading(true);`
);

// Email field
login = login.replace(
  `                  value={form.email}
                  onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                  required`,
  `                  value={form.email}
                  onChange={e => { setForm(p => ({ ...p, email: e.target.value })); clearLoginErr('email'); }}
                  className={\`form-control \${loginErrs.email ? 'is-invalid' : ''}\`}`
);

// Add LoginErr after email input closing tag
login = login.replace(
  `                  suppressHydrationWarning
                />
              </div>
            </div>

            <div className="mb-4">`,
  `                  suppressHydrationWarning
                />
                <LoginErr f="email" />
              </div>
            </div>

            <div className="mb-4">`
);

// Password field onChange
login = login.replace(
  `                  value={form.password}
                  onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                  required`,
  `                  value={form.password}
                  onChange={e => { setForm(p => ({ ...p, password: e.target.value })); clearLoginErr('password'); }}
                  className={\`form-control \${loginErrs.password ? 'is-invalid' : ''}\`}`
);

// Add LoginErr after password input
login = login.replace(
  `                  suppressHydrationWarning
                />
                <i
                  className={\`bi bi-eye\${showPassword ? '-slash' : ''}\`}`,
  `                  suppressHydrationWarning
                />
                <LoginErr f="password" />
                <i
                  className={\`bi bi-eye\${showPassword ? '-slash' : ''}\`}`
);

fs.writeFileSync('src/app/login/page.js', login, 'utf8');
console.log('login - setLoginErrs:', login.includes('setLoginErrs(errs)') ? 'OK' : 'MISS');
console.log('login - LoginErr email:', login.includes('<LoginErr f="email"') ? 'OK' : 'MISS');
console.log('login - LoginErr password:', login.includes('<LoginErr f="password"') ? 'OK' : 'MISS');
