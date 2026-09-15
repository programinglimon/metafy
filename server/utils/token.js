import jwt from 'jsonwebtoken';

export function signToken(userId) {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not set.');
  return jwt.sign({ uid: userId }, process.env.JWT_SECRET, { expiresIn: '30d' });
}
