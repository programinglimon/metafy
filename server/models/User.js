import mongoose from 'mongoose';

const KeySchema = new mongoose.Schema(
  {
    id: { type: String, required: true },   // client-facing id for add/remove
    encrypted: { type: String, required: true }, // AES-256-GCM "iv:tag:data"
    // Usage counters, so Settings can show how much of each key's daily quota
    // is gone. `uses` belongs to the Pacific-time day in `dayKey` (that's when
    // provider quotas reset); generation rotates away from a key whose
    // `exhaustedDayKey` is today.
    uses: { type: Number, default: 0 },          // requests accepted today
    dayKey: { type: String, default: '' },       // PT date `uses` belongs to
    total: { type: Number, default: 0 },         // requests accepted all-time
    failures: { type: Number, default: 0 },      // rejected attempts
    limit: { type: Number, default: 0 },         // daily limit learned from a 429 (0 = unknown)
    limitModel: { type: String, default: '' },   // model that limit applies to
    exhaustedDayKey: { type: String, default: '' }, // PT day the key ran out
    lastUsedAt: { type: Date, default: null },
    lastError: { type: String, default: '' },
    lastErrorAt: { type: Date, default: null },
  },
  { _id: false }
);

const UserSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  passwordHash: { type: String, required: true },
  // API keys are AES-256-GCM encrypted ("iv:tag:data") and only decrypted
  // server-side. Legacy single-key fields stay for backward compatibility;
  // new keys go into the pools so generation can auto-switch when a key's
  // quota is exhausted.
  encryptedApiKey: { type: String, default: null }, // legacy Gemini single
  encryptedApiKeys: { type: [KeySchema], default: [] }, // Gemini pool
  encryptedMistralKey: { type: String, default: null }, // legacy Mistral single
  encryptedMistralKeys: { type: [KeySchema], default: [] }, // Mistral pool
  encryptedOpenrouterKey: { type: String, default: null }, // legacy OpenRouter single
  encryptedOpenrouterKeys: { type: [KeySchema], default: [] }, // OpenRouter pool
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.models.User || mongoose.model('User', UserSchema);
