import mongoose from 'mongoose';
import { SELF_SERVICE_REQUEST_STATUSES, SELF_SERVICE_REQUEST_TYPES } from '@/lib/core/constants';

const SelfServiceRequestSchema = new mongoose.Schema({
  identityId:    { type: mongoose.Schema.Types.ObjectId, ref: 'UsrIdentity', required: true, index: true },
  profileId:     { type: mongoose.Schema.Types.ObjectId, ref: 'EmpProfile', required: true, index: true },
  requestType:   { type: String, enum: SELF_SERVICE_REQUEST_TYPES, required: true, index: true },
  payload:       { type: mongoose.Schema.Types.Mixed, required: true },
  reason:        { type: String, required: true },
  status:        { type: String, enum: SELF_SERVICE_REQUEST_STATUSES, default: 'pending', index: true },
  reviewerUserId:{ type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt:    { type: Date, default: null },
  reviewNote:    { type: String, default: '' },
  requestSource: { type: String, default: 'employee' },
  cancelledAt:   { type: Date, default: null },
}, { timestamps: true, minimize: false, collection: 'self_service_requests' });

SelfServiceRequestSchema.index({ identityId: 1, createdAt: -1 });
SelfServiceRequestSchema.index({ profileId: 1, createdAt: -1 });

export default mongoose.models.SelfServiceRequest || mongoose.model('SelfServiceRequest', SelfServiceRequestSchema, 'self_service_requests');