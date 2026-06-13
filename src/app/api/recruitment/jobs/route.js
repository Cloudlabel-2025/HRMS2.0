import dbConnect from '@/lib/db';
import { Employee, JobPosting } from '@/lib/models/index';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

const RECRUITMENT_ROLES = ['super_admin', 'admin_full', 'recruiter'];

async function generateJobCode() {
  const year = new Date().getFullYear();
  const prefix = `JOB-${year}-`;
  const last = await JobPosting.findOne({ jobCode: { $regex: `^${prefix}` } }).sort({ jobCode: -1 });
  if (!last || !last.jobCode) return `${prefix}0001`;
  const seq = parseInt(last.jobCode.replace(prefix, ''), 10) || 0;
  return `${prefix}${String(seq + 1).padStart(4, '0')}`;
}

async function resolveUserId(id) {
  if (!id) return null;
  const employee = await Employee.findById(id).select('userId').catch(() => null);
  return employee?.userId || id;
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) return value.map(v => String(v || '').trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map(v => v.trim()).filter(Boolean);
  return [];
}

function normalizeScreeningQuestions(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map(q => ({
      question: String(q?.question || '').trim(),
      type: ['text', 'yes_no', 'multiple_choice'].includes(q?.type) ? q.type : 'text',
      options: normalizeStringArray(q?.options),
      required: !!q?.required,
    }))
    .filter(q => q.question);
}

async function buildJobPayload(body, userId, jobCode = null) {
  const hiringManagerId = await resolveUserId(body.hiringManagerId);
  const recruiterId = await resolveUserId(body.recruiterId);

  let salaryRange = '';
  if (body.salaryType === 'fixed') {
    salaryRange = `${body.salaryCurrency || 'INR'} ${Number(body.fixedSalary).toLocaleString()}`;
  } else if (body.salaryType === 'range') {
    salaryRange = `${body.salaryCurrency || 'INR'} ${Number(body.minSalary).toLocaleString()} - ${Number(body.maxSalary).toLocaleString()}`;
  } else {
    salaryRange = 'Not Disclosed';
  }

  return {
    ...(jobCode ? { jobCode, createdBy: userId } : { updatedBy: userId }),
    title: String(body.title || '').trim(),
    department: body.department || '',
    designation: body.designation || '',
    type: body.type || 'Full-time',
    employmentMode: body.employmentMode || 'Onsite',
    location: body.location || '',
    openings: Number(body.openings) || 1,
    status: body.status || 'active',
    experienceLevel: body.experienceLevel || 'fresher',
    minExperience: body.experienceLevel === 'experienced' ? Number(body.minExperience) : null,
    maxExperience: body.experienceLevel === 'experienced' ? Number(body.maxExperience) : null,
    qualifications: normalizeStringArray(body.qualifications),
    requiredSkills: normalizeStringArray(body.requiredSkills),
    preferredSkills: normalizeStringArray(body.preferredSkills),
    description: body.description || '',
    salaryType: body.salaryType || 'not_disclosed',
    fixedSalary: body.salaryType === 'fixed' ? Number(body.fixedSalary) : null,
    minSalary: body.salaryType === 'range' ? Number(body.minSalary) : null,
    maxSalary: body.salaryType === 'range' ? Number(body.maxSalary) : null,
    salaryCurrency: body.salaryCurrency || 'INR',
    salaryPeriod: body.salaryPeriod || 'annual',
    benefits: normalizeStringArray(body.benefits),
    salaryRange,
    hiringManagerId,
    recruiterId,
    applicationDeadline: body.applicationDeadline ? new Date(body.applicationDeadline) : null,
    interviewRounds: Number(body.interviewRounds) || 1,
    assessmentRequired: !!body.assessmentRequired,
    screeningQuestions: normalizeScreeningQuestions(body.screeningQuestions),
    isInternal: !!body.isInternal,
    autoClose: !!body.autoClose,
    publishedAt: (body.status || 'active') === 'active' ? new Date() : null,
  };
}

function validateJob(body, isDraft = false) {
  const errors = {};
  if (!body.title?.trim()) errors.title = 'Job title is required';
  else if (body.title.trim().length < 3) errors.title = 'Title must be at least 3 characters';
  else if (body.title.trim().length > 100) errors.title = 'Title must be under 100 characters';

  if (!isDraft) {
    if (!body.department) errors.department = 'Department is required';
    if (!body.type) errors.type = 'Job type is required';
    if (!body.employmentMode) errors.employmentMode = 'Employment mode is required';
    if (body.employmentMode !== 'Remote' && !body.location?.trim()) errors.location = 'Location is required for non-remote jobs';
    if (!body.description?.trim()) errors.description = 'Job description is required';
    else if (body.description.trim().length < 50) errors.description = 'Description must be at least 50 characters';
    if (!body.hiringManagerId) errors.hiringManagerId = 'Hiring manager is required to publish';

    if (body.experienceLevel === 'experienced') {
      if (body.minExperience === '' || body.minExperience === null || body.minExperience === undefined)
        errors.minExperience = 'Minimum experience is required';
      if (body.maxExperience === '' || body.maxExperience === null || body.maxExperience === undefined)
        errors.maxExperience = 'Maximum experience is required';
      if (Number(body.maxExperience) < Number(body.minExperience))
        errors.maxExperience = 'Max experience must be greater than min experience';
    }

    if (body.salaryType === 'fixed') {
      if (!body.fixedSalary || Number(body.fixedSalary) < 1) errors.fixedSalary = 'Fixed salary is required';
    }
    if (body.salaryType === 'range') {
      if (!body.minSalary || Number(body.minSalary) < 1) errors.minSalary = 'Minimum salary is required';
      if (!body.maxSalary || Number(body.maxSalary) < 1) errors.maxSalary = 'Maximum salary is required';
      if (Number(body.maxSalary) <= Number(body.minSalary)) errors.maxSalary = 'Max salary must be greater than min salary';
    }

    if (body.applicationDeadline && new Date(body.applicationDeadline) < new Date())
      errors.applicationDeadline = 'Deadline must be a future date';

    if (body.screeningQuestions?.length) {
      body.screeningQuestions.forEach((q, i) => {
        if (!q.question?.trim()) errors[`sq_${i}_question`] = `Question ${i + 1} text is required`;
        if (q.type === 'multiple_choice' && normalizeStringArray(q.options).length < 2)
          errors[`sq_${i}_options`] = `Question ${i + 1} needs at least 2 options`;
      });
    }
  }

  return errors;
}

export async function GET(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;
  if (!RECRUITMENT_ROLES.includes(user.role)) return fail('Access denied', 403);
  await dbConnect();
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');
  const filter = status ? { status } : {};
  if (user.role === 'recruiter') {
    filter.$or = [
      { recruiterId: user._id },
      { hiringManagerId: user._id },
      { createdBy: user._id },
    ];
  }
  const jobs = await JobPosting.find(filter).sort({ createdAt: -1 });
  return ok(jobs);
}

export async function POST(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;
  if (!RECRUITMENT_ROLES.includes(user.role)) return fail('Access denied', 403);
  await dbConnect();
  const ip = req.headers.get('x-forwarded-for') || '';
  const body = await req.json();

  const errors = validateJob(body, false);
  if (Object.keys(errors).length) return fail({ errors }, 422);

  const jobCode = await generateJobCode();
  const job = await JobPosting.create(await buildJobPayload(body, user._id, jobCode));

  auditLog('Job Posted', 'Recruitment', user._id,
    `Published: "${job.title}" [${jobCode}]`,
    'low', ip, null, user._id);

  return ok(job, 201);
}

export async function PUT(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;
  if (!RECRUITMENT_ROLES.includes(user.role)) return fail('Access denied', 403);
  await dbConnect();
  const ip = req.headers.get('x-forwarded-for') || '';
  const body = await req.json();
  if (!body.id) return fail('Job id is required', 400);

  const errors = validateJob(body, false);
  if (Object.keys(errors).length) return fail({ errors }, 422);

  const job = await JobPosting.findByIdAndUpdate(
    body.id,
    await buildJobPayload(body, user._id),
    { new: true, runValidators: true }
  );
  if (!job) return fail('Job not found', 404);

  auditLog('Job Updated', 'Recruitment', user._id, 'Updated job: "' + job.title + '" [' + job.jobCode + ']', 'low', ip, null, user._id);
  return ok(job);
}

export async function DELETE(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;
  if (!['super_admin', 'admin_full'].includes(user.role)) return fail('Access denied', 403);
  await dbConnect();
  const ip = req.headers.get('x-forwarded-for') || '';
  const { id } = await req.json();
  if (!id) return fail('Job id is required', 400);
  const job = await JobPosting.findByIdAndDelete(id);
  if (!job) return fail('Job not found', 404);
  auditLog('Job Deleted', 'Recruitment', user._id, 'Deleted job: "' + job.title + '" [' + (job.jobCode || '') + ']', 'medium', ip, null, user._id);
  return ok({ deleted: true });
}
