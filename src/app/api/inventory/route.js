import { connectDB } from '@/lib/db';
import { Asset, AssetAssignment, Counter, Employee, Stock, StockMovement } from '@/lib/models/index';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

const ADMIN_ROLES = ['super_admin', 'admin_full'];
const RETURN_STATUSES = ['available', 'maintenance', 'repair', 'damaged', 'retired'];

const today = () => new Date().toISOString().slice(0, 10);

function requireInventoryAdmin(user) {
  return ADMIN_ROLES.includes(user.role) ? null : fail('Access denied', 403);
}

// Earlier inventory assignments received Employee document IDs from the picker,
// while Asset.assignedTo correctly references User. Convert those legacy records
// to their linked User IDs so population and history resolve correctly.
async function repairLegacyEmployeeReferences() {
  const assignedIds = await Asset.distinct('assignedTo', { assignedTo: { $ne: null } });
  if (!assignedIds.length) return;

  const employees = await Employee.find({ _id: { $in: assignedIds }, userId: { $ne: null } }).select('_id userId');
  if (!employees.length) return;

  await Promise.all(employees.map(({ _id, userId }) => Promise.all([
    Asset.updateMany({ assignedTo: _id }, { $set: { assignedTo: userId } }),
    AssetAssignment.updateMany({ employee: _id }, { $set: { employee: userId } }),
    StockMovement.updateMany({ employee: _id }, { $set: { employee: userId } }),
  ])));
}

async function nextAssetId() {
  const counter = await Counter.findByIdAndUpdate(
    'assetId',
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  return `AST-${String(counter.seq).padStart(6, '0')}`;
}

async function issueAsset({ stockId, employeeId, user, allowExisting = false }) {
  if (!stockId || !employeeId) throw new Error('Employee and stock item are required');

  if (!allowExisting) {
    const existing = await Asset.exists({ stockItem: stockId, assignedTo: employeeId, status: 'assigned' });
    if (existing) throw new Error('This employee already has this item assigned. Use Replace to record the return first.');
  }

  // Conditional decrement prevents issuing the last item twice during concurrent requests.
  const stock = await Stock.findOneAndUpdate(
    { _id: stockId, stock: { $gte: 1 } },
    { $inc: { stock: -1 } },
    { new: true },
  );
  if (!stock) throw new Error('This item is out of stock');

  try {
    const asset = await Asset.create({
      assetId: await nextAssetId(),
      name: stock.item,
      category: stock.category,
      stockItem: stock._id,
      assignedTo: employeeId,
      assignedOn: today(),
      status: 'assigned',
      condition: 'New',
      value: stock.unitPrice || 0,
    });
    await Promise.all([
      AssetAssignment.create({ asset: asset._id, employee: employeeId, action: 'assigned', assignedOn: today(), condition: 'New', status: 'assigned', performedBy: user._id }),
      StockMovement.create({ stockItem: stock._id, asset: asset._id, employee: employeeId, type: 'assigned', quantity: -1, balanceAfter: stock.stock, unitPrice: stock.unitPrice || 0, performedBy: user._id }),
    ]);
    return asset;
  } catch (error) {
    await Stock.findByIdAndUpdate(stockId, { $inc: { stock: 1 } });
    throw error;
  }
}

async function reassignAvailableAsset({ assetId, employeeId, user }) {
  if (!assetId || !employeeId) throw new Error('Asset and employee are required');
  const asset = await Asset.findOne({ _id: assetId, status: 'available' });
  if (!asset) throw new Error('Only an available asset can be assigned');
  if (!asset.stockItem) throw new Error('This legacy asset is not linked to a stock item and cannot be reassigned');

  const existing = await Asset.exists({ stockItem: asset.stockItem, assignedTo: employeeId, status: 'assigned' });
  if (existing) throw new Error('This employee already has this item assigned. Use Replace instead.');

  const stock = await Stock.findOneAndUpdate({ _id: asset.stockItem, stock: { $gte: 1 } }, { $inc: { stock: -1 } }, { new: true });
  if (!stock) throw new Error('This item is out of stock');

  const reassigned = await Asset.findByIdAndUpdate(asset._id, { assignedTo: employeeId, assignedOn: today(), status: 'assigned' }, { new: true });
  await Promise.all([
    AssetAssignment.create({ asset: asset._id, employee: employeeId, action: 'assigned', assignedOn: today(), condition: asset.condition, status: 'assigned', performedBy: user._id }),
    StockMovement.create({ stockItem: stock._id, asset: asset._id, employee: employeeId, type: 'assigned', quantity: -1, balanceAfter: stock.stock, unitPrice: asset.value || 0, note: 'Reassigned available asset', performedBy: user._id }),
  ]);
  return reassigned;
}

async function markAssetAvailable({ assetId, condition, user }) {
  const asset = await Asset.findOne({ _id: assetId, status: { $in: ['maintenance', 'repair'] } });
  if (!asset) throw new Error('Only an asset in maintenance or repair can be made available');
  if (!asset.stockItem) throw new Error('This legacy asset is not linked to a stock item');

  const stock = await Stock.findByIdAndUpdate(asset.stockItem, { $inc: { stock: 1 } }, { new: true });
  if (!stock) throw new Error('Linked stock item was not found');
  const availableAsset = await Asset.findByIdAndUpdate(asset._id, { status: 'available', condition: condition || 'Good' }, { new: true });
  const latestAssignment = await AssetAssignment.findOne({ asset: asset._id }).sort({ createdAt: -1 });
  const records = [StockMovement.create({ stockItem: stock._id, asset: asset._id, employee: latestAssignment?.employee || null, type: 'returned', quantity: 1, balanceAfter: stock.stock, unitPrice: asset.value || 0, note: 'Repair completed; asset returned to available stock', performedBy: user._id })];
  if (latestAssignment?.employee) records.push(AssetAssignment.create({ asset: asset._id, employee: latestAssignment.employee, action: 'repaired', returnedOn: today(), condition: condition || 'Good', status: 'available', performedBy: user._id }));
  await Promise.all(records);
  return availableAsset;
}

async function returnAsset({ assetId, returnReason, condition, status, user, replacement = false }) {
  if (!RETURN_STATUSES.includes(status)) throw new Error('Invalid return status');
  if (!returnReason?.trim()) throw new Error('A return reason is required');

  const asset = await Asset.findOne({ _id: assetId, status: 'assigned' });
  if (!asset) throw new Error('Only an assigned asset can be returned');

  const employeeId = asset.assignedTo;
  const returnedOn = today();
  const returnedAsset = await Asset.findByIdAndUpdate(asset._id, {
    assignedTo: null,
    returnedOn,
    returnReason: returnReason.trim(),
    condition,
    status,
  }, { new: true });

  const records = [
    AssetAssignment.create({
      asset: asset._id,
      employee: employeeId,
      action: replacement ? 'replaced' : 'returned',
      returnedOn,
      reason: returnReason.trim(),
      condition,
      status,
      performedBy: user._id,
    }),
  ];

  if (status === 'available' && asset.stockItem) {
    const stock = await Stock.findByIdAndUpdate(asset.stockItem, { $inc: { stock: 1 } }, { new: true });
    if (stock) {
      records.push(StockMovement.create({
        stockItem: stock._id,
        asset: asset._id,
        employee: employeeId,
        type: 'returned',
        quantity: 1,
        balanceAfter: stock.stock,
        unitPrice: asset.value || 0,
        note: returnReason.trim(),
        performedBy: user._id,
      }));
    }
  }
  await Promise.all(records);
  return returnedAsset;
}

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();
    await repairLegacyEmployeeReferences();

    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type');
    if (type === 'stock') {
      const stock = await Stock.find().sort({ item: 1 });
      return ok({ stock });
    }
    if (type === 'history') {
      const assetId = searchParams.get('assetId');
      if (!assetId) return fail('Asset ID is required');
      const [assignments, movements] = await Promise.all([
        AssetAssignment.find({ asset: assetId }).populate('employee', 'name').populate('performedBy', 'name').sort({ createdAt: -1 }),
        StockMovement.find({ asset: assetId }).populate('performedBy', 'name').sort({ createdAt: -1 }),
      ]);
      return ok({ assignments, movements });
    }

    const assets = await Asset.find()
      .populate('assignedTo', 'name avatar department')
      .populate('stockItem', 'item unit unitPrice')
      .sort({ createdAt: -1 });
    return ok({ assets });
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    const adminError = requireInventoryAdmin(user);
    if (adminError) return adminError;
    await connectDB();
    await repairLegacyEmployeeReferences();
    const body = await req.json();

    if (body.action === 'assign') return ok({ asset: await issueAsset({ stockId: body.stockId, employeeId: body.employeeId, user }) }, 201);
    if (body.type !== 'stock') return fail('Unsupported inventory action');

    const item = body.item?.trim();
    const quantity = Number(body.stock);
    const unitPrice = Number(body.unitPrice);
    if (!item || !Number.isInteger(quantity) || quantity < 1) return fail('Item name and a whole-number quantity are required');
    if (!Number.isFinite(unitPrice) || unitPrice < 0) return fail('A valid unit price is required');

    const category = body.category?.trim() || '';
    const stock = await Stock.findOneAndUpdate(
      { item, category },
      { $inc: { stock: quantity }, $set: { reorderAt: Number(body.reorderAt) || 5, unit: 'PCS', unitPrice } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    await StockMovement.create({ stockItem: stock._id, type: 'stock_added', quantity, balanceAfter: stock.stock, unitPrice, note: body.note?.trim() || '', performedBy: user._id });
    return ok({ stock }, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function PUT(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    const adminError = requireInventoryAdmin(user);
    if (adminError) return adminError;
    await connectDB();
    await repairLegacyEmployeeReferences();
    const body = await req.json();

    if (body.action === 'return') {
      return ok({ asset: await returnAsset({ assetId: body.assetId, returnReason: body.returnReason, condition: body.condition, status: body.status, user }) });
    }
    if (body.action === 'reassign') {
      return ok({ asset: await reassignAvailableAsset({ assetId: body.assetId, employeeId: body.employeeId, user }) });
    }
    if (body.action === 'make_available') {
      return ok({ asset: await markAssetAvailable({ assetId: body.assetId, condition: body.condition, user }) });
    }
    if (body.action === 'replace') {
      const oldAsset = await Asset.findOne({ _id: body.oldAssetId, status: 'assigned' });
      if (!oldAsset) return fail('The asset to replace is not currently assigned');
      const newAsset = await issueAsset({ stockId: body.stockId, employeeId: oldAsset.assignedTo, user, allowExisting: true });
      await returnAsset({ assetId: oldAsset._id, returnReason: body.returnReason, condition: body.condition, status: body.status, user, replacement: true });
      return ok({ oldAssetId: oldAsset._id, newAsset });
    }

    if (!body.id || !body.condition) return fail('Asset ID and condition are required');
    const asset = await Asset.findByIdAndUpdate(body.id, { condition: body.condition }, { new: true });
    return ok({ asset });
  } catch (e) {
    return fail(e.message, 500);
  }
}
