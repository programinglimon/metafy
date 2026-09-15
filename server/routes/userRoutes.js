import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getMe, getKeyStats, saveApiKey, removeApiKey } from '../controllers/userController.js';

const router = Router();

router.get('/me', requireAuth, getMe);
router.get('/key-stats', requireAuth, getKeyStats);
router.put('/api-key', requireAuth, saveApiKey);
router.delete('/api-key', requireAuth, removeApiKey);

export default router;
