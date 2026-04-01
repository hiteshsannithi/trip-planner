// ============================================================
// routes/plan.js — THE WORKFLOW (placeholder for Session 1)
// ============================================================
// WHAT: This file will contain the full 8-agent workflow.
//       For Session 1, it's a placeholder so index.js can import
//       it without crashing. We build the full version in Session 2.
// ============================================================

import { Router } from 'express';

const router = Router();

// Placeholder endpoint — returns a message confirming the route works.
// In Session 2, this becomes the full streaming workflow.
router.post('/plan', (req, res) => {
  res.json({
    message: 'Plan route is working. Full workflow coming in Session 2.',
    received: req.body,
  });
});

export default router;
