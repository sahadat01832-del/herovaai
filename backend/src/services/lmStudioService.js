/**
 * LM Studio Service
 * Auto-manages LM Studio server and model lifecycle:
 * - Triggers server start if offline
 * - Loads model on-demand when chat message arrives
 * - Sets --ttl 20 (auto-unloads from RAM after 20 seconds of inactivity)
 * - Allows explicit immediate unload when user exits chat
 */

const { exec } = require('child_process');
const util = require('util');
const axios = require('axios');
const fs = require('fs');

const execAsync = util.promisify(exec);

const possibleLmsPaths = [
  '/home/sahadat/.local/bin/lms',
  '/mnt/storage/home/sahadat/apps/bionic/lmstudio/bin/lms',
  '/home/sahadat/.lmstudio/bin/lms',
];
const lmsCli = possibleLmsPaths.find(p => fs.existsSync(p)) || 'lms';

class LMStudioService {
  constructor() {
    this.baseUrl = process.env.LM_STUDIO_BASE_URL || 'http://localhost:1234/v1';
    this.port = 1234;
    this.activeModel = null;
    this.defaultTtl = 20; // 20 seconds auto-unload
  }

  // Check if LM Studio HTTP server is answering
  async isServerRunning() {
    try {
      await axios.get(`${this.baseUrl}/models`, { timeout: 2000 });
      return true;
    } catch {
      return false;
    }
  }

  // Ensure LM Studio local server is up
  async ensureServerRunning() {
    const running = await this.isServerRunning();
    if (running) return true;

    console.log('🔄 LM Studio server is offline. Starting local server on port 1234...');
    try {
      await execAsync(`${lmsCli} server start --port ${this.port} --cors`, { timeout: 15000 });
      // Poll for readiness
      for (let i = 0; i < 12; i++) {
        await new Promise(r => setTimeout(r, 600));
        if (await this.isServerRunning()) {
          console.log('✅ LM Studio server is now up on port 1234!');
          return true;
        }
      }
    } catch (err) {
      console.error('⚠️ Failed to start LM Studio server via CLI:', err.message);
    }
    return false;
  }

  // Check which models are currently loaded in RAM
  async getLoadedModels() {
    try {
      const { stdout } = await execAsync(`${lmsCli} ps`, { timeout: 5000 });
      if (stdout.includes('No models are currently loaded')) {
        return [];
      }
      const lines = stdout.split('\n').filter(l => l.trim());
      const loaded = [];
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length > 0 && parts[0] !== 'IDENTIFIER' && parts[0] !== 'To' && !parts[0].startsWith('=')) {
          loaded.push(parts[0]);
        }
      }
      return loaded;
    } catch {
      return [];
    }
  }

  // Ids LM Studio itself reports it can serve
  async getModelIds() {
    // Wake the daemon first: an idle LM Studio answers nothing, and an unanswered list would
    // be reported to callers as "it lists no such model", which is a different fact.
    await this.ensureServerRunning();
    try {
      const response = await axios.get(`${this.baseUrl}/models`, { timeout: 5000 });
      return (response.data?.data || []).map(m => m.id).filter(Boolean);
    } catch (err) {
      console.warn(`⚠️  Could not list LM Studio models: ${err.message}`);
      return [];
    }
  }

  /**
   * The chat-capable model with the smallest parameter count LM Studio lists. Used when nobody
   * pinned a local model: auto-replies must not depend on loading tens of GB into RAM, and the
   * choice is derived from the live list instead of a hardcoded id that may not be installed.
   * Returns null when LM Studio is down or lists nothing conversational.
   */
  async pickDefaultChatModel() {
    const live = await this.getModelIds();
    const chatCapable = live.filter(id => !/embed|tts|whisper|rerank/i.test(id));
    if (chatCapable.length === 0) return null;
    const sizeInBillions = (id) => {
      const match = id.match(/(\d+(?:\.\d+)?)\s?b(?![a-z])/i);
      return match ? parseFloat(match[1]) : Infinity;
    };
    return chatCapable.slice().sort((a, b) => sizeInBillions(a) - sizeInBillions(b))[0];
  }

  // Ensure model is loaded with TTL (auto RAM free after 20 seconds of inactivity)
  async ensureModelLoaded(modelKey, ttlSeconds = 20) {
    await this.ensureServerRunning();

    if (!modelKey) return false;

    // Check if model is already in RAM
    const loaded = await this.getLoadedModels();
    const isLoaded = loaded.some(m =>
      m.toLowerCase().includes(modelKey.toLowerCase()) ||
      modelKey.toLowerCase().includes(m.toLowerCase())
    );

    if (isLoaded) {
      console.log(`⚡ Model "${modelKey}" is already loaded in RAM.`);
      this.activeModel = modelKey;
      return true;
    }

    console.log(`🚀 Loading model "${modelKey}" with ${ttlSeconds}s TTL (RAM auto-release)...`);
    try {
      await execAsync(`${lmsCli} load "${modelKey}" --ttl ${ttlSeconds} -y`, { timeout: 60000 });
      this.activeModel = modelKey;
      console.log(`✅ Model "${modelKey}" loaded into RAM successfully!`);
      return true;
    } catch (err) {
      console.error(`⚠️ Failed to load model "${modelKey}":`, err.message);
      return false;
    }
  }

  // Explicitly unload all models or specific model to free RAM immediately
  async unloadModel(modelKey) {
    try {
      if (modelKey) {
        console.log(`🧹 Unloading model "${modelKey}" to free RAM...`);
        await execAsync(`${lmsCli} unload "${modelKey}"`, { timeout: 10000 });
      } else {
        console.log('🧹 Unloading all models to free RAM...');
        await execAsync(`${lmsCli} unload --all`, { timeout: 10000 });
      }
      this.activeModel = null;
      return true;
    } catch (err) {
      console.warn('⚠️ Unload notice:', err.message);
      return false;
    }
  }
}

module.exports = new LMStudioService();
