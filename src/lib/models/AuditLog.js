import mongoose from 'mongoose';

const AuditLogSchema = new mongoose.Schema({
  action:       { type: String, required: true },
  module:       { type: String, required: true },
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  details:      { type: String },
  severity:     { type: String, enum: ['low', 'medium', 'high'], default: 'low' },
  ip:           { type: String, default: '' },
}, { timestamps: true });

export default mongoose.models.AuditLog || mongoose.model('AuditLog', AuditLogSchema);
