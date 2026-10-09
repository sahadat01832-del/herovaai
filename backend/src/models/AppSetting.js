const mongoose = require('mongoose');

/**
 * AppSetting — small, plainly-named configuration the owner edits from the
 * dashboard (Nagad wallet number, auto-verify switch, post topics…).
 *
 * Deliberately NOT a place for secrets: API keys and private keys belong in the
 * key vault (or .env), because everything here is returned to the admin UI as-is.
 */
const AppSettingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, index: true },
  value: { type: mongoose.Schema.Types.Mixed, default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

module.exports = mongoose.models.AppSetting || mongoose.model('AppSetting', AppSettingSchema);
