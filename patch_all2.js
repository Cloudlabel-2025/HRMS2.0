const fs = require('fs');

function read(p) { return fs.readFileSync(p, 'utf8'); }
function write(p, c) { fs.writeFileSync(p, c, 'utf8'); }

// Shared field error state block to inject
function errState(ns) {
  return `\n  const [fieldErrs_${ns}, setFieldErrs_${ns}] = typeof useState !== 'undefined' ? useState({}) : [{}];\n  const _fet_${ns} = typeof window !== 'undefined' ? (window.__fet_${ns} = window.__fet_${ns} || {}) : {};\n  const setFErrs_${ns} = (obj) => { setFieldErrs_${ns}(obj); Object.keys(obj).forEach(k => { if(_fet_${ns}[k]) clearTimeout(_fet_${ns}[k]); _fet_${ns}[k] = setTimeout(() => setFieldErrs_${ns}(p => { const n={...p}; delete n[k]; return n; }), 10000); }); };\n  const clearFErr_${ns} = (k) => { if(_fet_${ns}[k]) { clearTimeout(_fet_${ns}[k]); delete _fet_${ns}[k]; } setFieldErrs_${ns}(p => { const n={...p}; delete n[k]; return n; }); };`;
}

// Inline error display JSX for a field key and state namespace
function inlineErr(key, ns) {
  return `{fieldErrs_${ns}?.${key} && <div style={{ color:'#ef4444', fontSize:11, marginTop:3, display:'flex', alignItems:'center', gap:4 }}><i className="bi bi-exclamation-circle-fill" style={{ fontSize:10 }} />{fieldErrs_${ns}.${key}}</div>}`;
}

// ─── UNIVERSAL APPROACH: each file gets a single useState({}) for field errors
// and we use position-based injection near the first useState call

function patchPage(filePath, patches) {
  let c = read(filePath);
  let changed = 0;
  for (const [find, replace] of patches) {
    if (c.includes(find)) {
      c = c.replace(find, replace);
      changed++;
    }
  }
  write(filePath, c);
  return changed;
}

// ─── LEAVE PAGE ──────────────────────────────────────────────────────────────
{
  let c = read('src/app/leave/page.js');
  c = c.replace(/\r\n/g, '\n');

  // Inject state after toast state
  c = c.replace(
    `  const [toast, setToast]           = useState(null);`,
    `  const [toast, setToast]           = useState(null);
  const [fe, setFe] = useState({});
  const _ft = typeof window !== 'undefined' ? (window.__leaveFt = window.__leaveFt || {}) : {};
  const setFErrs = (o) => { setFe(o); Object.keys(o).forEach(k => { clearTimeout(_ft[k]); _ft[k] = setTimeout(() => setFe(p => { const n={...p}; delete n[k]; return n; }), 10000); }); };
  const clrF = (k) => { clearTimeout(_ft[k]); delete _ft[k]; setFe(p => { const n={...p}; delete n[k]; return n; }); };`
  );

  // Replace validation
  c = c.replace(
    `    if (!form.from || !form.to || !form.reason) { showToast('Please fill all fields', 'error'); return; }`,
    `    const errs = {};
    if (!form.from) errs.from = 'From date is required';
    if (!form.to) errs.to = 'To date is required';
    else if (form.from && new Date(form.to) < new Date(form.from)) errs.to = 'To date must be on or after from date';
    if (!form.reason.trim()) errs.reason = 'Reason is required';
    if (Object.keys(errs).length) { setFErrs(errs); return; }`
  );

  // Clear on close
  c = c.replace(
    `onClick={() => setShowModal(false)} />\n              </div>`,
    `onClick={() => { setShowModal(false); setFe({}); }} />\n              </div>`
  );
  c = c.replace(
    `onClick={() => setShowModal(false)}>Cancel</button>\n                <button className="btn btn-primary" onClick={handleApply}`,
    `onClick={() => { setShowModal(false); setFe({}); }}>Cancel</button>\n                <button className="btn btn-primary" onClick={handleApply}`
  );

  // From date
  c = c.replace(
    `<input type="date" className="form-control" value={form.from} onChange={e => setForm(p => ({ ...p, from: e.target.value }))} />`,
    `<input type="date" className={\`form-control \${fe.from?'is-invalid':''}\`} value={form.from} onChange={e => { setForm(p => ({ ...p, from: e.target.value })); clrF('from'); }} />
                    {fe.from && <div style={{ color:'#ef4444', fontSize:11, marginTop:3, display:'flex', alignItems:'center', gap:4 }}><i className="bi bi-exclamation-circle-fill" style={{ fontSize:10 }} />{fe.from}</div>}`
  );

  // To date
  c = c.replace(
    `<input type="date" className="form-control" value={form.to} onChange={e => setForm(p => ({ ...p, to: e.target.value }))} />`,
    `<input type="date" className={\`form-control \${fe.to?'is-invalid':''}\`} value={form.to} onChange={e => { setForm(p => ({ ...p, to: e.target.value })); clrF('to'); }} />
                    {fe.to && <div style={{ color:'#ef4444', fontSize:11, marginTop:3, display:'flex', alignItems:'center', gap:4 }}><i className="bi bi-exclamation-circle-fill" style={{ fontSize:10 }} />{fe.to}</div>}`
  );

  // Reason
  c = c.replace(
    `<textarea className="form-control" rows={3} value={form.reason} onChange={e => setForm(p => ({ ...p, reason: e.target.value }))} />`,
    `<textarea className={\`form-control \${fe.reason?'is-invalid':''}\`} rows={3} value={form.reason} onChange={e => { setForm(p => ({ ...p, reason: e.target.value })); clrF('reason'); }} />
                  {fe.reason && <div style={{ color:'#ef4444', fontSize:11, marginTop:3, display:'flex', alignItems:'center', gap:4 }}><i className="bi bi-exclamation-circle-fill" style={{ fontSize:10 }} />{fe.reason}</div>}`
  );

  write('src/app/leave/page.js', c);
  console.log('leave:', c.includes('setFErrs(errs)') ? 'OK' : 'MISS');
}

// ─── LOGIN PAGE ──────────────────────────────────────────────────────────────
{
  let c = read('src/app/login/page.js');
  c = c.replace(/\r\n/g, '\n');

  c = c.replace(
    `  const [showPassword, setShowPassword] = useState(false);`,
    `  const [showPassword, setShowPassword] = useState(false);
  const [fe, setFe] = useState({});
  const _ft = typeof window !== 'undefined' ? (window.__loginFt = window.__loginFt || {}) : {};
  const setFErrs = (o) => { setFe(o); Object.keys(o).forEach(k => { clearTimeout(_ft[k]); _ft[k] = setTimeout(() => setFe(p => { const n={...p}; delete n[k]; return n; }), 10000); }); };
  const clrF = (k) => { clearTimeout(_ft[k]); delete _ft[k]; setFe(p => { const n={...p}; delete n[k]; return n; }); };`
  );

  c = c.replace(
    `    setError('');\n    setLoading(true);`,
    `    setError('');
    const errs = {};
    if (!form.email.trim()) errs.email = 'Email is required';
    else if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(form.email)) errs.email = 'Enter a valid email address';
    if (!form.password) errs.password = 'Password is required';
    if (Object.keys(errs).length) { setFErrs(errs); return; }
    setLoading(true);`
  );

  // Email input — replace className and onChange
  c = c.replace(
    `                  type="email"\n                  className="form-control"\n                  placeholder="you@company.com"\n                  style={{ paddingLeft: 36 }}\n                  value={form.email}\n                  onChange={e => setForm(p => ({ ...p, email: e.target.value }))}`,
    `                  type="email"\n                  className={\`form-control \${fe.email?'is-invalid':''}\`}\n                  placeholder="you@company.com"\n                  style={{ paddingLeft: 36 }}\n                  value={form.email}\n                  onChange={e => { setForm(p => ({ ...p, email: e.target.value })); clrF('email'); }}`
  );
  // Add error div after email wrapper div closes
  c = c.replace(
    `              </div>\n            </div>\n\n            <div className="mb-4">\n              <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Password</label>`,
    `              </div>\n              {fe.email && <div style={{ color:'#ef4444', fontSize:11, marginTop:3, display:'flex', alignItems:'center', gap:4 }}><i className="bi bi-exclamation-circle-fill" style={{ fontSize:10 }} />{fe.email}</div>}\n            </div>\n\n            <div className="mb-4">\n              <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Password</label>`
  );

  // Password input
  c = c.replace(
    `                  type={showPassword ? 'text' : 'password'}\n                  className="form-control"\n                  placeholder="••••••••"\n                  style={{ paddingLeft: 36, paddingRight: 36 }}\n                  value={form.password}\n                  onChange={e => setForm(p => ({ ...p, password: e.target.value }))}`,
    `                  type={showPassword ? 'text' : 'password'}\n                  className={\`form-control \${fe.password?'is-invalid':''}\`}\n                  placeholder="••••••••"\n                  style={{ paddingLeft: 36, paddingRight: 36 }}\n                  value={form.password}\n                  onChange={e => { setForm(p => ({ ...p, password: e.target.value })); clrF('password'); }}`
  );
  // Add error after eye icon closes
  c = c.replace(
    `              </div>\n              <div style={{ textAlign: 'right' }}>`,
    `              </div>\n              {fe.password && <div style={{ color:'#ef4444', fontSize:11, marginTop:3, display:'flex', alignItems:'center', gap:4 }}><i className="bi bi-exclamation-circle-fill" style={{ fontSize:10 }} />{fe.password}</div>}\n              <div style={{ textAlign: 'right' }}>`
  );

  write('src/app/login/page.js', c);
  console.log('login:', c.includes('setFErrs(errs)') ? 'OK' : 'MISS');
}

// ─── RESET PASSWORD ──────────────────────────────────────────────────────────
{
  let c = read('src/app/login/reset-password/page.js');
  c = c.replace(/\r\n/g, '\n');

  c = c.replace(
    `  const [success, setSuccess] = useState(false);`,
    `  const [success, setSuccess] = useState(false);
  const [fe, setFe] = useState({});
  const _ft = typeof window !== 'undefined' ? (window.__resetFt = window.__resetFt || {}) : {};
  const setFErrs = (o) => { setFe(o); Object.keys(o).forEach(k => { clearTimeout(_ft[k]); _ft[k] = setTimeout(() => setFe(p => { const n={...p}; delete n[k]; return n; }), 10000); }); };
  const clrF = (k) => { clearTimeout(_ft[k]); delete _ft[k]; setFe(p => { const n={...p}; delete n[k]; return n; }); };`
  );

  c = c.replace(
    `    if (password !== confirmPassword) {\n      return setError('Passwords do not match');\n    }\n    if (password.length < 6) {\n      return setError('Password must be at least 6 characters');\n    }`,
    `    const errs = {};
    if (!password) errs.password = 'New password is required';
    else if (password.length < 6) errs.password = 'Password must be at least 6 characters';
    if (!confirmPassword) errs.confirmPassword = 'Please confirm your password';
    else if (password !== confirmPassword) errs.confirmPassword = 'Passwords do not match';
    if (Object.keys(errs).length) { setFErrs(errs); return; }`
  );

  c = c.replace(
    `            value={password}\n            onChange={e => setPassword(e.target.value)}\n            required`,
    `            value={password}\n            onChange={e => { setPassword(e.target.value); clrF('password'); }}\n            className={\`form-control \${fe.password?'is-invalid':''}\`}`
  );
  c = c.replace(
    `        </div>\n      </div>\n\n      <div className="mb-4">\n        <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Confirm New Password</label>`,
    `        </div>\n        {fe.password && <div style={{ color:'#ef4444', fontSize:11, marginTop:3, display:'flex', alignItems:'center', gap:4 }}><i className="bi bi-exclamation-circle-fill" style={{ fontSize:10 }} />{fe.password}</div>}\n      </div>\n\n      <div className="mb-4">\n        <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Confirm New Password</label>`
  );
  c = c.replace(
    `            value={confirmPassword}\n            onChange={e => setConfirmPassword(e.target.value)}\n            required`,
    `            value={confirmPassword}\n            onChange={e => { setConfirmPassword(e.target.value); clrF('confirmPassword'); }}\n            className={\`form-control \${fe.confirmPassword?'is-invalid':''}\`}`
  );
  c = c.replace(
    `        </div>\n      </div>\n\n      <button type="submit" className="btn btn-primary w-100" disabled={loading} style={{ padding: '10px', fontWeight: 600 }}>\n        {loading ? <><span className="spinner-border spinner-border-sm me-2" />Resetting</>`,
    `        </div>\n        {fe.confirmPassword && <div style={{ color:'#ef4444', fontSize:11, marginTop:3, display:'flex', alignItems:'center', gap:4 }}><i className="bi bi-exclamation-circle-fill" style={{ fontSize:10 }} />{fe.confirmPassword}</div>}\n      </div>\n\n      <button type="submit" className="btn btn-primary w-100" disabled={loading} style={{ padding: '10px', fontWeight: 600 }}>\n        {loading ? <><span className="spinner-border spinner-border-sm me-2" />Resetting</>`
  );

  write('src/app/login/reset-password/page.js', c);
  console.log('reset-password:', c.includes('setFErrs(errs)') ? 'OK' : 'MISS');
}

// ─── SETUP PASSWORD ──────────────────────────────────────────────────────────
{
  let c = read('src/app/login/setup-password/page.js');
  c = c.replace(/\r\n/g, '\n');

  c = c.replace(
    `  const [success, setSuccess] = useState(false);`,
    `  const [success, setSuccess] = useState(false);
  const [fe, setFe] = useState({});
  const _ft = typeof window !== 'undefined' ? (window.__setupFt = window.__setupFt || {}) : {};
  const setFErrs = (o) => { setFe(o); Object.keys(o).forEach(k => { clearTimeout(_ft[k]); _ft[k] = setTimeout(() => setFe(p => { const n={...p}; delete n[k]; return n; }), 10000); }); };
  const clrF = (k) => { clearTimeout(_ft[k]); delete _ft[k]; setFe(p => { const n={...p}; delete n[k]; return n; }); };`
  );

  c = c.replace(
    `    if (newPassword !== confirmPassword) {\n      return setError('New passwords do not match');\n    }\n    if (newPassword.length < 6) {\n      return setError('Password must be at least 6 characters');\n    }`,
    `    const errs = {};
    if (!currentPassword) errs.currentPassword = 'Temporary password is required';
    if (!newPassword) errs.newPassword = 'New password is required';
    else if (newPassword.length < 6) errs.newPassword = 'Password must be at least 6 characters';
    if (!confirmPassword) errs.confirmPassword = 'Please confirm your new password';
    else if (newPassword !== confirmPassword) errs.confirmPassword = 'Passwords do not match';
    if (Object.keys(errs).length) { setFErrs(errs); return; }`
  );

  // current password
  c = c.replace(
    `                  value={currentPassword}\n                  onChange={e => setCurrentPassword(e.target.value)}\n                  required`,
    `                  value={currentPassword}\n                  onChange={e => { setCurrentPassword(e.target.value); clrF('currentPassword'); }}\n                  className={\`form-control \${fe.currentPassword?'is-invalid':''}\`}`
  );
  const firstMb3Close = c.indexOf(`              </div>\n            </div>\n\n            <div className="mb-3">\n              <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>New Password</label>`);
  if (firstMb3Close > -1) {
    const before = c.slice(0, firstMb3Close);
    const after = c.slice(firstMb3Close);
    c = before + `              </div>\n              {fe.currentPassword && <div style={{ color:'#ef4444', fontSize:11, marginTop:3, display:'flex', alignItems:'center', gap:4 }}><i className="bi bi-exclamation-circle-fill" style={{ fontSize:10 }} />{fe.currentPassword}</div>}\n            </div>\n\n            <div className="mb-3">\n              <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>New Password</label>` + after.slice(after.indexOf(`              <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>New Password</label>`) + `              <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>New Password</label>`.length);
  }

  // new password
  c = c.replace(
    `                  value={newPassword}\n                  onChange={e => setNewPassword(e.target.value)}\n                  required`,
    `                  value={newPassword}\n                  onChange={e => { setNewPassword(e.target.value); clrF('newPassword'); }}\n                  className={\`form-control \${fe.newPassword?'is-invalid':''}\`}`
  );
  c = c.replace(
    `              </div>\n            </div>\n\n            <div className="mb-4">\n              <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Confirm New Password</label>`,
    `              </div>\n              {fe.newPassword && <div style={{ color:'#ef4444', fontSize:11, marginTop:3, display:'flex', alignItems:'center', gap:4 }}><i className="bi bi-exclamation-circle-fill" style={{ fontSize:10 }} />{fe.newPassword}</div>}\n            </div>\n\n            <div className="mb-4">\n              <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Confirm New Password</label>`
  );
  // confirm password
  c = c.replace(
    `                  value={confirmPassword}\n                  onChange={e => setConfirmPassword(e.target.value)}\n                  required`,
    `                  value={confirmPassword}\n                  onChange={e => { setConfirmPassword(e.target.value); clrF('confirmPassword'); }}\n                  className={\`form-control \${fe.confirmPassword?'is-invalid':''}\`}`
  );
  c = c.replace(
    `              </div>\n            </div>\n\n            <button type="submit" className="btn btn-primary w-100" disabled={loading} style={{ padding: '10px', fontWeight: 600 }}>`,
    `              </div>\n              {fe.confirmPassword && <div style={{ color:'#ef4444', fontSize:11, marginTop:3, display:'flex', alignItems:'center', gap:4 }}><i className="bi bi-exclamation-circle-fill" style={{ fontSize:10 }} />{fe.confirmPassword}</div>}\n            </div>\n\n            <button type="submit" className="btn btn-primary w-100" disabled={loading} style={{ padding: '10px', fontWeight: 600 }}>`
  );

  write('src/app/login/setup-password/page.js', c);
  console.log('setup-password:', c.includes('setFErrs(errs)') ? 'OK' : 'MISS');
}

// ─── FORGOT PASSWORD ─────────────────────────────────────────────────────────
{
  let c = read('src/app/login/forgot-password/page.js');
  c = c.replace(/\r\n/g, '\n');

  c = c.replace(
    `  const [error, setError] = useState('');`,
    `  const [error, setError] = useState('');
  const [fe, setFe] = useState({});
  const _ft = typeof window !== 'undefined' ? (window.__forgotFt = window.__forgotFt || {}) : {};
  const setFErrs = (o) => { setFe(o); Object.keys(o).forEach(k => { clearTimeout(_ft[k]); _ft[k] = setTimeout(() => setFe(p => { const n={...p}; delete n[k]; return n; }), 10000); }); };
  const clrF = (k) => { clearTimeout(_ft[k]); delete _ft[k]; setFe(p => { const n={...p}; delete n[k]; return n; }); };`
  );

  c = c.replace(
    `    setError('');\n    setMessage('');\n    setLoading(true);`,
    `    setError('');
    setMessage('');
    const errs = {};
    if (!email.trim()) errs.email = 'Email is required';
    else if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) errs.email = 'Enter a valid email address';
    if (Object.keys(errs).length) { setFErrs(errs); return; }
    setLoading(true);`
  );

  c = c.replace(
    `                    value={email}\n                    onChange={e => setEmail(e.target.value)}\n                    required`,
    `                    value={email}\n                    onChange={e => { setEmail(e.target.value); clrF('email'); }}\n                    className={\`form-control \${fe.email?'is-invalid':''}\`}`
  );
  c = c.replace(
    `                </div>\n              </div>\n\n              <button type="submit" className="btn btn-primary w-100 mb-3"`,
    `                </div>\n                {fe.email && <div style={{ color:'#ef4444', fontSize:11, marginTop:3, display:'flex', alignItems:'center', gap:4 }}><i className="bi bi-exclamation-circle-fill" style={{ fontSize:10 }} />{fe.email}</div>}\n              </div>\n\n              <button type="submit" className="btn btn-primary w-100 mb-3"`
  );

  write('src/app/login/forgot-password/page.js', c);
  console.log('forgot-password:', c.includes('setFErrs(errs)') ? 'OK' : 'MISS');
}

console.log('\nDone.');
