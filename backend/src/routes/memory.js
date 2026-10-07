const express = require('express');
const router = express.Router();
const AIMemory = require('../models/AIMemory');
const { authenticate } = require('../middleware/auth');

// ─── Get memory for current user ───────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    let memory = await AIMemory.findOne({ userId: req.user._id });
    if (!memory) {
      memory = await AIMemory.create({ userId: req.user._id });
    }
    res.json({ success: true, memory });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Update memory base info ───────────────────────────────────────────────
router.put('/', authenticate, async (req, res) => {
  try {
    const { ownerName, businessName, businessType, businessDescription, tone, language } = req.body;
    const memory = await AIMemory.findOneAndUpdate(
      { userId: req.user._id },
      { $set: { ownerName, businessName, businessType, businessDescription, tone, language } },
      { new: true, upsert: true }
    );
    res.json({ success: true, memory });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Add memory entry ──────────────────────────────────────────────────────
router.post('/entries', authenticate, async (req, res) => {
  try {
    const { key, value, category } = req.body;
    if (!key || !value) {
      return res.status(400).json({ success: false, message: 'Key and value are required' });
    }

    const memory = await AIMemory.findOneAndUpdate(
      { userId: req.user._id },
      { $push: { entries: { key, value, category: category || 'other' } } },
      { new: true, upsert: true }
    );
    res.status(201).json({ success: true, memory });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Delete memory entry ───────────────────────────────────────────────────
router.delete('/entries/:entryId', authenticate, async (req, res) => {
  try {
    const memory = await AIMemory.findOneAndUpdate(
      { userId: req.user._id },
      { $pull: { entries: { _id: req.params.entryId } } },
      { new: true }
    );
    if (!memory) return res.status(404).json({ success: false, message: 'Memory not found' });
    res.json({ success: true, memory });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Update memory entry ───────────────────────────────────────────────────
router.put('/entries/:entryId', authenticate, async (req, res) => {
  try {
    const { key, value, category } = req.body;
    const memory = await AIMemory.findOneAndUpdate(
      { userId: req.user._id, 'entries._id': req.params.entryId },
      { $set: { 'entries.$.key': key, 'entries.$.value': value, 'entries.$.category': category } },
      { new: true }
    );
    res.json({ success: true, memory });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
