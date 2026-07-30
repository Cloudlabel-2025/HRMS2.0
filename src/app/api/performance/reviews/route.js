import { connectDB } from '@/lib/db';
import { Notification, Review } from '@/lib/models/index';
import { Project } from '@/lib/models/Task';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

const MANAGERS = ['super_admin', 'admin_full', 'team_lead', 'team_admin'];
const validScore = value => Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 5;

async function reviewForUser(id, user) {
  const review = await Review.findById(id).populate('projectId', 'name team').populate('userId', 'name avatar department').populate('managerBy', 'name');
  if (!review) throw new Error('Review not found');
  const targetId = review.userId._id.toString();
  const teamIds = (review.projectId?.team || []).map(member => member.toString());
  const isManager = review.managerBy?._id?.toString() === user._id.toString() || ['super_admin', 'admin_full'].includes(user.role);
  const isTarget = targetId === user._id.toString();
  const isPeer = teamIds.includes(user._id.toString()) && !isTarget;
  if (!isManager && !isTarget && !isPeer) throw new Error('Access denied');
  return { review, isManager, isTarget, isPeer, teamIds };
}

function decorate(review, user) {
  const result = review.toObject();
  const targetId = result.userId?._id?.toString();
  const teamIds = (result.projectId?.team || []).map(member => member.toString());
  const peerReviews = result.peerReviews || [];
  const isManager = result.managerBy?._id?.toString() === user._id.toString() || ['super_admin', 'admin_full'].includes(user.role);
  result.canSubmitSelf = targetId === user._id.toString() && result.selfScore == null;
  result.canSubmitPeer = teamIds.includes(user._id.toString()) && targetId !== user._id.toString() && !peerReviews.some(peer => peer.userId?.toString() === user._id.toString());
  result.canComplete = isManager && result.status === 'in_review';
  result.eligiblePeerCount = teamIds.filter(id => id !== targetId).length;
  result.peerSubmissionCount = peerReviews.length;
  // Scores and comments remain private until the manager has finalised the
  // review. This prevents partial feedback from influencing other reviewers.
  if (!['completed', 'improvement_plan'].includes(result.status)) {
    result.selfScore = null;
    result.selfComment = '';
    result.peerScore = null;
    result.peerComment = '';
    result.peerReviews = [];
    result.managerScore = null;
    result.managerComment = '';
    result.overall = null;
  }
  return result;
}

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req); if (error) return error;
    await connectDB();
    const projectIds = await Project.find({ team: user._id }).distinct('_id');
    const query = ['super_admin', 'admin_full'].includes(user.role) ? {} : { $or: [{ userId: user._id }, { managerBy: user._id }, { projectId: { $in: projectIds } }] };
    const reviews = await Review.find(query).populate('userId', 'name avatar department').populate('managerBy', 'name').populate('projectId', 'name team').populate('taskId', 'title').sort({ createdAt: -1 });
    return ok({ reviews: reviews.map(review => decorate(review, user)) });
  } catch (e) { return fail(e.message, 500); }
}

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req); if (error) return error;
    if (!MANAGERS.includes(user.role)) return fail('Only managers can create reviews', 403);
    await connectDB(); const body = await req.json();
    if (!body.userId || !body.projectId || !body.cycle) return fail('Employee, project, and cycle are required');
    const project = await Project.findById(body.projectId).select('name team');
    if (!project || !project.team.some(member => member.toString() === body.userId)) return fail('The employee must be a member of the selected project');
    const exists = await Review.exists({ userId: body.userId, projectId: body.projectId, cycle: body.cycle, status: { $in: ['pending', 'in_review'] } });
    if (exists) return fail('An active review already exists for this employee, project, and cycle');
    const review = await Review.create({ userId: body.userId, projectId: body.projectId, taskId: body.taskId || null, cycle: body.cycle, managerBy: user._id, status: 'in_review' });
    const recipients = [...new Set(project.team.map(member => member.toString()))];
    await Notification.insertMany(recipients.map(userId => ({ userId, title: 'Performance review requested', message: `Submit your review feedback for ${project.name}.`, type: 'performance', refId: review._id })));
    await auditLog('Performance Review Created', 'Performance', user._id, `Created project review for ${project.name}`, 'low', req.headers.get('x-forwarded-for') || '', null, body.userId);
    return ok({ review }, 201);
  } catch (e) { return fail(e.message, 500); }
}

export async function PUT(req) {
  try {
    const { user, error } = await requireAuth(req); if (error) return error;
    await connectDB(); const body = await req.json();
    const { review, isManager, isTarget, isPeer, teamIds } = await reviewForUser(body.id, user);
    if (!validScore(body.score)) return fail('Score must be between 0 and 5');
    if (body.action === 'self') {
      if (!isTarget || review.selfScore != null) return fail('Self score is not available', 403);
      review.selfScore = Number(body.score); review.selfComment = body.comment?.trim() || '';
    } else if (body.action === 'peer') {
      if (!isPeer || review.peerReviews.some(peer => peer.userId.toString() === user._id.toString())) return fail('Peer score is not available', 403);
      review.peerReviews.push({ userId: user._id, score: Number(body.score), comment: body.comment?.trim() || '' });
      review.peerScore = +(review.peerReviews.reduce((sum, peer) => sum + peer.score, 0) / review.peerReviews.length).toFixed(2);
    } else if (body.action === 'manager') {
      const requiredPeers = teamIds.filter(id => id !== review.userId._id.toString()).length;
      if (!isManager || review.selfScore == null || review.peerReviews.length < requiredPeers) return fail('Self and all peer scores must be submitted before manager completion', 400);
      review.managerScore = Number(body.score); review.managerComment = body.comment?.trim() || ''; review.status = body.status === 'improvement_plan' ? 'improvement_plan' : 'completed';
      review.overall = +((review.selfScore + review.peerScore + review.managerScore) / 3).toFixed(2);
    } else return fail('Invalid review action');
    await review.save();
    return ok({ review });
  } catch (e) { return fail(e.message === 'Access denied' ? e.message : e.message, e.message === 'Access denied' ? 403 : 500); }
}
