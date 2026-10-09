/**
 * adminAudit — the receipt book behind the admin controls.
 *
 * record() is deliberately non-throwing: an audit write must never be the reason
 * a payment approval or a session disconnect fails. If MongoDB rejects the row,
 * the action still happened and the warning says the trail is short one entry.
 */
const AdminAction = require('../models/AdminAction');

const MAX_ROWS = Number(process.env.ADMIN_AUDIT_ROWS || 500);

/** Keep the newest MAX_ROWS; called after an insert, best-effort. */
async function prune() {
  const count = await AdminAction.estimatedDocumentCount();
  if (count <= MAX_ROWS) return 0;
  const oldest = await AdminAction.find().sort({ at: -1 }).skip(MAX_ROWS).select('_id').lean();
  if (!oldest.length) return 0;
  const result = await AdminAction.deleteMany({ _id: { $in: oldest.map((row) => row._id) } });
  return result.deletedCount || 0;
}

/** Record one action. Returns the created row, or null when the write failed. */
async function record({ actor = null, action, target = '', detail = '' } = {}) {
  if (!action) return null;
  try {
    const row = await AdminAction.create({
      actor: actor?._id || actor || null,
      actorEmail: actor?.email || '',
      action: String(action).slice(0, 80),
      target: String(target || '').slice(0, 200),
      detail: String(detail || '').slice(0, 400),
    });
    prune().catch(() => {});
    return row;
  } catch (err) {
    console.warn(`[admin-audit] could not record ${action}: ${err.message}`);
    return null;
  }
}

/** Newest first, serialised for the admin screen. */
async function list({ limit = 50 } = {}) {
  const rows = await AdminAction.find()
    .sort({ at: -1 })
    .limit(Math.min(Math.max(Number(limit) || 50, 1), 200));
  return rows.map((row) => ({
    _id: String(row._id),
    action: row.action,
    target: row.target,
    detail: row.detail,
    actorEmail: row.actorEmail,
    at: row.at,
  }));
}

module.exports = { record, list, prune, MAX_ROWS };
