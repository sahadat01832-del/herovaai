const mongoose = require('mongoose');

const CommercialPostSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  text: { type: String, required: true, maxlength: 5000 },
}, { timestamps: true });

CommercialPostSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.models.CommercialPost || mongoose.model('CommercialPost', CommercialPostSchema);
