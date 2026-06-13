const fs = require('fs');
let c = fs.readFileSync('src/app/recruitment/page.js', 'utf8');

// ─── 1. Expand EMPTY_APP with new fields ──────────────────────────────────────
c = c.replace(
  `const EMPTY_APP = { name: '', email: '', phone: '', jobId: '', qualification: '', skills: '', isFresher: 'yes', experienceYears: '', referralName: '', referralFromOffice: false, referralEmployeeId: '', resumeFileName: '' };`,
  `const EMPTY_APP = {
  name: '', email: '', phone: '', jobId: '',
  qualification: '', skills: [], isFresher: 'fresher',
  minExperience: '', maxExperience: '',
  referralName: '', referralFromOffice: false, referralEmployeeId: '',
  resumeFileName: '', linkedIn: '', expectedSalary: '', noticePeriod: '',
  currentCompany: '', currentRole: '',
};`
);

// ─── 2. Add appErrors + skillInput states ──────────────────────────────────
c = c.replace(
  `  const [confirmMoveModal, setConfirmMoveModal] = useState(null);`,
  `  const [confirmMoveModal, setConfirmMoveModal] = useState(null);
  const [appErrors, setAppErrors] = useState({});
  const [appSkillInput, setAppSkillInput] = useState('');
  const _appErrTimers = typeof window !== 'undefined' ? (window.__appErrTimers = window.__appErrTimers || {}) : {};
  const setAppErrs = (obj) => { setAppErrors(obj); Object.keys(obj).forEach(k => { clearTimeout(_appErrTimers[k]); _appErrTimers[k] = setTimeout(() => setAppErrors(p => { const n={...p}; delete n[k]; return n; }), 10000); }); };
  const clearAppErr = (k) => { clearTimeout(_appErrTimers[k]); delete _appErrTimers[k]; setAppErrors(p => { const n={...p}; delete n[k]; return n; }); };`
);

// ─── 3. Replace saveApplicant validation to use field-level errors ─────────
c = c.replace(
  `  const saveApplicant = async () => {
    const name = appForm.name.trim();
    const email = appForm.email.trim();
    const qualification = appForm.qualification.trim();
    if (!name || !email || !appForm.phone || !appForm.jobId) return rejectRecruitmentAction('Applicant Create Validation Failed', 'Name, email, phone and job are required');
    if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) return rejectRecruitmentAction('Applicant Create Validation Failed', 'Please enter a valid email address');
    if (!/^[0-9]{10}$/.test(appForm.phone)) return rejectRecruitmentAction('Applicant Create Validation Failed', 'Phone must be exactly 10 digits');
    if (!qualification) return rejectRecruitmentAction('Applicant Create Validation Failed', 'Qualification is required');
    if (appForm.isFresher === 'no' && !Number(appForm.experienceYears)) return rejectRecruitmentAction('Applicant Create Validation Failed', 'Years of experience is required for non-freshers');
    const job = jobs.find(j => j._id === appForm.jobId);
    setPendingApplicant({ name, email, phone: appForm.phone, jobTitle: job?.title || '', qualification });
  };`,
  `  const saveApplicant = async () => {
    const name = appForm.name.trim();
    const email = appForm.email.trim();
    const qualification = appForm.qualification.trim();
    const errs = {};
    if (!name) errs.name = 'Full name is required';
    if (!email) errs.email = 'Email is required';
    else if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) errs.email = 'Enter a valid email address';
    if (!appForm.phone) errs.phone = 'Phone number is required';
    else if (!/^[0-9]{10}$/.test(appForm.phone)) errs.phone = 'Phone must be exactly 10 digits';
    if (!appForm.jobId) errs.jobId = 'Please select a job';
    if (!qualification) errs.qualification = 'Qualification is required';
    if (appForm.isFresher === 'experienced') {
      if (appForm.minExperience === '') errs.minExperience = 'Min experience is required';
      if (appForm.maxExperience === '') errs.maxExperience = 'Max experience is required';
      if (appForm.minExperience !== '' && appForm.maxExperience !== '' && Number(appForm.maxExperience) < Number(appForm.minExperience))
        errs.maxExperience = 'Max must be greater than min';
    }
    if (Object.keys(errs).length) { setAppErrs(errs); return; }
    const job = jobs.find(j => j._id === appForm.jobId);
    setPendingApplicant({ name, email, phone: appForm.phone, jobTitle: job?.title || '', qualification });
  };`
);

// ─── 4. Update doSaveApplicant to use new fields ───────────────────────────
c = c.replace(
  `  const doSaveApplicant = async () => {
    setPendingApplicant(null);
    setSaving(true);
    try {
      const created = await api.post('/api/recruitment/applicants', {
        name,
        email,
        phone: appForm.phone,
        jobId: appForm.jobId,
        qualification,
        skills: appForm.skills ? appForm.skills.split(',').map(s => s.trim()).filter(Boolean) : [],
        isFresher: appForm.isFresher === 'yes',
        experienceYears: appForm.isFresher === 'no' ? Number(appForm.experienceYears) : 0,
        referralName: appForm.referralFromOffice
          ? employees.find(e => e._id === appForm.referralEmployeeId)?.name || ''
          : appForm.referralName,
        referralFromOffice: appForm.referralFromOffice,
        referralEmployeeId: appForm.referralFromOffice ? appForm.referralEmployeeId || null : null,
      });`,
  `  const doSaveApplicant = async () => {
    setPendingApplicant(null);
    setSaving(true);
    try {
      const created = await api.post('/api/recruitment/applicants', {
        name: appForm.name.trim(),
        email: appForm.email.trim(),
        phone: appForm.phone,
        jobId: appForm.jobId,
        qualification: appForm.qualification.trim(),
        skills: Array.isArray(appForm.skills) ? appForm.skills : [],
        isFresher: appForm.isFresher === 'fresher',
        experienceYears: appForm.isFresher === 'experienced' ? Number(appForm.minExperience) : 0,
        referralName: appForm.referralFromOffice
          ? employees.find(e => e._id === appForm.referralEmployeeId)?.name || ''
          : appForm.referralName,
        referralFromOffice: appForm.referralFromOffice,
        referralEmployeeId: appForm.referralFromOffice ? appForm.referralEmployeeId || null : null,
      });`
);

// Also reset appSkillInput on save
c = c.replace(
  `      setShowAppModal(false);
      setAppForm(EMPTY_APP);
      if (created.previousRejection?.matchedBy) setPriorRejectModal(created);`,
  `      setShowAppModal(false);
      setAppForm(EMPTY_APP);
      setAppErrors({});
      setAppSkillInput('');
      if (created.previousRejection?.matchedBy) setPriorRejectModal(created);`
);

// ─── 5. Replace Add Applicant Modal with new sectioned UI ─────────────────
const start = c.indexOf('{/* Add Applicant Modal */}');
const end = c.indexOf('{/* Hired Modal */}');

const newModal = `{/* Add Applicant Modal */}
      {showAppModal && (() => {
        const af = appForm;
        const ae = appErrors;
        const setAf = (k, v) => { setAppForm(p => ({ ...p, [k]: v })); clearAppErr(k); };
        const AErr = ({ f }) => ae[f] ? <div style={{ color:'#ef4444', fontSize:11, marginTop:3, display:'flex', alignItems:'center', gap:4 }}><i className="bi bi-exclamation-circle-fill" style={{ fontSize:10 }} />{ae[f]}</div> : null;
        const secStyle = { background: '#f8fafc', borderRadius: 10, padding: '14px 16px', marginBottom: 16 };
        const secTitle = { fontSize: 12, fontWeight: 700, color: '#3b82f6', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 };
        const addSkill = (val) => { const t=val.trim(); if(t && !af.skills.includes(t)) setAf('skills',[...af.skills,t]); };
        const removeSkill = (i) => setAf('skills', af.skills.filter((_,idx)=>idx!==i));
        const tagStyle = { display:'inline-flex', alignItems:'center', gap:4, background:'#eff6ff', color:'#2563eb', fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:20, margin:'2px' };
        const selectedJob = jobs.find(j => j._id === af.jobId);
        return (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)', zIndex: 1050 }}>
          <div className="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header" style={{ borderBottom: '1px solid #e2e8f0' }}>
                <div>
                  <h5 className="modal-title mb-0">Add Applicant</h5>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>Fill in the applicant details below</div>
                </div>
                <button className="btn-close" onClick={() => { setShowAppModal(false); setAppErrors({}); setAppSkillInput(''); }} />
              </div>
              <div className="modal-body" style={{ padding: '20px 24px' }}>

                {/* ① Personal Information */}
                <div style={secStyle}>
                  <div style={secTitle}>① Personal Information</div>
                  <div className="row g-3">
                    <div className="col-md-6">
                      <label className="form-label" style={{ fontSize:13, fontWeight:600 }}>Full Name *</label>
                      <input className={\`form-control \${ae.name?'is-invalid':''}\`} placeholder="e.g. John Smith" value={af.name} onChange={e => setAf('name', e.target.value.replace(/[^A-Za-z\\s]/g,''))} />
                      <AErr f="name" />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label" style={{ fontSize:13, fontWeight:600 }}>Email *</label>
                      <input type="email" className={\`form-control \${ae.email?'is-invalid':''}\`} placeholder="email@example.com" value={af.email} onChange={e => setAf('email', e.target.value)} />
                      <AErr f="email" />
                    </div>
                    <div className="col-md-4">
                      <label className="form-label" style={{ fontSize:13, fontWeight:600 }}>Phone *</label>
                      <input type="tel" maxLength={10} className={\`form-control \${ae.phone?'is-invalid':''}\`} placeholder="10-digit number" value={af.phone} onChange={e => setAf('phone', e.target.value.replace(/\\D/g,'').slice(0,10))} />
                      <AErr f="phone" />
                    </div>
                    <div className="col-md-4">
                      <label className="form-label" style={{ fontSize:13, fontWeight:600 }}>LinkedIn <span style={{ color:'#94a3b8', fontWeight:400 }}>(optional)</span></label>
                      <input className="form-control" placeholder="linkedin.com/in/username" value={af.linkedIn} onChange={e => setAf('linkedIn', e.target.value)} />
                    </div>
                    <div className="col-md-4">
                      <label className="form-label" style={{ fontSize:13, fontWeight:600 }}>Resume <span style={{ color:'#94a3b8', fontWeight:400 }}>(optional)</span></label>
                      <input type="file" className="form-control" accept=".pdf,.doc,.docx" onChange={e => setAf('resumeFileName', e.target.files?.[0]?.name || '')} />
                      {af.resumeFileName && <div style={{ fontSize:11, color:'#64748b', marginTop:4 }}><i className="bi bi-paperclip me-1" />{af.resumeFileName}</div>}
                    </div>
                  </div>
                </div>

                {/* ② Job & Qualification */}
                <div style={secStyle}>
                  <div style={secTitle}>② Job & Qualification</div>
                  <div className="row g-3">
                    <div className="col-md-6">
                      <label className="form-label" style={{ fontSize:13, fontWeight:600 }}>Applying For *</label>
                      <select className={\`form-select \${ae.jobId?'is-invalid':''}\`} value={af.jobId} onChange={e => setAf('jobId', e.target.value)}>
                        <option value="">Select job posting</option>
                        {jobs.filter(j => j.status === 'active' || j.status === 'draft').map(j => (
                          <option key={j._id} value={j._id}>{j.title}{j.department ? \` — \${j.department}\` : ''}{j.jobCode ? \` [\${j.jobCode}]\` : ''}</option>
                        ))}
                      </select>
                      <AErr f="jobId" />
                      {selectedJob && (
                        <div style={{ marginTop:6, padding:'8px 10px', background:'#f0fdf4', border:'1px solid #86efac', borderRadius:8, fontSize:11, color:'#15803d' }}>
                          <i className="bi bi-briefcase me-1" />
                          {[selectedJob.employmentMode, selectedJob.location, selectedJob.type].filter(Boolean).join(' · ')}
                          {selectedJob.experienceLevel === 'experienced' && selectedJob.minExperience != null ? \` · \${selectedJob.minExperience}–\${selectedJob.maxExperience} yrs exp\` : selectedJob.experienceLevel === 'fresher' ? ' · Fresher' : ''}
                        </div>
                      )}
                    </div>
                    <div className="col-md-6">
                      <label className="form-label" style={{ fontSize:13, fontWeight:600 }}>Qualification *</label>
                      <input className={\`form-control \${ae.qualification?'is-invalid':''}\`} placeholder="e.g. B.Tech, MBA, BSc" value={af.qualification} onChange={e => setAf('qualification', e.target.value)} />
                      <AErr f="qualification" />
                    </div>
                    <div className="col-12">
                      <label className="form-label" style={{ fontSize:13, fontWeight:600 }}>Experience Level *</label>
                      <div style={{ display:'flex', gap:8 }}>
                        {['fresher','experienced'].map(el => (
                          <button key={el} type="button" onClick={() => setAf('experienceLevel', el)}
                            style={{ padding:'7px 24px', borderRadius:8, border:\`1.5px solid \${af.isFresher===el?'#10b981':'#e2e8f0'}\`, background:af.isFresher===el?'#f0fdf4':'#fff', color:af.isFresher===el?'#059669':'#64748b', fontWeight:600, fontSize:12, cursor:'pointer' }}>
                            {el.charAt(0).toUpperCase()+el.slice(1)}
                          </button>
                        ))}
                      </div>
                    </div>
                    {af.isFresher === 'experienced' && (
                      <>
                        <div className="col-md-6">
                          <label className="form-label" style={{ fontSize:13, fontWeight:600 }}>Min Experience (years) *</label>
                          <input type="number" min="0" max="50" className={\`form-control \${ae.minExperience?'is-invalid':''}\`} placeholder="e.g. 2" value={af.minExperience} onChange={e => setAf('minExperience', e.target.value)} />
                          <AErr f="minExperience" />
                        </div>
                        <div className="col-md-6">
                          <label className="form-label" style={{ fontSize:13, fontWeight:600 }}>Max Experience (years) *</label>
                          <input type="number" min="0" max="50" className={\`form-control \${ae.maxExperience?'is-invalid':''}\`} placeholder="e.g. 6" value={af.maxExperience} onChange={e => setAf('maxExperience', e.target.value)} />
                          <AErr f="maxExperience" />
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* ③ Skills */}
                <div style={secStyle}>
                  <div style={secTitle}>③ Skills</div>
                  <div className="row g-3">
                    <div className="col-12">
                      <label className="form-label" style={{ fontSize:13, fontWeight:600 }}>Skills <span style={{ color:'#94a3b8', fontWeight:400 }}>(press Enter to add)</span></label>
                      <div style={{ display:'flex', flexWrap:'wrap', gap:4, padding:'6px 10px', border:'1px solid #e2e8f0', borderRadius:8, minHeight:42, background:'#fff' }}>
                        {af.skills.map((s,i) => <span key={i} style={tagStyle}>{s}<button onClick={()=>removeSkill(i)} style={{ border:'none', background:'none', color:'#2563eb', cursor:'pointer', padding:0, fontSize:12 }}>×</button></span>)}
                        <input value={appSkillInput} onChange={e=>setAppSkillInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();addSkill(appSkillInput);setAppSkillInput('');}}} placeholder={af.skills.length?'':'e.g. React, Node.js'} style={{ border:'none', outline:'none', fontSize:13, flex:1, minWidth:120, background:'transparent' }} />
                      </div>
                      {selectedJob?.requiredSkills?.length > 0 && (
                        <div style={{ marginTop:6, fontSize:11, color:'#64748b' }}>
                          Required by job:
                          {selectedJob.requiredSkills.map((s,i) => (
                            <span key={i} onClick={() => { if(!af.skills.includes(s)) setAf('skills',[...af.skills,s]); }} style={{ display:'inline-flex', alignItems:'center', gap:3, background: af.skills.includes(s)?'#dcfce7':'#f1f5f9', color:af.skills.includes(s)?'#15803d':'#475569', fontSize:10, fontWeight:600, padding:'1px 7px', borderRadius:20, margin:'2px', cursor:'pointer' }}>
                              {af.skills.includes(s) ? <i className="bi bi-check2" /> : <i className="bi bi-plus" />}{s}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* ④ Current Employment */}
                <div style={secStyle}>
                  <div style={secTitle}>④ Current Employment <span style={{ fontSize:10, fontWeight:400, color:'#94a3b8', textTransform:'none', letterSpacing:0 }}>(optional)</span></div>
                  <div className="row g-3">
                    <div className="col-md-4">
                      <label className="form-label" style={{ fontSize:13, fontWeight:600 }}>Current Company</label>
                      <input className="form-control" placeholder="e.g. Infosys" value={af.currentCompany} onChange={e => setAf('currentCompany', e.target.value)} />
                    </div>
                    <div className="col-md-4">
                      <label className="form-label" style={{ fontSize:13, fontWeight:600 }}>Current Role</label>
                      <input className="form-control" placeholder="e.g. Software Engineer" value={af.currentRole} onChange={e => setAf('currentRole', e.target.value)} />
                    </div>
                    <div className="col-md-4">
                      <label className="form-label" style={{ fontSize:13, fontWeight:600 }}>Notice Period</label>
                      <select className="form-select" value={af.noticePeriod} onChange={e => setAf('noticePeriod', e.target.value)}>
                        <option value="">Select</option>
                        {['Immediate','15 days','30 days','45 days','60 days','90 days'].map(n => <option key={n}>{n}</option>)}
                      </select>
                    </div>
                    <div className="col-md-4">
                      <label className="form-label" style={{ fontSize:13, fontWeight:600 }}>Expected Salary</label>
                      <input className="form-control" placeholder="e.g. 8 LPA" value={af.expectedSalary} onChange={e => setAf('expectedSalary', e.target.value)} />
                    </div>
                  </div>
                </div>

                {/* ⑤ Referral */}
                <div style={{...secStyle, marginBottom:0}}>
                  <div style={secTitle}>⑤ Referral <span style={{ fontSize:10, fontWeight:400, color:'#94a3b8', textTransform:'none', letterSpacing:0 }}>(optional)</span></div>
                  <div className="row g-3">
                    <div className="col-md-6">
                      <label className="form-label" style={{ fontSize:13, fontWeight:600 }}>Referral Source</label>
                      <label style={{ display:'flex', alignItems:'center', gap:8, padding:'9px 12px', border:\`1.5px solid \${af.referralFromOffice?'#3b82f6':'#e2e8f0'}\`, borderRadius:8, background:af.referralFromOffice?'#eff6ff':'#f8fafc', cursor:'pointer', fontSize:13, fontWeight:600, color:af.referralFromOffice?'#2563eb':'#64748b' }}>
                        <input type="checkbox" className="form-check-input m-0" checked={af.referralFromOffice} onChange={e => setAf('referralFromOffice', e.target.checked)} />
                        Referred by an employee of this organization
                      </label>
                    </div>
                    <div className="col-md-6">
                      <label className="form-label" style={{ fontSize:13, fontWeight:600 }}>{af.referralFromOffice ? 'Referring Employee' : 'Referral Name'}</label>
                      {af.referralFromOffice ? (
                        <select className="form-select" value={af.referralEmployeeId} onChange={e => setAf('referralEmployeeId', e.target.value)}>
                          <option value="">Select employee</option>
                          {employees.map(emp => <option key={emp._id} value={emp._id}>{emp.name}</option>)}
                        </select>
                      ) : (
                        <input className="form-control" placeholder="External referral name" value={af.referralName} onChange={e => setAf('referralName', e.target.value)} />
                      )}
                    </div>
                  </div>
                </div>

              </div>
              <div className="modal-footer" style={{ borderTop:'1px solid #e2e8f0', justifyContent:'space-between' }}>
                <button className="btn btn-outline-secondary" onClick={() => { setShowAppModal(false); setAppErrors({}); setAppSkillInput(''); setAppForm(EMPTY_APP); }}>Cancel</button>
                <button className="btn btn-primary" onClick={saveApplicant} disabled={saving}>
                  {saving ? <><span className="spinner-border spinner-border-sm me-2" />Adding...</> : <><i className="bi bi-person-plus me-2" />Add Applicant</>}
                </button>
              </div>
            </div>
          </div>
        </div>
        );
      })()}

      {/* `;

c = c.slice(0, start) + newModal + c.slice(end);

fs.writeFileSync('src/app/recruitment/page.js', c, 'utf8');

console.log('① Personal Info section:', c.includes('① Personal Information') ? 'OK' : 'MISS');
console.log('② Job & Qualification:', c.includes('② Job & Qualification') ? 'OK' : 'MISS');
console.log('③ Skills tag input:', c.includes('③ Skills') ? 'OK' : 'MISS');
console.log('④ Current Employment:', c.includes('④ Current Employment') ? 'OK' : 'MISS');
console.log('⑤ Referral:', c.includes('⑤ Referral') ? 'OK' : 'MISS');
console.log('AErr field errors:', c.includes('const AErr =') ? 'OK' : 'MISS');
console.log('Experience toggle buttons:', c.includes("af.isFresher===el") ? 'OK' : 'MISS');
console.log('Job info preview card:', c.includes('selectedJob && (') ? 'OK' : 'MISS');
console.log('Required skills clickable:', c.includes('Required by job:') ? 'OK' : 'MISS');
console.log('setAppErrs validation:', c.includes('setAppErrs(errs)') ? 'OK' : 'MISS');
