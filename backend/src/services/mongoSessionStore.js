/**
 * Mongo-backed express-session store.
 *
 * The default MemoryStore keeps every session in the process heap: it warns
 * about exactly this in production, never frees an entry, and throws every
 * session away on restart — signing out anyone mid-Google-sign-in. Sessions
 * here are few and small (the OAuth handshake and dashboard visits), so the
 * database that already exists is the right place for them. No extra package:
 * express-session's Store contract is four methods.
 */
const { Store } = require('express-session');
const mongoose = require('mongoose');

const COLLECTION = 'sessions';

class MongoSessionStore extends Store {
  constructor(options = {}) {
    super();
    this.ttlMs = Number(options.ttlMs) || 7 * 24 * 60 * 60 * 1000;
    this.indexReady = null;
  }

  collection() {
    return mongoose.connection.collection(COLLECTION);
  }

  /** TTL index so expired rows leave without a sweeper process. */
  ensureIndex() {
    if (!this.indexReady) {
      this.indexReady = this.collection()
        .createIndex({ expires: 1 }, { expireAfterSeconds: 0 })
        .catch((err) => { this.indexReady = null; throw err; });
    }
    return this.indexReady;
  }

  /**
   * A session read must never fail a request: the app's real auth is the JWT,
   * this session only carries the OAuth handshake. A database hiccup therefore
   * reads as "no session" instead of a 500 on every page.
   */
  async get(sid, callback) {
    try {
      await this.ensureIndex();
      const doc = await this.collection().findOne({ _id: sid });
      if (!doc || !doc.session) return callback(null, null);
      if (doc.expires && new Date(doc.expires).getTime() <= Date.now()) {
        await this.collection().deleteOne({ _id: sid });
        return callback(null, null);
      }
      const parsed = JSON.parse(doc.session);
      // JSON turns the cookie's Date into a string; express-session compares it
      // against the clock, so hand it back the real thing.
      if (parsed?.cookie?.expires) parsed.cookie.expires = new Date(parsed.cookie.expires);
      return callback(null, parsed);
    } catch (err) {
      console.warn(`⚠️  Session store read failed (treated as signed out): ${err.message}`);
      return callback(null, null);
    }
  }

  async set(sid, session, callback) {
    try {
      await this.ensureIndex();
      await this.collection().replaceOne(
        { _id: sid },
        { _id: sid, session: JSON.stringify(session), expires: new Date(Date.now() + this.ttlMs) },
        { upsert: true },
      );
      return callback(null);
    } catch (err) {
      console.warn(`⚠️  Session store write failed: ${err.message}`);
      return callback(null); // never fail the request over session bookkeeping
    }
  }

  async destroy(sid, callback) {
    try {
      await this.collection().deleteOne({ _id: sid });
      return callback(null);
    } catch (err) {
      console.warn(`⚠️  Session store delete failed: ${err.message}`);
      return callback(null);
    }
  }

  async touch(sid, _session, callback) {
    try {
      await this.collection().updateOne({ _id: sid }, { $set: { expires: new Date(Date.now() + this.ttlMs) } });
      return callback(null);
    } catch (_err) {
      return callback(null);
    }
  }
}

module.exports = MongoSessionStore;
