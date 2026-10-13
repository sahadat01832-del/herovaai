const mongoose = require('mongoose');

const ImageGenerationQuotaSchema = new mongoose.Schema({
  _id: { type: String },
  period: { type: String, required: true },
  count: { type: Number, default: 0, min: 0 },
  expiresAt: { type: Date, required: true },
}, { versionKey: false });

ImageGenerationQuotaSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.ImageGenerationQuota
  || mongoose.model('ImageGenerationQuota', ImageGenerationQuotaSchema);
