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

router.get('/options', async (_req, res) => {
  try {
    const options = await googleFlowService.getGenerationOptions();
    res.json({ success: true, options });
  } catch (error) {
    res.status(502).json({ success: false, message: error.message });
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

    const result = await googleFlowService.generateImage({
      prompt: req.body.prompt,
      model: req.body.model || undefined,
      aspectRatio: req.body.aspectRatio || undefined,
      referenceImagePath,
    });
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
