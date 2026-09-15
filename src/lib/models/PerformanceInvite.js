import mongoose from 'mongoose';

const PerformanceInviteSchema = new mongoose.Schema({
  reviewId: { type: mongoose.Schema.Types.ObjectId, ref: 'Review', required: true, index: true },
  revieweeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  peerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  cycle: { type: String, required: true, index: true },
  status: { type: String, enum: ['pending', 'submitted', 'expired'], default: 'pending' },
}, { timestamps: true });

PerformanceInviteSchema.index({ reviewId: 1, peerId: 1 }, { unique: true });

export default mongoose.models.PerformanceInvite || mongoose.model('PerformanceInvite', PerformanceInviteSchema);
