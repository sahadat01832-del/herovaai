const express = require('express');
const router = express.Router();
const AIMemory = require('../models/AIMemory');
const { authenticate } = require('../middleware/auth');
const {
  KINDS,
  CATALOG_LIMITS,
  normalizeProfile,
  normalizeCatalogItem,
  completeness,
  sampleReply,
} = require('../services/memoryProfile');

const collapse = (value) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();

/** Load-or-create, the way every route here needs it. */
async function loadMemory(userId) {
  let memory = await AIMemory.findOne({ userId });
  if (!memory) memory = await AIMemory.create({ userId });
  return memory;
}

/** Everything the memory screen needs in one response. */
const envelope = (memory) => ({
  success: true,
  memory,
  completeness: completeness(memory),
  preview: sampleReply(memory),
});

// ─── Get memory for current user ───────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    res.json(envelope(await loadMemory(req.user._id)));
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Update the business profile ───────────────────────────────────────────
// Partial by design: the dashboard saves one card at a time, and a field the
// form never sent must not be wiped.
router.put('/', authenticate, async (req, res) => {
  try {
    const patch = normalizeProfile(req.body);
    if (!Object.keys(patch).length) {
      return res.status(400).json({ success: false, message: 'Nothing to update' });
    }
    const memory = await AIMemory.findOneAndUpdate(
      { userId: req.user._id },
      { $set: patch },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.json(envelope(memory));
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Switch personalisation off without losing anything ────────────────────
router.post('/enabled', authenticate, async (req, res) => {
  try {
    const memory = await AIMemory.findOneAndUpdate(
      { userId: req.user._id },
      { $set: { enabled: req.body.enabled !== false } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.json(envelope(memory));
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Live preview for unsaved edits ────────────────────────────────────────
// The owner should see the effect of a sentence while typing it, not after a save.
router.post('/preview', authenticate, async (req, res) => {
  try {
    const saved = await loadMemory(req.user._id);
    const draft = saved.toObject();
    const patch = normalizeProfile(req.body || {});
    for (const [field, value] of Object.entries(patch)) {
      if (field === 'operations') draft.operations = { ...draft.operations, ...value };
      else draft[field] = value;
    }
    if (Array.isArray(req.body?.catalog)) {
      draft.catalog = req.body.catalog.map((item) => normalizeCatalogItem(item));
    }
    res.json({ success: true, preview: sampleReply(draft), completeness: completeness(draft) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Clear everything (the owner asked for it, or wants a fresh start) ─────
router.delete('/', authenticate, async (req, res) => {
  try {
    const memory = await AIMemory.findOneAndUpdate(
      { userId: req.user._id },
      {
        $set: {
          ownerName: '', ownerRole: '', businessName: '', businessType: '', businessDescription: '',
          catalog: [], policies: '', guardrails: '', escalationContact: '',
          greeting: '', signoff: '', tone: 'professional', language: 'English',
          replyLength: 'balanced', entries: [], generatedSystemPrompt: '',
          operations: {},
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.json(envelope(memory));
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ─────────────────────────── what you sell ─────────────────────────────── */

router.post('/catalog', authenticate, async (req, res) => {
  try {
    const item = normalizeCatalogItem(req.body);
    if (!collapse(item.name)) {
      return res.status(400).json({ success: false, message: 'Give the product or service a name' });
    }
    if (item.name.length > CATALOG_LIMITS.name) {
      return res.status(400).json({ success: false, message: 'That name is too long' });
    }
    const memory = await AIMemory.findOneAndUpdate(
      { userId: req.user._id },
      { $push: { catalog: item } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.status(201).json(envelope(memory));
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/catalog/:itemId', authenticate, async (req, res) => {
  try {
    const item = normalizeCatalogItem(req.body, { partial: true });
    if (item.kind !== undefined && !KINDS.includes(item.kind)) item.kind = 'product';
    const patch = {};
    for (const [field, value] of Object.entries(item)) patch[`catalog.$.${field}`] = value;

    const memory = await AIMemory.findOneAndUpdate(
      { userId: req.user._id, 'catalog._id': req.params.itemId },
      { $set: patch },
      { new: true }
    );
    if (!memory) return res.status(404).json({ success: false, message: 'Item not found' });
    res.json(envelope(memory));
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/catalog/:itemId', authenticate, async (req, res) => {
  try {
    const memory = await AIMemory.findOneAndUpdate(
      { userId: req.user._id },
      { $pull: { catalog: { _id: req.params.itemId } } },
      { new: true }
    );
    if (!memory) return res.status(404).json({ success: false, message: 'Memory not found' });
    res.json(envelope(memory));
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ─────────────────────────── extra facts ──────────────────────────────── */

router.post('/entries', authenticate, async (req, res) => {
  try {
    const key = collapse(req.body?.key).slice(0, 160);
    const value = collapse(req.body?.value).slice(0, 2000);
    const category = ['business', 'product', 'customer', 'preference', 'fact', 'other'].includes(req.body?.category)
      ? req.body.category
      : 'other';
    if (!key || !value) {
      return res.status(400).json({ success: false, message: 'Key and value are required' });
    }

    const memory = await AIMemory.findOneAndUpdate(
      { userId: req.user._id },
      { $push: { entries: { key, value, category } } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.status(201).json(envelope(memory));
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/entries/:entryId', authenticate, async (req, res) => {
  try {
    const patch = {};
    if (req.body?.key !== undefined) patch['entries.$.key'] = collapse(req.body.key).slice(0, 160);
    if (req.body?.value !== undefined) patch['entries.$.value'] = collapse(req.body.value).slice(0, 2000);
    if (req.body?.category !== undefined) patch['entries.$.category'] = req.body.category;
    if (!Object.keys(patch).length) {
      return res.status(400).json({ success: false, message: 'Nothing to update' });
    }

    const memory = await AIMemory.findOneAndUpdate(
      { userId: req.user._id, 'entries._id': req.params.entryId },
      { $set: patch },
      { new: true }
    );
    if (!memory) return res.status(404).json({ success: false, message: 'Entry not found' });
    res.json(envelope(memory));
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/entries/:entryId', authenticate, async (req, res) => {
  try {
    const memory = await AIMemory.findOneAndUpdate(
      { userId: req.user._id },
      { $pull: { entries: { _id: req.params.entryId } } },
      { new: true }
    );
    if (!memory) return res.status(404).json({ success: false, message: 'Memory not found' });
    res.json(envelope(memory));
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
