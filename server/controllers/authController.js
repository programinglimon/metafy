import bcrypt from 'bcryptjs';
import { connectDB } from '../config/db.js';
import User from '../models/User.js';
import { signToken } from '../utils/token.js';
import { apiKeysMap } from '../utils/keyUsage.js';
import { migrateLegacyKeys } from './userController.js';

export async function signup(req, res) {
  try {
    const { email, password } = req.body || {};
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    await connectDB();
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ email: email.toLowerCase(), passwordHash });
    const token = signToken(user._id.toString());

    return res.status(201).json({ token, email: user.email, apiKeys: apiKeysMap(user) });
  } catch (err) {
    console.error('signup error:', err);
    return res.status(500).json({ error: 'Something went wrong creating the account.' });
  }
}

export async function login(req, res) {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    await connectDB();
    const user = await User.findOne({ email: String(email).toLowerCase() });
    if (!user) return res.status(401).json({ error: 'Incorrect email or password.' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Incorrect email or password.' });

    // Same one-time migration as /user/me: keys saved before key pools existed
    // move into the pool so they show up in Settings and in key rotation.
    const patch = migrateLegacyKeys(user);
    if (patch) await User.findByIdAndUpdate(user._id, patch);

    const token = signToken(user._id.toString());
    return res.status(200).json({ token, email: user.email, apiKeys: apiKeysMap(user) });
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).json({ error: 'Something went wrong signing in.' });
  }
}
