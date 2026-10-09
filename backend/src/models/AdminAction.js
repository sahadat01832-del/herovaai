const mongoose = require('mongoose');

/**
 * AdminAction — who changed what, and when.
 *
 * An admin panel with stop buttons and force-disconnects is only trustworthy if
 * the actions leave a trail: when a customer's session was killed or a plan was
 * switched on, the answer must be a record, not a memory. Rows are small and the
 * list is trimmed to the newest MAX_ROWS, so this is a receipt book, not a log sink.
 */
const AdminActionSchema = new mongoose.Schema({
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  actorEmail: { type: String, default: '' },
  // Machine-readable kind: settings.update | session.stop | session.disconnect |
  // payment.approve | payment.reject | user.update | user.delete | key.remove …
  action: { type: String, required: true, index: true },
  target: { type: String, default: '' },
  detail: { type: String, default: '' },
  at: { type: Date, default: Date.now, index: true },
}, { timestamps: true });

AdminActionSchema.index({ at: -1 });

module.exports = mongoose.models.AdminAction || mongoose.model('AdminAction', AdminActionSchema);
