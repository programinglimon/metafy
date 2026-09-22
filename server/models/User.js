import mongoose from 'mongoose';

const KeySchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    encrypted: { type: String, required: true },
    uses: { type: Number, default: 0 },
    dayKey: { type: String, default: '' },
    total: { type: Number, default: 0 },
    failures: { type: Number, default: 0 },
    limit: { type: Number, default: 0 },
    limitModel: { type: String, default: '' },
    exhaustedDayKey: { type: String, default: '' },
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
  // Email+password accounts store a bcrypt hash here; Google-only accounts have none.
  passwordHash: { type: String, default: null },
  // Google OAuth subject id for accounts created via "Continue with Google".
  googleId: { type: String, default: null, index: true },
  encryptedApiKey: { type: String, default: null },
  encryptedApiKeys: { type: [KeySchema], default: [] },
  encryptedMistralKey: { type: String, default: null },
  encryptedMistralKeys: { type: [KeySchema], default: [] },
  encryptedOpenrouterKey: { type: String, default: null },
  encryptedOpenrouterKeys: { type: [KeySchema], default: [] },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.models.User || mongoose.model('User', UserSchema);
