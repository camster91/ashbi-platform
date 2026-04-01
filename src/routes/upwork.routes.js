// src/routes/upwork.routes.js
import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import UpworkController from '../controllers/upwork.controller.js';

const router = express.Router();

// Sync endpoint (agent POSTs data here)
router.post('/sync', UpworkController.syncData);

// Get profile overview
router.get('/profile/:profileId', authenticateToken, UpworkController.getProfile);

// Get contracts
router.get('/contracts', authenticateToken, UpworkController.getContracts);

// Get jobs
router.get('/jobs', authenticateToken, UpworkController.getJobs);

// Get messages
router.get('/messages', authenticateToken, UpworkController.getMessages);

// Get earnings summary
router.get('/earnings', authenticateToken, UpworkController.getEarnings);

// Get dashboard overview
router.get('/dashboard', authenticateToken, UpworkController.getDashboard);

export default router;
