import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import generateRoutes from './routes/generateRoutes.js';

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' })); // room for resized base64 images

// Simple root landing so the live API URL doesn't show a raw "Cannot GET /".
app.get('/', (req, res) => res.json({ ok: true, name: 'Metafy Adobe Stock Metadata API' }));
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/generate', generateRoutes);

// Fallback for unknown API routes
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// When run as a standalone process (locally or on Render) this calls
// app.listen(). The VERCEL guard is harmless here and only applied so the app
// can be imported as a plain (req, res) handler without starting a listener —
// ignored when running on Render.
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

export default app;
