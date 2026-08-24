import { connectDB } from '@/lib/db';
import PayrollRule from '@/lib/models/PayrollRule';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { DEFAULT_RULE } from '@/lib/payroll-calculator';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin', 'admin_full'].includes(user.role)) return fail('Access denied', 403);
    await connectDB();

    let rules = await PayrollRule.find().sort({ isDefault: -1, createdAt: 1 });

    // Auto-seed default rule on first access
    if (rules.length === 0) {
      const seeded = await PayrollRule.create({
        name:       DEFAULT_RULE.name,
        isDefault:  true,
        earnings:   DEFAULT_RULE.earnings,
        deductions: DEFAULT_RULE.deductions,
        lopConfig:  DEFAULT_RULE.lopConfig,
      });
      rules = [seeded];
    }

    return ok(rules);
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin', 'admin_full'].includes(user.role)) return fail('Access denied', 403);
    await connectDB();

    const body = await req.json();
    if (!body.name) return fail('Rule name is required', 400);
    if (!body.earnings?.length) return fail('At least one earning component is required', 400);
    if (!body.earnings.some(e => e.code === 'BASIC')) return fail('A BASIC earning component is required', 400);

    // If setting as default, unset other defaults
    if (body.isDefault) {
      await PayrollRule.updateMany({ isDefault: true }, { $set: { isDefault: false } });
    }

    const isUpdate = Boolean(body._id && typeof body._id === 'string' && body._id.trim().length > 0);
    let rule;
    if (isUpdate) {
      rule = await PayrollRule.findByIdAndUpdate(body._id, {
        name:       body.name,
        isDefault:  body.isDefault || false,
        earnings:   body.earnings,
        deductions: body.deductions || [],
        lopConfig:  body.lopConfig || {},
      }, { new: true, runValidators: true });
      if (!rule) return fail('Rule not found', 404);
    } else {
      rule = await PayrollRule.create({
        name:       body.name,
        isDefault:  body.isDefault || false,
        earnings:   body.earnings,
        deductions: body.deductions || [],
        lopConfig:  body.lopConfig || {},
      });
    }

    // Ensure at least one default exists
    const defaultCount = await PayrollRule.countDocuments({ isDefault: true });
    if (defaultCount === 0) {
      await PayrollRule.findByIdAndUpdate(rule._id, { isDefault: true });
      rule.isDefault = true;
    }

    return ok(rule, isUpdate ? 200 : 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}
