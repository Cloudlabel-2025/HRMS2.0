'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useSettings } from '@/lib/settings';
import AppShell from '@/components/AppShell';
import DateInput from '@/components/DateInput';

const STAGES = ['Applied', 'Screening', 'Interview', 'Offer', 'Hired', 'Rejected'];
const STAGE_COLORS = { Applied: '#64748b', Screening: '#3b82f6', Interview: '#f59e0b', Offer: '#8b5cf6', Hired: '#10b981', Rejected: '#ef4444' };
const EMPTY_JOB = {
  // Basic
  title: '', department: '', designation: '', type: 'Full-time',
  employmentMode: 'Onsite', location: '', openings: '1', status: 'active',
  // Requirements
  experienceLevel: 'fresher', minExperience: '', maxExperience: '',
  qualifications: '', requiredSkills: '', preferredSkills: '', description: '',
  // Compensation
  salaryType: 'not_disclosed', fixedSalary: '', minSalary: '', maxSalary: '',
  salaryCurrency: 'INR', salaryPeriod: 'annual', benefits: [],
  // Recruitment
  hiringManagerId: '', recruiterId: '', applicationDeadline: '',
  interviewRounds: '1', assessmentRequired: false,
  // Screening
  screeningQuestions: [],
  // Publishing
  isInternal: false, autoClose: false,
};
const EMPTY_APP = { name: '', email: '', phone: '', jobId: '', qualification: '', skills: '', isFresher: 'yes', experienceYears: '', referralName: '', referralFromOffice: false, referralEmployeeId: '', resumeFileName: '' };

export default function RecruitmentPage() {
  const { user } = useAuth();
  const { formatDate } = useSettings();
  const [tab, setTab] = useState('jobs');
  const [jobs, setJobs] = useState([]);
  const [applicants, setApplicants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showJobModal, setShowJobModal] = useState(false);
  const [showAppModal, setShowAppModal] = useState(false);
  const [jobForm, setJobForm] = useState(EMPTY_JOB);
  const [appForm, setAppForm] = useState(EMPTY_APP);
  const [saving, setSaving] = useState(false);
  const [jobErrors, setJobErrors] = useState({});
  const [appErrors, setAppErrors] = useState({});
  const jobErrorTimers = typeof window !== 'undefined' ? (window.__jobErrTimers = window.__jobErrTimers || {}) : {};
  const setFieldError = (key, msg) => {
    setJobErrors(p => ({ ...p, [key]: msg }));
    if (jobErrorTimers[key]) clearTimeout(jobErrorTimers[key]);
    jobErrorTimers[key] = setTimeout(() => {
      setJobErrors(p => { const n = { ...p }; delete n[key]; return n; });
      delete jobErrorTimers[key];
    }, 10000);
  };
  const setFieldErrors = (errObj) => {
    setJobErrors(errObj);
    Object.keys(errObj).forEach(key => {
      if (jobErrorTimers[key]) clearTimeout(jobErrorTimers[key]);
      jobErrorTimers[key] = setTimeout(() => {
        setJobErrors(p => { const n = { ...p }; delete n[key]; return n; });
        delete jobErrorTimers[key];
      }, 10000);
    });
  };

  const [hrUsers, setHrUsers] = useState([]);
  const [toast, setToast] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [hiredModal, setHiredModal] = useState(null);
  const [rejectModal, setRejectModal] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [priorRejectModal, setPriorRejectModal] = useState(null);
  const [confirmAddModal, setConfirmAddModal] = useState(null);
  const [confirmReconsiderModal, setConfirmReconsiderModal] = useState(null);
  const [confirmMoveModal, setConfirmMoveModal] = useState(null);
  const [editJobModal, setEditJobModal] = useState(null);
  const [confirmDeleteJobModal, setConfirmDeleteJobModal] = useState(null);
  const [editAppModal, setEditAppModal] = useState(null);
  const [editAppForm, setEditAppForm] = useState({});
  const [editAppErrors, setEditAppErrors] = useState({});
  const [savingApp, setSavingApp] = useState(false);
  const [pendingApplicant, setPendingApplicant] = useState(null);
  const router = useRouter();

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };
  const setAppField = (key, value) => {
    setAppForm(p => ({ ...p, [key]: value }));
    if (appErrors[key]) {
      setAppErrors(p => {
        const next = { ...p };
        delete next[key];
        return next;
      });
    }
  };
  const AppError = ({ field }) => appErrors[field] ? (
    <div style={{ color: '#ef4444', fontSize: 11, marginTop: 3 }}>
      <i className="bi bi-exclamation-circle me-1" />{appErrors[field]}
    </div>
  ) : null;
  const recordAuditAction = (action, details, severity = 'low') => {
    api.post('/api/audit/action', { action, module: 'Recruitment', details, severity }).catch(() => {});
  };
  const rejectRecruitmentAction = (action, message) => {
    showToast(message, 'error');
    recordAuditAction(action, message, 'medium');
  };
  const isAdmin = ['super_admin', 'admin_full', 'recruiter'].includes(user?.role);
  const getUserId = (person) => String(person?.userId || person?._id || '');
  const assignmentPeople = employees.filter(e => ['super_admin','admin_full','recruiter'].includes(e.role));
  const findAssignedPerson = (id) => {
    if (!id) return null;
    const idText = String(id);
    return assignmentPeople.find(e => String(e._id) === idText || String(e.userId) === idText) || null;
  };
  const getScreeningQuestions = (job) => Array.isArray(job?.screeningQuestions)
    ? job.screeningQuestions.filter(q => String(q?.question || '').trim())
    : [];
  const jobsWithScreeningQuestions = jobs.filter(job => getScreeningQuestions(job).length > 0);
  const openPostJob = () => {
    setEditJobModal(null);
    setJobForm(EMPTY_JOB);
    setJobErrors({});
    setShowJobModal(true);
  };
  const buildJobPayload = (id = null) => ({
    ...(id ? { id } : {}),
    title: jobForm.title.trim(),
    department: jobForm.department,
    designation: jobForm.designation,
    type: jobForm.type,
    employmentMode: jobForm.employmentMode,
    location: jobForm.location,
    openings: Number(jobForm.openings) || 1,
    status: jobForm.status && jobForm.status !== 'draft' ? jobForm.status : 'active',
    experienceLevel: jobForm.experienceLevel,
    minExperience: jobForm.minExperience,
    maxExperience: jobForm.maxExperience,
    qualifications: jobForm.qualifications.split(',').map(s => s.trim()).filter(Boolean),
    requiredSkills: jobForm.requiredSkills.split(',').map(s => s.trim()).filter(Boolean),
    preferredSkills: jobForm.preferredSkills.split(',').map(s => s.trim()).filter(Boolean),
    description: jobForm.description,
    salaryType: jobForm.salaryType,
    fixedSalary: jobForm.fixedSalary,
    minSalary: jobForm.minSalary,
    maxSalary: jobForm.maxSalary,
    salaryCurrency: jobForm.salaryCurrency,
    salaryPeriod: jobForm.salaryPeriod,
    benefits: jobForm.benefits,
    hiringManagerId: jobForm.hiringManagerId,
    recruiterId: jobForm.recruiterId,
    applicationDeadline: jobForm.applicationDeadline,
    interviewRounds: Number(jobForm.interviewRounds) || 1,
    assessmentRequired: jobForm.assessmentRequired,
    screeningQuestions: jobForm.screeningQuestions,
    autoClose: jobForm.autoClose,
  });

  const load = async () => {
    setLoading(true);
    try {
      const [j, a] = await Promise.all([
        api.get('/api/recruitment/jobs'),
        api.get('/api/recruitment/applicants'),
      ]);
      setJobs(Array.isArray(j) ? j : []);
      setApplicants(Array.isArray(a) ? a : []);
    } catch (e) { showToast(e.message, 'error'); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (user) {
      load();
      api.get('/api/settings?type=departments').then(data => setDepartments(data.map(d => d.name))).catch(() => {});
      api.get('/api/settings?type=designations').then(data => setDesignations(Array.isArray(data) ? data : [])).catch(() => {});
      api.get('/api/employees').then(data => setEmployees(Array.isArray(data) ? data : [])).catch(() => {});
      api.get('/api/employees?role=super_admin&status=active').then(d => {
        const admins = Array.isArray(d) ? d : [];
        api.get('/api/employees?role=admin_full&status=active').then(d2 => {
          const combined = [...admins, ...(Array.isArray(d2) ? d2 : [])];
          setHrUsers(combined);
        }).catch(() => setHrUsers(admins));
      }).catch(() => {});
    }
  }, [user]);

  const saveJob = async () => {
    const errs = {};
    const jf = jobForm;

    if (!jf.title.trim()) errs.title = 'Job title is required';
    else if (!/^[A-Za-z\s]+$/.test(jf.title.trim())) errs.title = 'Title can only contain letters and spaces';
    else if (jf.title.trim().length > 30) errs.title = 'Title must be 30 characters or less';

    if (!jf.department) errs.department = 'Department is required';
    if (!jf.employmentMode) errs.employmentMode = 'Employment mode is required';
    if (jf.employmentMode !== 'Remote' && !jf.location.trim()) errs.location = 'Location is required for non-remote jobs';
    else if (jf.location.trim() && !/^[A-Za-z\s]+$/.test(jf.location.trim())) errs.location = 'Location can only contain alphabets';
    else if (jf.location.trim().length > 25) errs.location = 'Location must be 25 characters or less';
    if (jf.openings && !/^\d{1,2}$/.test(jf.openings)) errs.openings = 'Openings must be 1-99';
    if (!jf.qualifications.trim()) errs.qualifications = 'At least one qualification is required';
    if (!jf.description.trim()) errs.description = 'Job description is required';
    else if (jf.description.trim().length < 50) errs.description = 'Description must be at least 50 characters';
    if (!jf.hiringManagerId) errs.hiringManagerId = 'Hiring manager is required to publish';
    if (jf.experienceLevel === 'experienced') {
      if (jf.minExperience === '' || jf.minExperience === null) errs.minExperience = 'Minimum experience is required';
      else if (!/^\d$/.test(jf.minExperience)) errs.minExperience = 'Must be a single digit';
      if (jf.maxExperience === '' || jf.maxExperience === null) errs.maxExperience = 'Maximum experience is required';
      else if (!/^\d$/.test(jf.maxExperience)) errs.maxExperience = 'Must be a single digit';
      if (jf.minExperience !== '' && jf.maxExperience !== '' && Number(jf.maxExperience) < Number(jf.minExperience))
        errs.maxExperience = 'Max experience must be greater than min';
    }
    const maxSalaryDigits = jf.salaryPeriod === 'monthly' ? 6 : 7;
    if (jf.salaryType === 'fixed') {
      if (!jf.fixedSalary || Number(jf.fixedSalary) < 1) errs.fixedSalary = 'Fixed salary is required';
      else if (jf.fixedSalary.length > maxSalaryDigits) errs.fixedSalary = `Max ${maxSalaryDigits} digits for ${jf.salaryPeriod} salary`;
    }
    if (jf.salaryType === 'range') {
      if (!jf.minSalary || Number(jf.minSalary) < 1) errs.minSalary = 'Minimum salary is required';
      else if (jf.minSalary.length > maxSalaryDigits) errs.minSalary = `Max ${maxSalaryDigits} digits for ${jf.salaryPeriod} salary`;
      if (!jf.maxSalary || Number(jf.maxSalary) < 1) errs.maxSalary = 'Maximum salary is required';
      else if (jf.maxSalary.length > maxSalaryDigits) errs.maxSalary = `Max ${maxSalaryDigits} digits for ${jf.salaryPeriod} salary`;
      if (jf.minSalary && jf.maxSalary && Number(jf.maxSalary) <= Number(jf.minSalary))
        errs.maxSalary = 'Max salary must be greater than min salary';
    }
    if (!jf.applicationDeadline) errs.applicationDeadline = 'Application deadline is required';
    else {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const deadline = new Date(jf.applicationDeadline);
      if (deadline <= today) errs.applicationDeadline = 'Deadline must be after today';
    }
    (jf.screeningQuestions || []).forEach((q, i) => {
      if (!q.question.trim()) errs['sq_' + i + '_question'] = 'Question ' + (i + 1) + ' text is required';
      if (q.type === 'multiple_choice' && (!q.options || q.options.filter(opt => String(opt || '').trim()).length < 2))
        errs['sq_' + i + '_options'] = 'Question ' + (i + 1) + ' needs at least 2 options';
    });

    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      return;
    }

    setSaving(true);
    try {
      await api.post('/api/recruitment/jobs', buildJobPayload());
      showToast('Job published successfully');
      setShowJobModal(false);
      setEditJobModal(null);
      setJobForm(EMPTY_JOB);
      setJobErrors({});
      load();
    } catch (e) {
      try {
        const parsed = JSON.parse(e.message);
        if (parsed?.errors) { setFieldErrors(parsed.errors); return; }
      } catch {}
      showToast(e.message, 'error');
    }
    finally { setSaving(false); }
  };

  const saveApplicant = async () => {
    const name = appForm.name.trim();
    const email = appForm.email.trim();
    const qualification = appForm.qualification.trim();
    const errors = {};

    if (!name) errors.name = 'Name is required';
    else if (name.length > 30) errors.name = 'Name must be 30 characters or less';
    else if (!/^[A-Z]/.test(name)) errors.name = 'First letter must be uppercase';
    if (!email) errors.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Please enter a valid email address';
    if (!appForm.phone) errors.phone = 'Phone is required';
    else if (!/^[0-9]{10}$/.test(appForm.phone)) errors.phone = 'Phone must be exactly 10 digits';
    if (!appForm.jobId) errors.jobId = 'Job is required';
    if (!qualification) errors.qualification = 'Qualification is required';
    if (appForm.isFresher === 'no' && !Number(appForm.experienceYears)) errors.experienceYears = 'Years of experience is required for non-freshers';

    if (Object.keys(errors).length) {
      setAppErrors(errors);
      rejectRecruitmentAction('Applicant Create Validation Failed', 'Please fix the highlighted applicant fields');
      return;
    }

    const job = jobs.find(j => j._id === appForm.jobId);
    setPendingApplicant({
      ...appForm,
      name,
      email,
      qualification,
      phone: appForm.phone,
      jobTitle: job?.title || '',
    });
  };

  const doSaveApplicant = async () => {
    if (!pendingApplicant) return;
    const applicant = pendingApplicant;
    setPendingApplicant(null);
    setSaving(true);
    try {
      const created = await api.post('/api/recruitment/applicants', {
        name: applicant.name,
        email: applicant.email,
        phone: applicant.phone,
        jobId: applicant.jobId,
        qualification: applicant.qualification,
        skills: applicant.skills ? applicant.skills.split(',').map(s => s.trim()).filter(Boolean) : [],
        isFresher: applicant.isFresher === 'yes',
        experienceYears: applicant.isFresher === 'no' ? Number(applicant.experienceYears) : 0,
        referralName: applicant.referralFromOffice
          ? employees.find(e => e._id === applicant.referralEmployeeId)?.name || ''
          : applicant.referralName,
        referralFromOffice: applicant.referralFromOffice,
        referralEmployeeId: applicant.referralFromOffice ? applicant.referralEmployeeId || null : null,
      });
      showToast(created.previousRejection?.matchedBy ? 'Applicant added with prior rejection match' : 'Applicant added');
      setShowAppModal(false);
      setAppForm(EMPTY_APP);
      setAppErrors({});
      if (created.previousRejection?.matchedBy) setPriorRejectModal(created);
      load();
    } catch (e) { showToast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const moveStage = async (id, stage, appName, appEmail) => {
    try {
      const updated = await api.put('/api/recruitment/applicants', { id, stage });
      setApplicants(prev => prev.map(a => a._id === id ? updated : a));
      showToast(`Moved to ${stage}`);
      if (stage === 'Hired') setHiredModal(updated);
    } catch (e) { showToast(e.message, 'error'); }
  };

  const requestMoveStage = (app, stage) => {
    if (stage === 'Rejected') { openReject(app); return; }
    setConfirmMoveModal({ app, stage });
  };

  const confirmMove = async () => {
    if (!confirmMoveModal) return;
    setSaving(true);
    try {
      await moveStage(confirmMoveModal.app._id, confirmMoveModal.stage, confirmMoveModal.app.name, confirmMoveModal.app.email);
      setConfirmMoveModal(null);
    } catch(e) { showToast(e.message, 'error'); }
    finally { setSaving(false); }
  };

    const registerApplicant = (app) => {
    const job = jobs.find(j => j._id === app.jobId || j._id === app.jobId?._id);
    sessionStorage.setItem('hrms_hire_prefill', JSON.stringify({
      sourceApplicantId: app._id,
      name: app.name,
      email: app.email,
      phone: app.phone || '',
      department: job?.department || '',
      designation: job?.title || '',
      skills: (app.skills || []).join(', '),
    }));
    router.push('/employees');
  };

  const confirmAddToOrganization = () => {
    if (!confirmAddModal) return;
    registerApplicant(confirmAddModal);
    setConfirmAddModal(null);
  };

  const confirmReconsider = async () => {
    if (!confirmReconsiderModal) return;
    const { id, stage } = confirmReconsiderModal;
    setSaving(true);
    try {
      const updated = await api.put('/api/recruitment/applicants', { id, stage });
      setApplicants(prev => prev.map(a => a._id === id ? updated : a));
      showToast(`Moved to ${stage}`);
      setConfirmReconsiderModal(null);
    } catch (e) { showToast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const openEditJob = (job) => {
    const toStr = (v) => (v === null || v === undefined) ? '' : String(v);
    const toAssignmentUserId = (v) => {
      const person = findAssignedPerson(v);
      return person ? getUserId(person) : toStr(v);
    };
    const deadline = job.applicationDeadline ? new Date(job.applicationDeadline).toISOString().split('T')[0] : '';
    setJobForm({
      title: job.title || '',
      department: job.department || '',
      designation: job.designation || '',
      type: job.type || 'Full-time',
      employmentMode: job.employmentMode || 'Onsite',
      location: job.location || '',
      openings: toStr(job.openings || 1),
      status: job.status || 'draft',
      experienceLevel: job.experienceLevel || 'fresher',
      minExperience: toStr(job.minExperience ?? ''),
      maxExperience: toStr(job.maxExperience ?? ''),
      qualifications: Array.isArray(job.qualifications) ? job.qualifications.join(', ') : '',
      requiredSkills: Array.isArray(job.requiredSkills) ? job.requiredSkills.join(', ') : '',
      preferredSkills: Array.isArray(job.preferredSkills) ? job.preferredSkills.join(', ') : '',
      description: job.description || '',
      salaryType: job.salaryType || 'not_disclosed',
      fixedSalary: toStr(job.fixedSalary ?? ''),
      minSalary: toStr(job.minSalary ?? ''),
      maxSalary: toStr(job.maxSalary ?? ''),
      salaryCurrency: job.salaryCurrency || 'INR',
      salaryPeriod: job.salaryPeriod || 'annual',
      benefits: Array.isArray(job.benefits) ? job.benefits : [],
      hiringManagerId: toAssignmentUserId(job.hiringManagerId),
      recruiterId: toAssignmentUserId(job.recruiterId),
      applicationDeadline: deadline,
      interviewRounds: toStr(job.interviewRounds || 1),
      assessmentRequired: !!job.assessmentRequired,
      screeningQuestions: Array.isArray(job.screeningQuestions) ? job.screeningQuestions : [],
      isInternal: !!job.isInternal,
      autoClose: !!job.autoClose,
    });
    setJobErrors({});
    setEditJobModal(job._id);
    setShowJobModal(true);
  };

  const saveEditJob = async () => {
    const errs = {};
    const jf = jobForm;
    if (!jf.title.trim()) errs.title = 'Job title is required';
    else if (!/^[A-Za-z\s]+$/.test(jf.title.trim())) errs.title = 'Title can only contain letters and spaces';
    else if (jf.title.trim().length > 30) errs.title = 'Title must be 30 characters or less';
    if (!jf.department) errs.department = 'Department is required';
    if (jf.employmentMode !== 'Remote' && !jf.location.trim()) errs.location = 'Location is required for non-remote jobs';
    else if (jf.location.trim() && !/^[A-Za-z\s]+$/.test(jf.location.trim())) errs.location = 'Location can only contain alphabets';
    else if (jf.location.trim().length > 25) errs.location = 'Location must be 25 characters or less';
    if (jf.openings && !/^\d{1,2}$/.test(jf.openings)) errs.openings = 'Openings must be 1-99';
    if (!jf.qualifications.trim()) errs.qualifications = 'At least one qualification is required';
    if (!jf.description.trim()) errs.description = 'Job description is required';
    else if (jf.description.trim().length < 50) errs.description = 'Description must be at least 50 characters';
    if (!jf.hiringManagerId) errs.hiringManagerId = 'Hiring manager is required to publish';
    if (jf.experienceLevel === 'experienced') {
      if (jf.minExperience === '' || jf.minExperience === null) errs.minExperience = 'Minimum experience is required';
      else if (!/^\d$/.test(jf.minExperience)) errs.minExperience = 'Must be a single digit';
      if (jf.maxExperience === '' || jf.maxExperience === null) errs.maxExperience = 'Maximum experience is required';
      else if (!/^\d$/.test(jf.maxExperience)) errs.maxExperience = 'Must be a single digit';
      if (jf.minExperience !== '' && jf.maxExperience !== '' && Number(jf.maxExperience) < Number(jf.minExperience))
        errs.maxExperience = 'Max experience must be greater than min';
    }
    const maxSalaryDigits = jf.salaryPeriod === 'monthly' ? 6 : 7;
    if (jf.salaryType === 'fixed') {
      if (!jf.fixedSalary || Number(jf.fixedSalary) < 1) errs.fixedSalary = 'Fixed salary is required';
      else if (jf.fixedSalary.length > maxSalaryDigits) errs.fixedSalary = `Max ${maxSalaryDigits} digits for ${jf.salaryPeriod} salary`;
    }
    if (jf.salaryType === 'range') {
      if (!jf.minSalary || Number(jf.minSalary) < 1) errs.minSalary = 'Minimum salary is required';
      else if (jf.minSalary.length > maxSalaryDigits) errs.minSalary = `Max ${maxSalaryDigits} digits for ${jf.salaryPeriod} salary`;
      if (!jf.maxSalary || Number(jf.maxSalary) < 1) errs.maxSalary = 'Maximum salary is required';
      else if (jf.maxSalary.length > maxSalaryDigits) errs.maxSalary = `Max ${maxSalaryDigits} digits for ${jf.salaryPeriod} salary`;
      if (jf.minSalary && jf.maxSalary && Number(jf.maxSalary) <= Number(jf.minSalary)) errs.maxSalary = 'Max salary must be greater than min salary';
    }
    if (!jf.applicationDeadline) errs.applicationDeadline = 'Application deadline is required';
    else {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const deadline = new Date(jf.applicationDeadline);
      if (deadline <= today) errs.applicationDeadline = 'Deadline must be after today';
    }
    (jf.screeningQuestions || []).forEach((q, i) => {
      if (!q.question.trim()) errs['sq_' + i + '_question'] = 'Question ' + (i + 1) + ' text is required';
      if (q.type === 'multiple_choice' && (!q.options || q.options.filter(opt => String(opt || '').trim()).length < 2))
        errs['sq_' + i + '_options'] = 'Question ' + (i + 1) + ' needs at least 2 options';
    });
    if (Object.keys(errs).length) { setFieldErrors(errs); return; }
    setSaving(true);
    try {
      await api.put('/api/recruitment/jobs', buildJobPayload(editJobModal));
      showToast('Job updated');
      setShowJobModal(false); setEditJobModal(null); setJobForm(EMPTY_JOB);
      setJobErrors({});
      load();
    } catch (e) {
      try { const p = JSON.parse(e.message); if (p?.errors) { setFieldErrors(p.errors); return; } } catch {}
      showToast(e.message, 'error');
    }
    finally { setSaving(false); }
  };

  const deleteJob = async () => {
    if (!confirmDeleteJobModal) return;
    setSaving(true);
    try {
      await api.delete('/api/recruitment/jobs', { id: confirmDeleteJobModal._id });
      showToast('Job removed');
      setConfirmDeleteJobModal(null);
      load();
    } catch (e) { showToast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const openEditApp = (app) => {
    setEditAppForm({
      _id: app._id,
      name: app.name || '',
      email: app.email || '',
      phone: app.phone || '',
      jobId: app.jobId?._id || app.jobId || '',
      qualification: app.qualification || '',
      skills: (app.skills || []).join(', '),
      isFresher: app.isFresher ? 'yes' : 'no',
      experienceYears: String(app.experienceYears || ''),
      referralName: app.referralName || '',
      referralFromOffice: !!app.referralFromOffice,
      referralEmployeeId: app.referralEmployeeId ? String(app.referralEmployeeId) : '',
    });
    setEditAppErrors({});
    setEditAppModal(app);
  };

  const saveEditApp = async () => {
    const errs = {};
    const f = editAppForm;
    if (!f.name.trim()) errs.name = 'Name is required';
    if (!f.email.trim()) errs.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) errs.email = 'Enter a valid email address';
    if (!f.phone) errs.phone = 'Phone is required';
    else if (!/^[0-9]{10}$/.test(f.phone)) errs.phone = 'Phone must be exactly 10 digits';
    if (!f.jobId) errs.jobId = 'Job is required';
    if (!f.qualification.trim()) errs.qualification = 'Qualification is required';
    if (f.isFresher === 'no' && !Number(f.experienceYears)) errs.experienceYears = 'Years of experience is required';
    if (Object.keys(errs).length) { setEditAppErrors(errs); Object.keys(errs).forEach(k => { setTimeout(() => setEditAppErrors(p => { const n={...p}; delete n[k]; return n; }), 10000); }); return; }
    setSavingApp(true);
    try {
      await api.put('/api/recruitment/applicants', {
        id: editAppForm._id,
        name: f.name.trim(),
        email: f.email.trim(),
        phone: f.phone,
        jobId: f.jobId,
        qualification: f.qualification.trim(),
        skills: f.skills ? f.skills.split(',').map(s => s.trim()).filter(Boolean) : [],
        isFresher: f.isFresher === 'yes',
        experienceYears: f.isFresher === 'no' ? Number(f.experienceYears) : 0,
        referralName: f.referralFromOffice ? (employees.find(e => e._id === f.referralEmployeeId)?.name || '') : f.referralName,
        referralFromOffice: f.referralFromOffice,
        referralEmployeeId: f.referralFromOffice ? f.referralEmployeeId || null : null,
      });
      showToast('Applicant updated');
      setEditAppModal(null);
      load();
    } catch (e) { showToast(e.message, 'error'); }
    finally { setSavingApp(false); }
  };

  const confirmReject = async () => {
    if (!rejectModal) return;
    const reason = rejectReason.trim();
    if (!reason) return showToast('Rejection reason is required', 'error');
    setSaving(true);
    try {
      const updated = await api.put('/api/recruitment/applicants', { id: rejectModal._id, stage: 'Rejected', rejectionReason: reason });
      setApplicants(prev => prev.map(a => a._id === updated._id ? updated : a));
      showToast('Candidate rejected');
      setRejectModal(null);
      setRejectReason('');
    } catch (e) { showToast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const openReject = (app) => {
    setRejectModal(app);
    setRejectReason('');
  };

  const hiredApplicants = applicants.filter(a => a.stage === 'Hired');
  const hiredPending = hiredApplicants.filter(a => !a.onboardedAt);
  const rejectedApplicants = applicants.filter(a => a.stage === 'Rejected');

  return (
    <AppShell title="Recruitment">
      {toast && <div className="toast-container-custom"><div className={`toast-custom ${toast.type}`}><i className={`bi ${toast.type === 'success' ? 'bi-check-circle' : 'bi-exclamation-circle'} me-2`} />{toast.msg}</div></div>}

      <div className="page-header">
        <div><h4>Recruitment</h4><p>{jobs.filter(j => j.status === 'active').length} open positions · {applicants.length} total applicants</p></div>
        {isAdmin && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-outline-primary" onClick={() => setShowAppModal(true)}><i className="bi bi-person-plus me-2" />Add Applicant</button>
            <button className="btn btn-primary" onClick={openPostJob}><i className="bi bi-plus-lg me-2" />Post Job</button>
          </div>
        )}
      </div>

      <div className="row g-3 mb-4">
        {[
          { label: 'Open Positions',  value: jobs.filter(j => j.status === 'active').length,                         color: '#3b82f6', icon: 'bi-briefcase' },
          { label: 'Total Applicants',value: applicants.length,                                                       color: '#8b5cf6', icon: 'bi-people' },
          { label: 'In Interview',    value: applicants.filter(a => a.stage === 'Interview').length,                  color: '#f59e0b', icon: 'bi-chat-dots' },
          { label: 'Offers / Hired',  value: applicants.filter(a => ['Offer','Hired'].includes(a.stage)).length,      color: '#10b981', icon: 'bi-envelope-check' },
          { label: 'Rejected',        value: rejectedApplicants.length,                                                color: '#ef4444', icon: 'bi-person-x' },
        ].map((s, i) => (
          <div key={i} className="col-6 col-xl-3">
            <div className="stat-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div><div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 6 }}>{s.label}</div><div style={{ fontSize: 28, fontWeight: 800, color: s.color }}>{s.value}</div></div>
                <div className="stat-icon" style={{ background: s.color + '15' }}><i className={`bi ${s.icon}`} style={{ color: s.color }} /></div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: '#f8fafc', borderRadius: 10, padding: 4, width: 'fit-content' }}>
        {['jobs', 'pipeline', 'screening', 'applicants', 'hired', 'rejected'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: '7px 18px', borderRadius: 8, border: 'none', fontWeight: 600, fontSize: 13, cursor: 'pointer', background: tab === t ? '#fff' : 'transparent', color: tab === t ? '#1e293b' : '#64748b', boxShadow: tab === t ? '0 1px 4px rgba(0,0,0,0.08)' : 'none' }}>
            {t === 'jobs' ? 'Job Postings' : t === 'pipeline' ? 'Pipeline' : t === 'screening' ? 'Screening Questions' : t === 'applicants' ? 'All Applicants' : t === 'hired' ? 'Hired - Onboarding' : 'Rejected Applicants'}
          </button>
        ))}
      </div>

      {loading ? <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner-border text-primary" /></div> : (
        <>
          {tab === 'jobs' && (
            <div className="row g-3">
              {jobs.length === 0 && <div className="col-12"><div className="empty-state"><i className="bi bi-briefcase" /><h6>No job postings yet</h6></div></div>}
              {jobs.map(job => (
                <div key={job._id} className="col-md-6">
                  <div className="card p-3">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>{job.title}</div>
                        <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{[job.department, job.type, job.location].filter(Boolean).join(' - ')}</div>
                      </div>
                      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                        <span className={`badge ${job.status === 'active' ? 'status-approved' : 'status-rejected'}`}>{job.status}</span>
                        {isAdmin && <button className="btn btn-xs btn-outline-secondary" style={{ padding:'2px 8px', fontSize:11 }} onClick={() => openEditJob(job)}><i className="bi bi-pencil me-1" />Edit</button>}
                        {['super_admin','admin_full'].includes(user?.role) && <button className="btn btn-xs btn-outline-danger" style={{ padding:'2px 8px', fontSize:11 }} onClick={() => setConfirmDeleteJobModal(job)}><i className="bi bi-trash me-1" />Remove</button>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#94a3b8', marginBottom: job.requiredSkills?.length ? 10 : 0 }}>
                      <span><i className="bi bi-calendar3 me-1" />Posted {formatDate(job.createdAt)}</span>
                      <span><i className="bi bi-person-workspace me-1" />{job.openings || 1} opening{Number(job.openings || 1) === 1 ? '' : 's'}</span>
                      <span><i className="bi bi-people me-1" />{applicants.filter(a => a.jobId === job._id || a.jobId?._id === job._id).length} applicants</span>
                    </div>
                    {job.salaryRange && <div style={{ fontSize: 12, color: '#475569', marginBottom: 8 }}><i className="bi bi-cash-coin me-1" />{job.salaryRange}</div>}
                    {job.description && <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>{job.description}</div>}
                    {job.requiredSkills?.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                        {job.requiredSkills.map((s, i) => (
                          <span key={i} style={{ background: '#eff6ff', color: '#2563eb', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 12 }}>{s}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'pipeline' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              {STAGES.map(stage => {
                const stageApps = applicants.filter(a => a.stage === stage);
                return (
                  <div key={stage} className="kanban-col">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: STAGE_COLORS[stage] }} />
                        <span style={{ fontWeight: 700, fontSize: 12 }}>{stage}</span>
                      </div>
                      <span style={{ background: '#e2e8f0', color: '#64748b', borderRadius: 20, padding: '1px 7px', fontSize: 11, fontWeight: 700 }}>{stageApps.length}</span>
                    </div>
                    {stageApps.map(app => (
                      <div key={app._id} className="kanban-card">
                        <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 2 }}>{app.name}</div>
                        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>{app.email}</div>
                        {app.isFresher !== undefined && (
                          <div style={{ fontSize: 11, color: app.isFresher ? '#10b981' : '#f59e0b', fontWeight: 600, marginBottom: 4 }}>
                            {app.isFresher ? 'Fresher' : `${app.experienceYears || 0} yr exp`}
                          </div>
                        )}
                        {app.skills?.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 6 }}>
                            {app.skills.slice(0, 3).map((s, i) => <span key={i} style={{ background: '#f1f5f9', color: '#475569', fontSize: 9, padding: '1px 5px', borderRadius: 8 }}>{s}</span>)}
                          </div>
                        )}
                        {isAdmin && (() => {
                          const idx = STAGES.indexOf(stage);
                          const next = STAGES.slice(idx + 1);
                          return (
                            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                              {next.map(s => (
                                <button key={s} onClick={() => requestMoveStage(app, s)}
                                  style={{ fontSize: 9, padding: '2px 5px', borderRadius: 4, border: `1px solid ${STAGE_COLORS[s]}40`, background: STAGE_COLORS[s] + '10', color: STAGE_COLORS[s], cursor: 'pointer' }}>
                                  → {s}
                                </button>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'screening' && (
            <div className="card">
              <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 10 }}>
                <i className="bi bi-question-circle" style={{ color: '#3b82f6', fontSize: 16 }} />
                <span style={{ fontWeight: 750, fontSize: 14.5 }}>Screening Questions by Job</span>
                <span style={{ marginLeft: 'auto', color: '#94a3b8', fontSize: 12 }}>{jobsWithScreeningQuestions.length} jobs</span>
              </div>

              {jobsWithScreeningQuestions.length === 0 ? (
                <div className="empty-state"><i className="bi bi-question-circle" /><h6>No screening questions added yet</h6></div>
              ) : (
                <div style={{ padding: 20, display: 'grid', gap: 14 }}>
                  {jobsWithScreeningQuestions.map(job => {
                    const hiringManager = findAssignedPerson(job.hiringManagerId);
                    const recruiter = findAssignedPerson(job.recruiterId);
                    const screeningQuestions = getScreeningQuestions(job);
                    return (
                      <div key={job._id} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 16, background: '#fff' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                          <div>
                            <div style={{ fontWeight: 800, color: '#1e293b', fontSize: 15 }}>{job.title}</div>
                            <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>
                              {[job.department, job.jobCode].filter(Boolean).join(' · ')}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                            <span className="badge" style={{ background: '#eff6ff', color: '#2563eb' }}>
                              Hiring Manager: {hiringManager?.name || 'Not assigned'}
                            </span>
                            <span className="badge" style={{ background: '#f0fdf4', color: '#059669' }}>
                              Recruiter: {recruiter?.name || 'Not assigned'}
                            </span>
                            {job.applicationDeadline && (
                              <span className="badge" style={{ background: '#fffbeb', color: '#d97706' }}>
                                Deadline: {formatDate(job.applicationDeadline)}
                              </span>
                            )}
                          </div>
                        </div>

                        <div style={{ display: 'grid', gap: 10 }}>
                          {screeningQuestions.map((question, index) => (
                            <div key={index} style={{ border: '1px solid #f1f5f9', borderRadius: 8, padding: 12, background: '#f8fafc' }}>
                              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                                <span style={{ minWidth: 24, height: 24, borderRadius: '50%', background: '#dbeafe', color: '#1d4ed8', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800 }}>
                                  {index + 1}
                                </span>
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontWeight: 700, color: '#334155', fontSize: 13 }}>
                                    {question.question}
                                    {question.required && <span style={{ color: '#ef4444', marginLeft: 4 }}>*</span>}
                                  </div>
                                  <div style={{ marginTop: 4, color: '#64748b', fontSize: 11, textTransform: 'capitalize' }}>
                                    Type: {(question.type || 'text').replace('_', ' ')}
                                  </div>
                                  {question.type === 'multiple_choice' && question.options?.length > 0 && (
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                                      {question.options.map((option, optionIndex) => (
                                        <span key={optionIndex} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, color: '#475569', fontSize: 11, padding: '2px 8px' }}>
                                          {option}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {tab === 'applicants' && (
            <div className="card">
              <div className="table-responsive">
                <table className="table mb-0">
                  <thead>
                    <tr>
                      <th>Applicant</th><th>Job</th><th>Qualification</th><th>Experience</th><th>Skills</th><th>Applied</th><th>Stage</th>
                      {isAdmin && <th>Move Stage</th>}
                      {isAdmin && <th></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {applicants.length === 0 ? (
                      <tr><td colSpan={8}><div className="empty-state"><i className="bi bi-people" /><h6>No applicants yet</h6></div></td></tr>
                    ) : applicants.map(app => {
                      const job = jobs.find(j => j._id === app.jobId || j._id === app.jobId?._id);
                      return (
                        <tr key={app._id}>
                          <td>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{app.name}</div>
                            <div style={{ fontSize: 11, color: '#94a3b8' }}>{app.email}</div>
                            {app.phone && <div style={{ fontSize: 11, color: '#94a3b8' }}>{app.phone}</div>}
                            {app.previousRejection?.matchedBy && (
                              <span className="badge mt-1" style={{ background: '#fee2e2', color: '#dc2626' }}>Prior rejection: {app.previousRejection.matchedBy.replace('_', ' + ')}</span>
                            )}
                          </td>
                          <td style={{ fontSize: 13 }}>{job?.title || '—'}</td>
                          <td style={{ fontSize: 12 }}>{app.qualification || '—'}</td>
                          <td style={{ fontSize: 12 }}>
                            {app.isFresher
                              ? <span style={{ color: '#10b981', fontWeight: 600 }}>Fresher</span>
                              : <span style={{ color: '#f59e0b', fontWeight: 600 }}>{app.experienceYears || 0} yr(s)</span>}
                          </td>
                          <td>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                              {(app.skills || []).slice(0, 3).map((s, i) => (
                                <span key={i} style={{ background: '#eff6ff', color: '#2563eb', fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 10 }}>{s}</span>
                              ))}
                              {(app.skills || []).length > 3 && <span style={{ fontSize: 10, color: '#94a3b8' }}>+{app.skills.length - 3}</span>}
                            </div>
                          </td>
                          <td style={{ fontSize: 12, color: '#64748b' }}>{formatDate(app.createdAt)}</td>
                          <td><span className="badge" style={{ background: STAGE_COLORS[app.stage] + '20', color: STAGE_COLORS[app.stage] }}>{app.stage}</span></td>
                          {isAdmin && (
                            <td>
                              <select className="form-select form-select-sm" style={{ fontSize: 11, width: 120 }} value={app.stage} onChange={e => { if (e.target.value !== app.stage) requestMoveStage(app, e.target.value); }}>
                                {STAGES.map(s => <option key={s}>{s}</option>)}
                              </select>
                            </td>
                          )}
                          {isAdmin && (
                            <td>
                              <button className="btn btn-xs btn-outline-secondary" style={{ padding:'2px 8px', fontSize:11, whiteSpace:'nowrap' }} onClick={() => openEditApp(app)}><i className="bi bi-pencil me-1" />Edit</button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'hired' && (
            <div className="card">
              <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 10 }}>
                <i className="bi bi-person-check" style={{ color: '#10b981', fontSize: 16 }} />
                <span style={{ fontWeight: 750, fontSize: 14.5 }}>Hired Candidates Waiting for Onboarding</span>
                <span style={{ marginLeft: 'auto', color: '#94a3b8', fontSize: 12 }}>{hiredPending.length} pending</span>
              </div>
              {hiredApplicants.length === 0 ? (
                <div className="empty-state"><i className="bi bi-person-check" /><h6>No hired candidates found</h6></div>
              ) : (
                <div className="table-responsive">
                  <table className="table mb-0">
                    <thead><tr><th>Candidate</th><th>Role</th><th>Referral</th><th>Experience</th><th>Action</th></tr></thead>
                    <tbody>
                      {hiredApplicants.map(app => {
                        const job = jobs.find(j => j._id === app.jobId || j._id === app.jobId?._id);
                        return (
                          <tr key={app._id}>
                            <td>
                              <div style={{ fontWeight: 700, fontSize: 13 }}>{app.name}</div>
                              <div style={{ color: '#94a3b8', fontSize: 11 }}>{app.email}</div>
                              {app.phone && <div style={{ color: '#94a3b8', fontSize: 11 }}>{app.phone}</div>}
                              {app.previousRejection?.matchedBy && <span className="badge mt-1" style={{ background: '#fee2e2', color: '#dc2626' }}>Prior rejection</span>}
                            </td>
                            <td style={{ fontSize: 13 }}>{job?.title || '—'}</td>
                            <td style={{ fontSize: 12 }}>{app.referralName || '—'}{app.referralFromOffice && <span className="badge ms-2" style={{ background: '#eff6ff', color: '#2563eb' }}>Office</span>}</td>
                            <td style={{ fontSize: 12 }}>{app.isFresher ? 'Fresher' : `${app.experienceYears || 0} yr(s)`}</td>
                            <td>
                              {app.onboardedAt ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8 }}>
                                  <i className="bi bi-check-circle-fill" style={{ color: '#16a34a', fontSize: 14 }} />
                                  <span style={{ fontSize: 12, fontWeight: 600, color: '#15803d' }}>Added to Organization</span>
                                </div>
                              ) : (
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                  <button className="btn btn-sm btn-primary" onClick={() => setConfirmAddModal(app)}><i className="bi bi-person-plus me-1" />Add to Organization</button>
                                  <button className="btn btn-sm btn-outline-danger" onClick={() => openReject(app)}><i className="bi bi-x-circle me-1" />Reject</button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {tab === 'rejected' && (
            <div className="card">
              <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 10 }}>
                <i className="bi bi-person-x" style={{ color: '#ef4444', fontSize: 16 }} />
                <span style={{ fontWeight: 750, fontSize: 14.5 }}>Rejected Applicants</span>
                <span style={{ marginLeft: 'auto', color: '#94a3b8', fontSize: 12 }}>{rejectedApplicants.length} stored</span>
              </div>
              {rejectedApplicants.length === 0 ? (
                <div className="empty-state"><i className="bi bi-person-x" /><h6>No rejected applicants stored</h6></div>
              ) : (
                <div className="table-responsive">
                  <table className="table mb-0">
                    <thead><tr><th>Applicant</th><th>Job</th><th>Experience</th><th>Rejected On</th><th>Reason</th>{isAdmin && <th>Reconsider</th>}</tr></thead>
                    <tbody>
                      {rejectedApplicants.map(app => {
                        const job = jobs.find(j => j._id === app.jobId || j._id === app.jobId?._id);
                        return (
                          <tr key={app._id}>
                            <td>
                              <div style={{ fontWeight: 700, fontSize: 13 }}>{app.name}</div>
                              <div style={{ color: '#94a3b8', fontSize: 11 }}>{app.email}</div>
                              {app.phone && <div style={{ color: '#94a3b8', fontSize: 11 }}>{app.phone}</div>}
                            </td>
                            <td style={{ fontSize: 13 }}>{job?.title || '—'}</td>
                            <td style={{ fontSize: 12 }}>{app.isFresher ? 'Fresher' : `${app.experienceYears || 0} yr(s)`}</td>
                            <td style={{ fontSize: 12, color: '#64748b' }}>{app.rejectedAt ? formatDate(app.rejectedAt) : formatDate(app.updatedAt)}</td>
                            <td style={{ minWidth: 220 }}>
                              <div style={{ fontSize: 12, color: '#334155', whiteSpace: 'normal' }}>{app.rejectionReason || 'No reason recorded'}</div>
                            </td>
                            {isAdmin && (
                              <td>
                                <select className="form-select form-select-sm" style={{ fontSize: 11, width: 135 }} value="Rejected" onChange={e => { if (e.target.value !== 'Rejected') setConfirmReconsiderModal({ id: app._id, stage: e.target.value, name: app.name }); }}>
                                  <option value="Rejected">Rejected</option>
                                  {STAGES.filter(s => s !== 'Rejected').map(s => <option key={s}>{s}</option>)}
                                </select>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Post Job Modal */}
      {showJobModal && (() => {
        const jf = jobForm;
        const je = jobErrors;
        const setJf = (k, v) => {
          setJobForm(p => ({ ...p, [k]: v }));
          if (je[k]) {
            setJobErrors(p => { const n={...p}; delete n[k]; return n; });
            if (jobErrorTimers[k]) { clearTimeout(jobErrorTimers[k]); delete jobErrorTimers[k]; }
          }
        };
        const Err = ({ f }) => je[f] ? <div style={{ color: '#ef4444', fontSize: 11, marginTop: 3 }}><i className="bi bi-exclamation-circle me-1" />{je[f]}</div> : null;
        const secStyle = { background: '#f8fafc', borderRadius: 10, padding: '14px 16px', marginBottom: 16 };
        const secTitle = { fontSize: 12, fontWeight: 700, color: '#3b82f6', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 };
        const addSQ = () => setJf('screeningQuestions', [...jf.screeningQuestions, { question:'', type:'text', options:[], required:false }]);
        const updateSQ = (i, k, v) => { const sq=[...jf.screeningQuestions]; sq[i]={...sq[i],[k]:v}; setJf('screeningQuestions',sq); };
        const removeSQ = (i) => setJf('screeningQuestions', jf.screeningQuestions.filter((_,idx)=>idx!==i));
        const addSQOption = (i) => { const sq=[...jf.screeningQuestions]; sq[i].options=[...(sq[i].options||[]),''];setJf('screeningQuestions',sq); };
        const updateSQOption = (qi,oi,v) => { const sq=[...jf.screeningQuestions]; sq[qi].options[oi]=v; setJf('screeningQuestions',sq); };
        const removeSQOption = (qi,oi) => { const sq=[...jf.screeningQuestions]; sq[qi].options=sq[qi].options.filter((_,i)=>i!==oi); setJf('screeningQuestions',sq); };
        return (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)', zIndex: 1050 }}>
          <div className="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header" style={{ borderBottom: '1px solid #e2e8f0' }}>
                <div>
                  <h5 className="modal-title mb-0">{editJobModal ? 'Edit Job' : 'Post Job'}</h5>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>Job Code will be auto-generated on save</div>
                </div>
                <button className="btn-close" onClick={() => { setShowJobModal(false); setEditJobModal(null); setJobErrors({}); setJobForm(EMPTY_JOB); }} />
              </div>
              <div className="modal-body" style={{ padding: '20px 24px' }}>

                {/* ① Basic Information */}
                <div style={secStyle}>
                  <div style={secTitle}>① Basic Information</div>
                  <div className="row g-3">
                    <div className="col-md-6">
                      <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Job Title *</label>
                      <input className={`form-control ${je.title ? 'is-invalid' : ''}`} placeholder="e.g. Senior React Developer" value={jf.title} onChange={e => setJf('title', e.target.value.replace(/[^A-Za-z\s]/g, '').slice(0, 30))} />
                      <Err f="title" />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Department *</label>
                      <select className={`form-select ${je.department ? 'is-invalid' : ''}`} value={jf.department} onChange={e => setJf('department', e.target.value)}>
                        <option value="">Select Department</option>
                        {departments.map(d => <option key={d}>{d}</option>)}
                      </select>
                      <Err f="department" />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Designation <span style={{ color:'#94a3b8',fontWeight:400 }}>(optional)</span></label>
                      <select className="form-select" value={jf.designation} onChange={e => setJf('designation', e.target.value)}>
                        <option value="">Select Designation</option>
                        {(jf.department
                          ? designations.filter(d => !d.department || d.department === jf.department)
                          : designations
                        ).map(d => <option key={d._id} value={d.name}>{d.name}{d.department ? ` (${d.department})` : ''}</option>)}
                        {jf.designation && !designations.find(d => d.name === jf.designation) && (
                          <option value={jf.designation}>{jf.designation}</option>
                        )}
                      </select>
                      {jf.department && designations.filter(d => !d.department || d.department === jf.department).length === 0 && (
                        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>No designations found for this department. <a href="/settings" target="_blank" style={{ color: '#3b82f6' }}>Add in Settings</a></div>
                      )}
                    </div>
                    <div className="col-md-6">
                      <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Job Type *</label>
                      <select className="form-select" value={jf.type} onChange={e => setJf('type', e.target.value)}>
                        {['Full-time','Part-time','Contract','Intern'].map(t => <option key={t}>{t}</option>)}
                      </select>
                    </div>
                    <div className="col-md-6">
                      <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Employment Mode *</label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {['Onsite','Hybrid','Remote'].map(m => (
                          <button key={m} type="button" onClick={() => setJf('employmentMode', m)}
                            style={{ flex: 1, padding: '7px 4px', borderRadius: 8, border: `1.5px solid ${jf.employmentMode===m?'#3b82f6':'#e2e8f0'}`, background: jf.employmentMode===m?'#eff6ff':'#fff', color: jf.employmentMode===m?'#2563eb':'#64748b', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                            {m}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="col-md-6">
                      <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Location {jf.employmentMode !== 'Remote' ? '*' : ''}</label>
                      <input className={`form-control ${je.location ? 'is-invalid' : ''}`} placeholder="e.g. Chennai, Mumbai" value={jf.location} onChange={e => setJf('location', e.target.value.replace(/[^A-Za-z\s]/g, '').slice(0, 25))} />
                      <Err f="location" />
                    </div>
                    <div className="col-md-4">
                      <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>No. of Openings *</label>
                      <input type="text" inputMode="numeric" className={`form-control ${je.openings ? 'is-invalid' : ''}`} style={{ maxWidth: 80 }} value={jf.openings} onChange={e => setJf('openings', e.target.value.replace(/\D/g, '').slice(0, 2))} />
                      <Err f="openings" />
                    </div>
                    <div className="col-md-4">
                      <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Job Status</label>
                      <select className="form-select" value={jf.status} onChange={e => setJf('status', e.target.value)}>
                        {['active','paused','closed'].map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
                      </select>
                    </div>
                    <div className="col-md-4">
                      <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Application Deadline *</label>
                      <DateInput className={`form-control ${je.applicationDeadline ? 'is-invalid' : ''}`} value={jf.applicationDeadline} min={new Date(Date.now() + 86400000).toISOString().split('T')[0]} onChange={e => setJf('applicationDeadline', e.target.value)} />
                      <Err f="applicationDeadline" />
                    </div>
                  </div>
                </div>

                {/* ② Job Requirements */}
                <div style={secStyle}>
                  <div style={secTitle}>② Job Requirements</div>
                  <div className="row g-3">
                    <div className="col-12">
                      <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Experience Level *</label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {['fresher','experienced'].map(el => (
                          <button key={el} type="button" onClick={() => setJf('experienceLevel', el)}
                            style={{ padding: '7px 24px', borderRadius: 8, border: `1.5px solid ${jf.experienceLevel===el?'#10b981':'#e2e8f0'}`, background: jf.experienceLevel===el?'#f0fdf4':'#fff', color: jf.experienceLevel===el?'#059669':'#64748b', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                            {el.charAt(0).toUpperCase()+el.slice(1)}
                          </button>
                        ))}
                      </div>
                    </div>
                    {jf.experienceLevel === 'experienced' && (
                      <>
                        <div className="col-md-6">
                          <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Min Experience (years) *</label>
                          <input type="text" inputMode="numeric" className={`form-control ${je.minExperience ? 'is-invalid' : ''}`} style={{ maxWidth: 80 }} placeholder="e.g. 2" value={jf.minExperience} onChange={e => setJf('minExperience', e.target.value.replace(/\D/g, '').slice(0, 1))} />
                          <Err f="minExperience" />
                        </div>
                        <div className="col-md-6">
                          <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Max Experience (years) *</label>
                          <input type="text" inputMode="numeric" className={`form-control ${je.maxExperience ? 'is-invalid' : ''}`} style={{ maxWidth: 80 }} placeholder="e.g. 6" value={jf.maxExperience} onChange={e => setJf('maxExperience', e.target.value.replace(/\D/g, '').slice(0, 1))} />
                          <Err f="maxExperience" />
                        </div>
                      </>
                    )}
                    <div className="col-12">
                      <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Qualifications * <span style={{ color:'#94a3b8', fontWeight:400 }}>(comma separated)</span></label>
                      <input className={`form-control ${je.qualifications ? 'is-invalid' : ''}`} value={jf.qualifications} onChange={e => setJf('qualifications', e.target.value)} placeholder="e.g. Diploma, UG, PG, PhD" />
                      <Err f="qualifications" />
                    </div>
                    <div className="col-12">
                      <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Required Skills <span style={{ color:'#94a3b8',fontWeight:400 }}>(comma separated)</span></label>
                      <input className="form-control" value={jf.requiredSkills} onChange={e => setJf('requiredSkills', e.target.value)} placeholder="e.g. React, Node.js" />
                    </div>
                    <div className="col-12">
                      <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Preferred Skills <span style={{ color:'#94a3b8',fontWeight:400 }}>(optional, comma separated)</span></label>
                      <input className="form-control" value={jf.preferredSkills} onChange={e => setJf('preferredSkills', e.target.value)} placeholder="e.g. AWS, Docker" />
                    </div>
                    <div className="col-12">
                      <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Job Description *</label>
                      <textarea className={`form-control ${je.description ? 'is-invalid' : ''}`} rows={5} placeholder="Describe the role, responsibilities, and expectations (min. 50 characters)" value={jf.description} onChange={e => setJf('description', e.target.value)} />
                      <div style={{ display:'flex', justifyContent:'space-between' }}>
                        <Err f="description" />
                        <span style={{ fontSize: 11, color: jf.description.length < 50 ? '#f59e0b' : '#10b981', marginLeft:'auto' }}>{jf.description.length}/5000</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ③ Compensation */}
                <div style={secStyle}>
                  <div style={secTitle}>③ Compensation & Benefits</div>
                  <div className="row g-3">
                    <div className="col-12">
                      <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Salary Type *</label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {[['not_disclosed','Not Disclosed'],['fixed','Fixed'],['range','Range']].map(([v,l]) => (
                          <button key={v} type="button" onClick={() => setJf('salaryType', v)}
                            style={{ flex:1, padding:'7px 4px', borderRadius:8, border:`1.5px solid ${jf.salaryType===v?'#8b5cf6':'#e2e8f0'}`, background:jf.salaryType===v?'#fdf4ff':'#fff', color:jf.salaryType===v?'#7c3aed':'#64748b', fontWeight:600, fontSize:12, cursor:'pointer' }}>
                            {l}
                          </button>
                        ))}
                      </div>
                    </div>
                    {jf.salaryType !== 'not_disclosed' && (
                      <>
                        <div className="col-md-3">
                          <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Currency</label>
                          <select className="form-select" value={jf.salaryCurrency} onChange={e => setJf('salaryCurrency', e.target.value)}>
                            {['INR','USD','EUR','GBP'].map(cur => <option key={cur}>{cur}</option>)}
                          </select>
                        </div>
                        <div className="col-md-3">
                          <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Period</label>
                          <select className="form-select" value={jf.salaryPeriod} onChange={e => setJf('salaryPeriod', e.target.value)}>
                            <option value="annual">Annual</option>
                            <option value="monthly">Monthly</option>
                          </select>
                        </div>
                        {jf.salaryType === 'fixed' && (
                          <div className="col-md-6">
                            <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Fixed Salary *</label>
                            <input type="text" inputMode="numeric" className={`form-control ${je.fixedSalary ? 'is-invalid' : ''}`} placeholder="e.g. 600000" value={jf.fixedSalary} onChange={e => setJf('fixedSalary', e.target.value.replace(/\D/g, '').slice(0, jf.salaryPeriod === 'monthly' ? 6 : 7))} />
                            <Err f="fixedSalary" />
                          </div>
                        )}
                        {jf.salaryType === 'range' && (
                          <>
                            <div className="col-md-3">
                              <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Min Salary *</label>
                              <input type="text" inputMode="numeric" className={`form-control ${je.minSalary ? 'is-invalid' : ''}`} placeholder="e.g. 600000" value={jf.minSalary} onChange={e => setJf('minSalary', e.target.value.replace(/\D/g, '').slice(0, jf.salaryPeriod === 'monthly' ? 6 : 7))} />
                              <Err f="minSalary" />
                            </div>
                            <div className="col-md-3">
                              <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Max Salary *</label>
                              <input type="text" inputMode="numeric" className={`form-control ${je.maxSalary ? 'is-invalid' : ''}`} placeholder="e.g. 1200000" value={jf.maxSalary} onChange={e => setJf('maxSalary', e.target.value.replace(/\D/g, '').slice(0, jf.salaryPeriod === 'monthly' ? 6 : 7))} />
                              <Err f="maxSalary" />
                            </div>
                          </>
                        )}
                      </>
                    )}
                    <div className="col-12">
                      <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Benefits</label>
                      <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                        {['Health Insurance','PF','Gratuity','Flexible Hours','Work from Home','Annual Bonus','Paid Leaves','Stock Options'].map(b => (
                          <label key={b} style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 10px', border:`1.5px solid ${jf.benefits.includes(b)?'#10b981':'#e2e8f0'}`, borderRadius:20, background:jf.benefits.includes(b)?'#f0fdf4':'#fff', cursor:'pointer', fontSize:12, fontWeight:600, color:jf.benefits.includes(b)?'#059669':'#64748b' }}>
                            <input type="checkbox" style={{ display:'none' }} checked={jf.benefits.includes(b)} onChange={e => setJf('benefits', e.target.checked ? [...jf.benefits,b] : jf.benefits.filter(x=>x!==b))} />
                            {b}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* ④ Recruitment Process */}
                <div style={secStyle}>
                  <div style={secTitle}>④ Recruitment Process</div>
                  <div className="row g-3">
                    <div className="col-md-6">
                      <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Hiring Manager *</label>
                      <select className={`form-select ${je.hiringManagerId ? 'is-invalid' : ''}`} value={jf.hiringManagerId} onChange={e => setJf('hiringManagerId', e.target.value)}>
                        <option value="">Select Hiring Manager</option>
                        {assignmentPeople.map(e => <option key={e._id} value={getUserId(e)}>{e.name} ({e.role})</option>)}
                      </select>
                      <Err f="hiringManagerId" />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Recruiter <span style={{ color:'#94a3b8',fontWeight:400 }}>(optional)</span></label>
                      <select className="form-select" value={jf.recruiterId} onChange={e => setJf('recruiterId', e.target.value)}>
                        <option value="">Assign Recruiter</option>
                        {assignmentPeople.map(e => <option key={e._id} value={getUserId(e)}>{e.name}</option>)}
                      </select>
                    </div>
                    <div className="col-md-6">
                      <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Interview Rounds</label>
                      <input type="text" inputMode="numeric" min="1" max="9" className="form-control" style={{ maxWidth: 80 }} value={jf.interviewRounds} onChange={e => setJf('interviewRounds', e.target.value.replace(/\D/g, '').slice(0, 1))} />
                    </div>
                    <div className="col-md-6" style={{ display:'flex', alignItems:'center' }}>
                      <label style={{ display:'flex', alignItems:'center', gap:10, marginTop:24, cursor:'pointer', fontSize:13, fontWeight:600, color:'#334155' }}>
                        <input type="checkbox" className="form-check-input" checked={jf.assessmentRequired} onChange={e => setJf('assessmentRequired', e.target.checked)} />
                        Assessment / Test Required
                      </label>
                    </div>
                  </div>
                </div>

                {/* ⑤ Screening Questions — visible when 'Assessment / Test Required' is checked */}
                {jf.assessmentRequired && (
                <div style={secStyle}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
                    <div style={secTitle}>⑤ Screening Questions</div>
                    <button type="button" className="btn btn-sm btn-outline-primary" onClick={addSQ} style={{ fontSize:12 }}><i className="bi bi-plus-lg me-1" />Add Question</button>
                  </div>
                  {jf.screeningQuestions.length === 0 && <div style={{ fontSize:12, color:'#94a3b8', textAlign:'center', padding:'10px 0' }}>No screening questions. Click "Add Question" to add.</div>}
                  {jf.screeningQuestions.map((sq,i) => (
                    <div key={i} style={{ border:'1px solid #e2e8f0', borderRadius:8, padding:12, marginBottom:10, background:'#fff' }}>
                      <div style={{ display:'flex', gap:8, marginBottom:8, alignItems:'flex-start' }}>
                        <div style={{ flex:1 }}>
                          <input className={`form-control ${je[`sq_${i}_question`] ? 'is-invalid' : ''}`} placeholder={`Question ${i+1}`} value={sq.question} onChange={e => updateSQ(i,'question',e.target.value)} style={{ fontSize:13 }} />
                          {je[`sq_${i}_question`] && <div style={{ color:'#ef4444', fontSize:11, marginTop:2 }}>{je[`sq_${i}_question`]}</div>}
                        </div>
                        <select className="form-select" value={sq.type} onChange={e => updateSQ(i,'type',e.target.value)} style={{ width:160, fontSize:12 }}>
                          <option value="text">Text Answer</option>
                          <option value="yes_no">Yes / No</option>
                          <option value="multiple_choice">Multiple Choice</option>
                        </select>
                        <label style={{ display:'flex', alignItems:'center', gap:4, fontSize:12, whiteSpace:'nowrap', cursor:'pointer', paddingTop:8 }}>
                          <input type="checkbox" checked={sq.required} onChange={e => updateSQ(i,'required',e.target.checked)} /> Required
                        </label>
                        <button onClick={()=>removeSQ(i)} style={{ background:'none', border:'none', color:'#ef4444', cursor:'pointer', padding:'4px 6px' }}><i className="bi bi-trash" /></button>
                      </div>
                      {sq.type === 'multiple_choice' && (
                        <div style={{ paddingLeft:8 }}>
                          {je[`sq_${i}_options`] && <div style={{ color:'#ef4444', fontSize:11, marginBottom:4 }}>{je[`sq_${i}_options`]}</div>}
                          {(sq.options||[]).map((opt,oi) => (
                            <div key={oi} style={{ display:'flex', gap:6, marginBottom:6 }}>
                              <input className="form-control form-control-sm" value={opt} onChange={e => updateSQOption(i,oi,e.target.value)} placeholder={`Option ${oi+1}`} style={{ fontSize:12 }} />
                              <button onClick={()=>removeSQOption(i,oi)} style={{ background:'none', border:'none', color:'#94a3b8', cursor:'pointer' }}><i className="bi bi-x" /></button>
                            </div>
                          ))}
                          <button type="button" onClick={()=>addSQOption(i)} style={{ fontSize:11, color:'#3b82f6', background:'none', border:'none', cursor:'pointer', padding:0 }}><i className="bi bi-plus-circle me-1" />Add Option</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                )}

                {/* ⑥ Publishing Settings */}
                <div style={{...secStyle, marginBottom:0}}>
                  <div style={secTitle}>⑥ Publishing Settings</div>
                  <div style={{ display:'flex', gap:24, flexWrap:'wrap' }}>
                    <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13, fontWeight:600, color:'#334155' }}>
                      <input type="checkbox" className="form-check-input" checked={jf.autoClose} onChange={e => setJf('autoClose', e.target.checked)} />
                      Auto-close when openings are filled
                    </label>
                  </div>
                </div>

              </div>
              <div className="modal-footer" style={{ borderTop:'1px solid #e2e8f0', justifyContent:'space-between' }}>
                <button className="btn btn-outline-secondary" onClick={() => { setShowJobModal(false); setJobErrors({}); setJobForm(EMPTY_JOB); setEditJobModal(null); }}>Cancel</button>
                <div style={{ display:'flex', gap:8 }}>
                  <button className="btn btn-success" onClick={() => editJobModal ? saveEditJob() : saveJob()} disabled={saving}>
                    {saving ? <><span className="spinner-border spinner-border-sm me-2" />Publishing...</> : <><i className="bi bi-send me-2" />{editJobModal ? 'Update & Publish' : 'Publish'}</>}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Add Applicant Modal */}
      {showAppModal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header"><h5 className="modal-title">Add Applicant</h5><button className="btn-close" onClick={() => { setShowAppModal(false); setAppErrors({}); }} /></div>
              <div className="modal-body">
                <div className="row g-3">
                  <div className="col-md-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Name *</label>
                    <input className={`form-control ${appErrors.name ? 'is-invalid' : ''}`} placeholder="Full name" value={appForm.name}
                      onChange={e => { let v = e.target.value.replace(/[^A-Za-z\s]/g, '').slice(0, 30); if (v.length > 0) v = v.charAt(0).toUpperCase() + v.slice(1); setAppField('name', v); }} />
                    <AppError field="name" />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Email *</label>
                    <input type="email" className={`form-control ${appErrors.email ? 'is-invalid' : ''}`} placeholder="email@example.com" value={appForm.email}
                      onChange={e => setAppField('email', e.target.value)} />
                    <AppError field="email" />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Phone *</label>
                    <input type="tel" className={`form-control ${appErrors.phone ? 'is-invalid' : ''}`} placeholder="10-digit number" maxLength={10} value={appForm.phone}
                      onChange={e => setAppField('phone', e.target.value.replace(/\D/g, '').slice(0, 10))} />
                    <AppError field="phone" />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Job *</label>
                    <select className={`form-select ${appErrors.jobId ? 'is-invalid' : ''}`} value={appForm.jobId} onChange={e => setAppField('jobId', e.target.value)}>
                      <option value="">Select job</option>
                      {jobs.map(j => <option key={j._id} value={j._id}>{j.title}</option>)}
                    </select>
                    <AppError field="jobId" />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Qualification *</label>
                    <input className={`form-control ${appErrors.qualification ? 'is-invalid' : ''}`} placeholder="e.g. B.Tech, MBA, BSc" value={appForm.qualification}
                      onChange={e => setAppField('qualification', e.target.value)} />
                    <AppError field="qualification" />
                  </div>
                  <div className="col-12">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Skills <span style={{ fontWeight: 400, color: '#94a3b8' }}>(optional, comma separated)</span></label>
                    <input className="form-control" placeholder="e.g. React, Node.js, AWS" value={appForm.skills}
                      onChange={e => setAppField('skills', e.target.value)} />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Referral Name <span style={{ fontWeight: 400, color: '#94a3b8' }}>(optional)</span></label>
                    {appForm.referralFromOffice ? (
                      <select className="form-select" value={appForm.referralEmployeeId} onChange={e => setAppField('referralEmployeeId', e.target.value)}>
                        <option value="">Select employee</option>
                        {employees.map(emp => <option key={emp._id} value={emp._id}>{emp.name}</option>)}
                      </select>
                    ) : (
                      <input className="form-control" placeholder="Referral name" value={appForm.referralName} onChange={e => setAppField('referralName', e.target.value)} />
                    )}
                  </div>
                  <div className="col-md-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Referral Source</label>
                    <label className="form-check" style={{ minHeight: 42, display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: 8, background: '#f8fafc' }}>
                      <input className="form-check-input m-0" type="checkbox" checked={appForm.referralFromOffice} onChange={e => {
                        setAppField('referralFromOffice', e.target.checked);
                        setAppForm(p => ({ ...p, referralFromOffice: e.target.checked, referralName: '', referralEmployeeId: '' }));
                      }} />
                      <span className="form-check-label" style={{ fontSize: 13, fontWeight: 600 }}>Referral from this office</span>
                    </label>
                  </div>
                  <div className="col-12">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Resume Document <span style={{ fontWeight: 400, color: '#94a3b8' }}>(frontend only)</span></label>
                    <input type="file" className="form-control" accept=".pdf,.doc,.docx" onChange={e => setAppField('resumeFileName', e.target.files?.[0]?.name || '')} />
                    {appForm.resumeFileName && <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}><i className="bi bi-paperclip me-1" />{appForm.resumeFileName}</div>}
                  </div>
                  <div className="col-md-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Fresher? *</label>
                    <select className="form-select" value={appForm.isFresher} onChange={e => {
                      setAppField('isFresher', e.target.value);
                      setAppForm(p => ({ ...p, isFresher: e.target.value, experienceYears: '' }));
                      setAppErrors(p => {
                        const next = { ...p };
                        delete next.experienceYears;
                        return next;
                      });
                    }}>
                      <option value="yes">Yes — Fresher</option>
                      <option value="no">No — Experienced</option>
                    </select>
                  </div>
                  {appForm.isFresher === 'no' && (
                    <div className="col-md-6">
                      <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Years of Experience *</label>
                      <input type="number" min="1" max="50" className={`form-control ${appErrors.experienceYears ? 'is-invalid' : ''}`} placeholder="e.g. 3"
                        value={appForm.experienceYears}
                        onChange={e => setAppField('experienceYears', e.target.value.replace(/[^0-9]/g, ''))} />
                      <AppError field="experienceYears" />
                    </div>
                  )}
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => { setShowAppModal(false); setAppErrors({}); }}>Cancel</button>
                <button className="btn btn-primary" onClick={saveApplicant} disabled={saving}>{saving ? <><span className="spinner-border spinner-border-sm me-2" />Saving...</> : 'Add Applicant'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Hired Modal */}
      {hiredModal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header border-0 pb-0"><button className="btn-close" onClick={() => setHiredModal(null)} /></div>
              <div className="modal-body text-center pt-0 pb-4 px-4">
                <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#10b98120', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                  <i className="bi bi-person-check-fill" style={{ color: '#10b981', fontSize: 26 }} />
                </div>
                <h5 style={{ fontWeight: 700 }}>🎉 Applicant Hired!</h5>
                <p style={{ color: '#64748b', fontSize: 13, marginBottom: 6 }}><strong>{hiredModal.name}</strong> has been marked as Hired.</p>
                <p style={{ color: '#64748b', fontSize: 13, marginBottom: 24 }}>Would you like to register them as an employee now?</p>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn btn-outline-secondary w-50" onClick={() => setHiredModal(null)}>Later</button>
                  <button className="btn btn-primary w-50" onClick={() => {
                    setConfirmAddModal(hiredModal);
                    setHiredModal(null);
                  }}>
                    <i className="bi bi-person-plus me-2" />Register Employee
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {rejectModal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Reject Hired Candidate</h5>
                <button className="btn-close" onClick={() => setRejectModal(null)} />
              </div>
              <div className="modal-body">
                <p style={{ color: '#64748b', fontSize: 13 }}>Reject <strong>{rejectModal.name}</strong> and keep the reason for future email or phone matches.</p>
                <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Reason *</label>
                <textarea className="form-control" rows={4} value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Why is this hired candidate being rejected?" />
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setRejectModal(null)}>Cancel</button>
                <button className="btn btn-danger" onClick={confirmReject} disabled={saving}>{saving ? <><span className="spinner-border spinner-border-sm me-2" />Rejecting...</> : 'Confirm Reject'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {priorRejectModal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Prior Rejection Found</h5>
                <button className="btn-close" onClick={() => setPriorRejectModal(null)} />
              </div>
              <div className="modal-body">
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: 12, border: '1px solid #fecaca', background: '#fef2f2', borderRadius: 8 }}>
                  <i className="bi bi-exclamation-triangle" style={{ color: '#dc2626', fontSize: 18 }} />
                  <div>
                    <div style={{ fontWeight: 700, color: '#991b1b', marginBottom: 4 }}>This applicant was applied and rejected earlier.</div>
                    <div style={{ fontSize: 12, color: '#7f1d1d' }}>
                      Matched by {priorRejectModal.previousRejection?.matchedBy?.replace('_', ' + ')}. Review the reason before moving them forward again.
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{priorRejectModal.name}</div>
                  <div style={{ color: '#64748b', fontSize: 12 }}>{priorRejectModal.email}{priorRejectModal.phone ? ` · ${priorRejectModal.phone}` : ''}</div>
                </div>
                <div style={{ marginTop: 12 }}>
                  <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Previous rejection reason</label>
                  <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, color: '#334155', fontSize: 13, background: '#f8fafc' }}>
                    {priorRejectModal.previousRejection?.reason || 'No reason recorded'}
                  </div>
                </div>
                <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 8 }}>
                  Rejected on {priorRejectModal.previousRejection?.rejectedAt ? formatDate(priorRejectModal.previousRejection.rejectedAt) : 'an earlier application'}.
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => { setPriorRejectModal(null); setTab('rejected'); }}>View Rejected Section</button>
                <button className="btn btn-primary" onClick={() => setPriorRejectModal(null)}>Continue</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Add to Organization Modal */}
      {confirmAddModal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Add to Organization</h5>
                <button className="btn-close" onClick={() => setConfirmAddModal(null)} />
              </div>
              <div className="modal-body">
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: 12, border: '1px solid #bfdbfe', background: '#eff6ff', borderRadius: 8, marginBottom: 16 }}>
                  <i className="bi bi-info-circle" style={{ color: '#2563eb', fontSize: 18 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, color: '#1e40af', marginBottom: 4 }}>You are about to add this candidate to the organization</div>
                    <div style={{ fontSize: 12, color: '#1e3a8a' }}>This will create an employee record and mark them as onboarded.</div>
                  </div>
                </div>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{confirmAddModal.name}</div>
                <div style={{ fontSize: 12, color: '#64748b' }}>{confirmAddModal.email}</div>
                {confirmAddModal.phone && <div style={{ fontSize: 12, color: '#64748b' }}>{confirmAddModal.phone}</div>}
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setConfirmAddModal(null)}>Cancel</button>
                <button className="btn btn-primary" onClick={confirmAddToOrganization}><i className="bi bi-check-lg me-2" />Confirm Add</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Reconsider Modal */}
      {confirmReconsiderModal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Reconsider Rejected Candidate</h5>
                <button className="btn-close" onClick={() => setConfirmReconsiderModal(null)} />
              </div>
              <div className="modal-body">
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: 12, border: '1px solid #fed7aa', background: '#fffbeb', borderRadius: 8, marginBottom: 16 }}>
                  <i className="bi bi-exclamation-triangle" style={{ color: '#d97706', fontSize: 18 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, color: '#92400e', marginBottom: 4 }}>Reconsider a rejected candidate</div>
                    <div style={{ fontSize: 12, color: '#78350f' }}>This will move <strong>{confirmReconsiderModal?.name}</strong> back to <strong>{confirmReconsiderModal?.stage}</strong> stage.</div>
                  </div>
                </div>
                <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>Are you sure you want to proceed?</p>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setConfirmReconsiderModal(null)}>Cancel</button>
                <button className="btn btn-primary" onClick={confirmReconsider} disabled={saving}>
                  {saving ? <><span className="spinner-border spinner-border-sm me-2" />Processing...</> : <><i className="bi bi-check-lg me-2" />Confirm</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Add Applicant Modal */}
      {pendingApplicant && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)', zIndex: 1060 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Confirm Add Applicant</h5>
                <button className="btn-close" onClick={() => setPendingApplicant(null)} />
              </div>
              <div className="modal-body">
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: 12, border: '1px solid #bfdbfe', background: '#eff6ff', borderRadius: 8, marginBottom: 16 }}>
                  <i className="bi bi-person-plus" style={{ color: '#2563eb', fontSize: 18 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, color: '#1e40af', marginBottom: 4 }}>Add this applicant to recruitment?</div>
                    <div style={{ fontSize: 12, color: '#1e3a8a' }}>They will be added to the pipeline at the Applied stage.</div>
                  </div>
                </div>
                <div style={{ fontSize: 13 }}><strong>{pendingApplicant.name}</strong></div>
                <div style={{ fontSize: 12, color: '#64748b' }}>{pendingApplicant.email} · {pendingApplicant.phone}</div>
                <div style={{ fontSize: 12, color: '#64748b' }}>Job: {pendingApplicant.jobTitle} · {pendingApplicant.qualification}</div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setPendingApplicant(null)}>Cancel</button>
                <button className="btn btn-primary" onClick={doSaveApplicant} disabled={saving}>
                  {saving ? <><span className="spinner-border spinner-border-sm me-2" />Adding...</> : <><i className="bi bi-check-lg me-2" />Confirm Add</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Move Stage Modal */}
      {confirmMoveModal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)', zIndex: 1060 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Move to {confirmMoveModal.stage}</h5>
                <button className="btn-close" onClick={() => setConfirmMoveModal(null)} />
              </div>
              <div className="modal-body">
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: 12, border: `1px solid ${STAGE_COLORS[confirmMoveModal.stage]}40`, background: STAGE_COLORS[confirmMoveModal.stage] + '10', borderRadius: 8, marginBottom: 16 }}>
                  <i className="bi bi-arrow-right-circle" style={{ color: STAGE_COLORS[confirmMoveModal.stage], fontSize: 18 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, color: '#1e293b', marginBottom: 4 }}>Move applicant to <strong style={{ color: STAGE_COLORS[confirmMoveModal.stage] }}>{confirmMoveModal.stage}</strong> stage?</div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>This action will update their recruitment stage immediately.</div>
                  </div>
                </div>
                <div style={{ fontSize: 13 }}><strong>{confirmMoveModal.app.name}</strong></div>
                <div style={{ fontSize: 12, color: '#64748b' }}>{confirmMoveModal.app.email}</div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setConfirmMoveModal(null)}>Cancel</button>
                <button className="btn btn-primary" onClick={confirmMove} disabled={saving}
                  style={{ background: STAGE_COLORS[confirmMoveModal.stage], borderColor: STAGE_COLORS[confirmMoveModal.stage] }}>
                  {saving ? <><span className="spinner-border spinner-border-sm me-2" />Moving...</> : <><i className="bi bi-check-lg me-2" />Confirm Move</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Applicant Modal */}
      {editAppModal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)', zIndex: 1060 }}>
          <div className="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Edit Applicant</h5>
                <button className="btn-close" onClick={() => setEditAppModal(null)} />
              </div>
              <div className="modal-body">
                {(() => {
                  const f = editAppForm;
                  const fe = editAppErrors;
                  const setF = (k, v) => { setEditAppForm(p => ({ ...p, [k]: v })); if (fe[k]) setEditAppErrors(p => { const n={...p}; delete n[k]; return n; }); };
                  const ErrA = ({ k }) => fe[k] ? <div style={{ color:'#ef4444', fontSize:11, marginTop:3 }}><i className="bi bi-exclamation-circle me-1" />{fe[k]}</div> : null;
                  return (
                    <div className="row g-3">
                      <div className="col-md-6">
                        <label className="form-label" style={{ fontSize:13, fontWeight:600 }}>Name *</label>
                        <input className={`form-control ${fe.name?'is-invalid':''}`} value={f.name} onChange={e => setF('name', e.target.value.replace(/[^A-Za-z\s]/g,''))} />
                        <ErrA k="name" />
                      </div>
                      <div className="col-md-6">
                        <label className="form-label" style={{ fontSize:13, fontWeight:600 }}>Email *</label>
                        <input type="email" className={`form-control ${fe.email?'is-invalid':''}`} value={f.email} onChange={e => setF('email', e.target.value)} />
                        <ErrA k="email" />
                      </div>
                      <div className="col-md-6">
                        <label className="form-label" style={{ fontSize:13, fontWeight:600 }}>Phone *</label>
                        <input type="tel" maxLength={10} className={`form-control ${fe.phone?'is-invalid':''}`} value={f.phone} onChange={e => setF('phone', e.target.value.replace(/\D/g,'').slice(0,10))} />
                        <ErrA k="phone" />
                      </div>
                      <div className="col-md-6">
                        <label className="form-label" style={{ fontSize:13, fontWeight:600 }}>Job *</label>
                        <select className={`form-select ${fe.jobId?'is-invalid':''}`} value={f.jobId} onChange={e => setF('jobId', e.target.value)}>
                          <option value="">Select job</option>
                          {jobs.map(j => <option key={j._id} value={j._id}>{j.title}</option>)}
                        </select>
                        <ErrA k="jobId" />
                      </div>
                      <div className="col-md-6">
                        <label className="form-label" style={{ fontSize:13, fontWeight:600 }}>Qualification *</label>
                        <input className={`form-control ${fe.qualification?'is-invalid':''}`} value={f.qualification} onChange={e => setF('qualification', e.target.value)} />
                        <ErrA k="qualification" />
                      </div>
                      <div className="col-md-6">
                        <label className="form-label" style={{ fontSize:13, fontWeight:600 }}>Skills <span style={{ color:'#94a3b8', fontWeight:400 }}>(comma separated)</span></label>
                        <input className="form-control" value={f.skills} onChange={e => setF('skills', e.target.value)} placeholder="e.g. React, Node.js" />
                      </div>
                      <div className="col-md-6">
                        <label className="form-label" style={{ fontSize:13, fontWeight:600 }}>Fresher?</label>
                        <select className="form-select" value={f.isFresher} onChange={e => setF('isFresher', e.target.value)}>
                          <option value="yes">Yes — Fresher</option>
                          <option value="no">No — Experienced</option>
                        </select>
                      </div>
                      {f.isFresher === 'no' && (
                        <div className="col-md-6">
                          <label className="form-label" style={{ fontSize:13, fontWeight:600 }}>Years of Experience *</label>
                          <input type="number" min="1" max="50" className={`form-control ${fe.experienceYears?'is-invalid':''}`} value={f.experienceYears} onChange={e => setF('experienceYears', e.target.value.replace(/[^0-9]/g,''))} />
                          <ErrA k="experienceYears" />
                        </div>
                      )}
                      <div className="col-md-6">
                        <label className="form-label" style={{ fontSize:13, fontWeight:600 }}>Referral Name <span style={{ color:'#94a3b8', fontWeight:400 }}>(optional)</span></label>
                        {f.referralFromOffice ? (
                          <select className="form-select" value={f.referralEmployeeId} onChange={e => setF('referralEmployeeId', e.target.value)}>
                            <option value="">Select employee</option>
                            {employees.map(emp => <option key={emp._id} value={emp._id}>{emp.name}</option>)}
                          </select>
                        ) : (
                          <input className="form-control" value={f.referralName} onChange={e => setF('referralName', e.target.value)} />
                        )}
                      </div>
                      <div className="col-md-6">
                        <label className="form-check" style={{ minHeight:42, display:'flex', alignItems:'center', gap:8, padding:'9px 12px', border:'1px solid #e2e8f0', borderRadius:8, background:'#f8fafc', marginTop:24, cursor:'pointer' }}>
                          <input className="form-check-input m-0" type="checkbox" checked={f.referralFromOffice} onChange={e => setF('referralFromOffice', e.target.checked)} />
                          <span style={{ fontSize:13, fontWeight:600 }}>Referral from this office</span>
                        </label>
                      </div>
                      {editAppModal?.screeningQuestions?.length > 0 && (
                        <div className="col-12">
                          <div style={{ background:'#fffbeb', border:'1px solid #fed7aa', borderRadius:8, padding:12 }}>
                            <div style={{ fontWeight:700, fontSize:12, color:'#92400e', marginBottom:8 }}><i className="bi bi-question-circle me-2" />Screening Questions from Job Posting</div>
                            {editAppModal.screeningQuestions.map((sq, i) => (
                              <div key={i} style={{ marginBottom:8, fontSize:13, color:'#334155' }}>
                                <strong>{i+1}. {sq.question}</strong> {sq.required && <span style={{ color:'#ef4444', fontSize:11 }}>*</span>}
                                <div style={{ fontSize:11, color:'#64748b' }}>Type: {sq.type.replace('_',' ')}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setEditAppModal(null)}>Cancel</button>
                <button className="btn btn-primary" onClick={saveEditApp} disabled={savingApp}>
                  {savingApp ? <><span className="spinner-border spinner-border-sm me-2" />Saving...</> : <><i className="bi bi-check-lg me-2" />Save Changes</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Delete Job Modal */}
      {confirmDeleteJobModal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)', zIndex: 1060 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Remove Job Posting</h5>
                <button className="btn-close" onClick={() => setConfirmDeleteJobModal(null)} />
              </div>
              <div className="modal-body">
                <div style={{ display:'flex', gap:12, alignItems:'flex-start', padding:12, border:'1px solid #fecaca', background:'#fef2f2', borderRadius:8, marginBottom:16 }}>
                  <i className="bi bi-exclamation-triangle-fill" style={{ color:'#dc2626', fontSize:18 }} />
                  <div>
                    <div style={{ fontWeight:700, color:'#991b1b', marginBottom:4 }}>This action cannot be undone</div>
                    <div style={{ fontSize:12, color:'#7f1d1d' }}>The job posting will be permanently deleted. Existing applicants linked to this job will not be deleted.</div>
                  </div>
                </div>
                <div style={{ fontSize:14, fontWeight:600 }}>{confirmDeleteJobModal.title}</div>
                <div style={{ fontSize:12, color:'#64748b', marginTop:2 }}>{[confirmDeleteJobModal.department, confirmDeleteJobModal.type, confirmDeleteJobModal.location].filter(Boolean).join(' · ')}</div>
                {confirmDeleteJobModal.jobCode && <div style={{ fontSize:11, color:'#94a3b8', marginTop:2 }}>{confirmDeleteJobModal.jobCode}</div>}
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setConfirmDeleteJobModal(null)}>Cancel</button>
                <button className="btn btn-danger" onClick={deleteJob} disabled={saving}>
                  {saving ? <><span className="spinner-border spinner-border-sm me-2" />Removing...</> : <><i className="bi bi-trash me-2" />Confirm Remove</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

