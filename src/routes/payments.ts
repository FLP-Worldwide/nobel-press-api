// routes/payments.ts
import express, { Request, Response } from "express";
import { initiatePhonePePayment } from "../utils/initiatePhonePePayment";

const router = express.Router();

/**
 * @route POST /api/payments/phonepe/initiate
 * @desc Initiates a PhonePe payment and returns a redirect URL
 */
router.post("/phonepe/initiate", async (req: Request, res: Response) => {
  try {
    const { amount, redirectUrl } = req.body;

    if (!amount || !redirectUrl) {
      return res.status(400).json({
        success: false,
        message: "Amount and redirectUrl are required",
      });
    }

    // Generate unique merchantOrderId
    const merchantOrderId = `ORD-${Date.now()}`;
    
    const paymentResponse = await initiatePhonePePayment({
      merchantOrderId,
      amount,
      redirectUrl,
      message: "Order Payment",
    });


    if (!paymentResponse.success) {
      return res.status(400).json({ success: false, error: paymentResponse.error });
    }
    const phonePeRedirectUrl = paymentResponse.rawResponse?.redirectUrl;

    if (!phonePeRedirectUrl) {
      return res.status(500).json({
        success: false,
        error: "Missing redirect URL in PhonePe response",
      });
    }
   
    console.log(paymentResponse);
   return res.json({
      success: true,
      merchantOrderId,
      redirectUrl: phonePeRedirectUrl,
      rawResponse: paymentResponse.rawResponse,
    });


  } catch (err: any) {
    console.error("❌ Error initiating PhonePe payment:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
