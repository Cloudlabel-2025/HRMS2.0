import mongoose from 'mongoose';

const RefreshTokenSchema = new mongoose.Schema({
  jti: { type: String, required: true, unique: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  expiresAt: { type: Date, required: true },
  revoked: { type: Boolean, default: false, index: true },
  replacedBy: { type: String, default: null },
  ip: { type: String, default: '' },
}, { timestamps: true });

// Auto-clean expired refresh records (7d + grace).
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.RefreshToken || mongoose.model('RefreshToken', RefreshTokenSchema);
