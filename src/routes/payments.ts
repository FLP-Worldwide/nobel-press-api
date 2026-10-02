import { Router } from "express";

const router = Router();

// The former endpoint trusted a caller-supplied amount and redirect URL. It is
// intentionally disabled. Purpose-specific endpoints create server-priced
// intents (for example /api/books/:id/publishing-payment/initiate).
router.post("/phonepe/initiate", (_req, res) => {
  return res.status(410).json({
    success: false,
    message: "Generic payment initiation is disabled. Use a server-priced payment endpoint.",
  });
});

export default router;
