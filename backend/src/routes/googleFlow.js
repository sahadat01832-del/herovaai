const express = require('express');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const multer = require('multer');
const { authenticate, adminOnly } = require('../middleware/auth');
const googleFlowService = require('../services/googleFlowService');

const router = express.Router();
const MAX_REFERENCE_IMAGE_BYTES = 20 * 1024 * 1024;
const IMAGE_EXTENSIONS = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_REFERENCE_IMAGE_BYTES, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!IMAGE_EXTENSIONS[file.mimetype]) {
      callback(new Error('Reference image must be a PNG, JPEG, or WebP file.'));
      return;
    }
    callback(null, true);
  },
});

router.use(authenticate, adminOnly);

// Reading the options needs the Flow page, so this launches Brave exactly as a
// generation does — and has to close it again. It used to skip the cleanup,
// which meant merely OPENING Flow Studio left the browser resident afterwards
// (≈500 MB of Brave on a 6 GB box, surviving until the next generation's
// finally happened to close it). A cached answer never starts the browser;
// ?refresh=1 forces a fresh scrape, which is what the Sync button sends.
router.get('/options', async (req, res) => {
  try {
    const options = await googleFlowService.getGenerationOptions({
      refresh: req.query.refresh === '1',
    });
    res.json({ success: true, options });
  } catch (error) {
    res.status(502).json({ success: false, message: error.message });
  } finally {
    try { await googleFlowService.closeBrowserContext(); } catch { /* best-effort */ }
  }
});

router.post('/generate', (req, res, next) => {
  upload.single('referenceImage')(req, res, (error) => {
    if (!error) return next();
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ success: false, message: error.message });
  });
}, async (req, res) => {
  let temporaryDirectory;
  try {
    let referenceImagePath;
    if (req.file) {
      temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'google-flow-upload-'));
      referenceImagePath = path.join(
        temporaryDirectory,
        `reference${IMAGE_EXTENSIONS[req.file.mimetype]}`,
      );
      await fs.writeFile(referenceImagePath, req.file.buffer, { mode: 0o600 });
    }

    const request = {
      prompt: req.body.prompt,
      model: req.body.model || undefined,
      aspectRatio: req.body.aspectRatio || undefined,
      referenceImagePath,
    };
    let result;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        result = await googleFlowService.generateImage(request);
        break;
      } catch (error) {
        // Google's risk engine sometimes flags the automated session itself
        // ("unusual activity") rather than anything about the request — it is
        // intermittent (seen ~1 run in 5 on 2026-10-13), reports no charge, and
        // a fresh browser context usually passes where the flagged one did not.
        // Give it exactly one second attempt; every other failure, and a repeat
        // of this one, is final so genuine errors and credit problems never loop.
        const flagged = /unusual (?:browser )?activity/i.test(error.message);
        if (!flagged || attempt === 2) throw error;
        console.warn(`[google-flow] unusual-activity flag on attempt ${attempt} — retrying with a fresh browser context`);
        try { await googleFlowService.closeBrowserContext(); } catch { /* best-effort */ }
        await new Promise((resolve) => { setTimeout(resolve, 5000); });
      }
    }
    res.json({
      success: true,
      image: result.image,
      mimeType: result.mimeType,
      path: result.path,
    });
  } catch (error) {
    const status = /required|must be|was not found:|20 MB or smaller/.test(error.message) ? 400 : 502;
    res.status(status).json({ success: false, message: error.message });
  } finally {
    // RAM cleanup: tear the cached Brave context down after each website
    // generation so its tabs and memory are released instead of piling up.
    try { await googleFlowService.closeBrowserContext(); } catch { /* best-effort */ }
    if (temporaryDirectory) {
      try {
        await fs.rm(temporaryDirectory, { recursive: true, force: true });
      } catch (error) {
        console.error(`Could not remove temporary Google Flow upload: ${error.message}`);
      }
    }
  }
});

module.exports = router;
