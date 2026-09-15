import { connectDB } from '@/lib/db';
import { Notification, Review } from '@/lib/models/index';
import PerformanceInvite from '@/lib/models/PerformanceInvite';
import { Project } from '@/lib/models/Task';
import User from '@/lib/models/User';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { z } from 'zod';

const MANAGERS = ['super_admin', 'admin_full', 'team_lead', 'team_admin'];
const MAX_PEERS = 3;

const InviteSchema = z.object({
  reviewId: z.string().min(1),
  peerIds: z.array(z.string().min(1)).min(1).max(MAX_PEERS),
}).strict();

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();
    const { searchParams } = new URL(req.url);
    const reviewId = searchParams.get('reviewId');
    const query = {};
    if (reviewId) query.reviewId = reviewId;
    else if (!MANAGERS.includes(user.role)) {
      query.$or = [{ peerId: user._id }, { revieweeId: user._id }];
    }
    const invites = await PerformanceInvite.find(query)
      .populate('peerId', 'name avatar department')
      .populate('revieweeId', 'name avatar department')
      .populate('invitedBy', 'name')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    return ok({ invites });
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!MANAGERS.includes(user.role)) return fail('Only managers can invite peers', 403);
    await connectDB();
    const body = await req.json();
    const parsed = InviteSchema.safeParse(body);
    if (!parsed.success) return fail('Validation failed: ' + parsed.error.issues.map(i => i.message).join(', '), 400);
    const { reviewId, peerIds } = parsed.data;

    const review = await Review.findById(reviewId).populate('projectId', 'name team');
    if (!review) return fail('Review not found', 404);
    if (!['pending', 'in_review'].includes(review.status)) return fail('Review is already finalized', 400);
    const isManager = review.managerBy?.toString() === user._id.toString() || ['super_admin', 'admin_full'].includes(user.role);
    if (!isManager) return fail('Only the review manager can invite peers', 403);

    const teamIds = (review.projectId?.team || []).map(m => m.toString());
    const revieweeId = review.userId.toString();
    const uniquePeerIds = [...new Set(peerIds.map(String))];
    for (const pid of uniquePeerIds) {
      if (pid === revieweeId) return fail('Reviewee cannot be their own peer', 400);
      if (!teamIds.includes(pid)) return fail('Peers must be members of the review project team', 400);
      const peerUser = await User.findById(pid).select('status').lean();
      if (!peerUser || peerUser.status !== 'active') return fail('Peer must be an active user', 400);
      if ((review.peerReviews || []).some(p => p.userId.toString() === pid)) {
        return fail('A selected peer has already submitted feedback', 409);
      }
    }
    const existingCount = await PerformanceInvite.countDocuments({ reviewId, status: 'pending' });
    if (existingCount + uniquePeerIds.length > MAX_PEERS) {
      return fail(`Max ${MAX_PEERS} pending peer invites per review`, 400);
    }

    const docs = [];
    for (const pid of uniquePeerIds) {
      try {
        const doc = await PerformanceInvite.create({
          reviewId, revieweeId, peerId: pid, invitedBy: user._id, cycle: review.cycle, status: 'pending',
        });
        docs.push(doc);
      } catch (e) {
        if (e.code === 11000) continue;
        throw e;
      }
    }
    if (docs.length) {
      await Notification.insertMany(docs.map(d => ({
        userId: d.peerId,
        title: 'Peer review invited',
        message: `You were invited to submit peer feedback for review cycle ${review.cycle}.`,
        type: 'performance',
        refId: review._id,
      })));
    }
    await auditLog('Peer Review Invited', 'Performance', user._id, `Invited ${docs.length} peer(s) for review ${reviewId} (cycle ${review.cycle})`, 'low', req.headers.get('x-forwarded-for') || '', null, review.userId);
    return ok({ invites: docs }, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function DELETE(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!MANAGERS.includes(user.role)) return fail('Only managers can revoke invites', 403);
    await connectDB();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return fail('Invite id required', 400);
    const invite = await PerformanceInvite.findById(id);
    if (!invite) return fail('Invite not found', 404);
    if (invite.status !== 'pending') return fail('Only pending invites can be revoked', 400);
    await invite.deleteOne();
    await auditLog('Peer Invite Revoked', 'Performance', user._id, `Revoked peer invite ${id}`, 'low', req.headers.get('x-forwarded-for') || '', null, invite.revieweeId);
    return ok({ deleted: true });
  } catch (e) {
    return fail(e.message, 500);
  }
}
