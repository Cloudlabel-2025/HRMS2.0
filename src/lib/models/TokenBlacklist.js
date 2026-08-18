import mongoose from 'mongoose';

const TokenBlacklistSchema = new mongoose.Schema({
  token:     { type: String, required: true, index: true },
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  revokedAt: { type: Date, default: Date.now },
  reason:    { type: String, enum: ['logout', 'password_change', 'admin_revoke', 'breach'], default: 'logout' },
  ip:        String,
}, {
  timestamps: true,
});

TokenBlacklistSchema.index({ createdAt: 1 }, { expireAfterSeconds: 604800 });

export default mongoose.models.TokenBlacklist || mongoose.model('TokenBlacklist', TokenBlacklistSchema);
