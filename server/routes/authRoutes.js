import { Router } from 'express';
import { signup, login, googleAuth } from '../controllers/authController.js';

const router = Router();

router.post('/signup', signup);
router.post('/login', login);
router.post('/google', googleAuth);

export default router;
