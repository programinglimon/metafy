import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { generate } from '../controllers/generateController.js';

const router = Router();

router.post('/', requireAuth, generate);

export default router;
