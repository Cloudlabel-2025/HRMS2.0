import mongoose from 'mongoose';
import {
  LIFECYCLE_ENTITY_TYPES,
  LIFECYCLE_EVENT_TYPES,
} from '@/lib/core/constants';

const LifecycleChangeSchema = new mongoose.Schema({
  field:     { type: String, required: true, trim: true },
  from:      { type: mongoose.Schema.Types.Mixed, default: null },
  to:        { type: mongoose.Schema.Types.Mixed, default: null },
  sensitive: { type: Boolean, default: false },
}, { _id: false });

const EmpLifecycleHistorySchema = new mongoose.Schema({
  entityType:       { type: String, enum: LIFECYCLE_ENTITY_TYPES, required: true, index: true },
  entityId:         { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  identityId:       { type: mongoose.Schema.Types.ObjectId, ref: 'UsrIdentity', default: null, index: true },
  profileId:        { type: mongoose.Schema.Types.ObjectId, ref: 'EmpProfile', default: null, index: true },

  eventType:        { type: String, enum: LIFECYCLE_EVENT_TYPES, required: true, index: true },
  action:           { type: String, required: true, trim: true },
  fromState:        { type: String, default: '' },
  toState:          { type: String, default: '' },
  changes:          { type: [LifecycleChangeSchema], default: [] },
  reason:           { type: String, default: '' },
  metadata:         { type: mongoose.Schema.Types.Mixed, default: {} },

  actorUserId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  actorRole:        { type: String, default: '' },
  ip:               { type: String, default: '' },
  userAgent:        { type: String, default: '' },
  requestId:        { type: String, default: '' },
  isSystemGenerated:{ type: Boolean, default: false },
}, { timestamps: true, minimize: false, collection: 'emp_lifecycle_histories' });

EmpLifecycleHistorySchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
EmpLifecycleHistorySchema.index({ identityId: 1, createdAt: -1 });
EmpLifecycleHistorySchema.index({ profileId: 1, createdAt: -1 });

export default mongoose.models.EmpLifecycleHistory || mongoose.model('EmpLifecycleHistory', EmpLifecycleHistorySchema, 'emp_lifecycle_histories');