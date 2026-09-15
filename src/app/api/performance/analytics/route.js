import { connectDB } from '@/lib/db';
import { Review } from '@/lib/models/index';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

const MANAGERS = ['super_admin', 'admin_full', 'team_lead', 'team_admin'];

const avg = arr => (arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2) : null);

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();
    const { searchParams } = new URL(req.url);
    const cycle = searchParams.get('cycle') || '';
    const userId = searchParams.get('userId') || '';

    const targetId = userId || user._id.toString();
    const isSelf = targetId === user._id.toString();
    if (!isSelf && !MANAGERS.includes(user.role)) return fail('Access denied', 403);

    const query = { userId: targetId, status: { $in: ['completed', 'improvement_plan'] } };
    if (cycle) query.cycle = cycle;
    const reviews = await Review.find(query).select('cycle selfScore peerScore managerScore overall status peerReviews').lean();

    const byCycle = {};
    for (const r of reviews) {
      const c = r.cycle || 'unknown';
      byCycle[c] = byCycle[c] || { cycle: c, count: 0, self: [], peer: [], manager: [], overall: [] };
      byCycle[c].count++;
      if (r.selfScore != null) byCycle[c].self.push(r.selfScore);
      if (r.peerScore != null) byCycle[c].peer.push(r.peerScore);
      if (r.managerScore != null) byCycle[c].manager.push(r.managerScore);
      if (r.overall != null) byCycle[c].overall.push(r.overall);
    }
    const cycles = Object.values(byCycle).map(c => ({
      cycle: c.cycle,
      count: c.count,
      avgSelf: avg(c.self),
      avgPeer: avg(c.peer),
      avgManager: avg(c.manager),
      avgOverall: avg(c.overall),
    })).sort((a, b) => a.cycle.localeCompare(b.cycle));

    const all = {
      count: reviews.length,
      avgSelf: avg(reviews.map(r => r.selfScore).filter(v => v != null)),
      avgPeer: avg(reviews.map(r => r.peerScore).filter(v => v != null)),
      avgManager: avg(reviews.map(r => r.managerScore).filter(v => v != null)),
      avgOverall: avg(reviews.map(r => r.overall).filter(v => v != null)),
    };
    return ok({ userId: targetId, overall: all, cycles });
  } catch (e) {
    return fail(e.message, 500);
  }
}
