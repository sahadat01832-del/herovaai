const mongoose = require('mongoose');

const ScheduledPostSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  connectionId: { type: mongoose.Schema.Types.ObjectId, ref: 'ChannelConnection', required: true },
  channel: { type: String, required: true },
  text: { type: String, required: true, maxlength: 5000 },
  mediaUrl: { type: String, default: '' },
  scheduledAt: { type: Date, required: true },
  status: {
    type: String,
    enum: ['scheduled', 'processing', 'published', 'failed', 'cancelled'],
    default: 'scheduled',
    index: true,
  },
  processingAt: { type: Date, default: null },
  publishedAt: { type: Date, default: null },
  resultMessage: { type: String, default: '' },
}, { timestamps: true });

ScheduledPostSchema.index({ status: 1, scheduledAt: 1 });
ScheduledPostSchema.index({ userId: 1, scheduledAt: -1 });

module.exports = mongoose.models.ScheduledPost || mongoose.model('ScheduledPost', ScheduledPostSchema);
