import { getPhonePeToken } from "./getPhonePeToken";

interface PhonePePaymentRequest {
  merchantOrderId: string;
  amount: number; // Amount in paise
  redirectUrl: string;
  message?: string;
}

interface PhonePePaymentResponse {
  success: boolean;
  merchantOrderId?: string;
  redirectUrl?: string;
  rawResponse?: any;
  error?: string;
}

export const initiatePhonePePayment = async (
  payload: PhonePePaymentRequest
): Promise<PhonePePaymentResponse> => {
  try {
    const accessToken = await getPhonePeToken();

    const response = await fetch(`${process.env.PHONEPE_BASE_URL}/checkout/v2/pay`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `O-Bearer ${accessToken}`, // PhonePe requires this format
      },
      body: JSON.stringify({
        merchantOrderId: payload.merchantOrderId,
        amount: payload.amount,
        paymentFlow: {
          type: "PG_CHECKOUT",
          message: payload.message || "Payment initiated",
          merchantUrls: {
            redirectUrl: payload.redirectUrl,
          },
        },
      }),
    });

    console.log("📥 PhonePe API Response Status:", response.status);

    // Parse JSON safely
    const data = await response.json().catch(() => null);

    // If PhonePe returns an error
    if (!response.ok) {
      return {
        success: false,
        error: data?.message || "PhonePe API call failed",
      };
    }

    // Extract redirect URL
    const redirectUrl = data?.redirectUrl || data?.data?.instrumentResponse?.redirectInfo?.url;

    if (!redirectUrl) {
      return {
        success: false,
        error: "Missing redirect URL in PhonePe response",
        rawResponse: data,
      };
    }

    // ✅ Return structured success response
    return {
      success: true,
      merchantOrderId: payload.merchantOrderId,
      redirectUrl,
      rawResponse: data,
    };

  } catch (err: any) {
    console.error("❌ Exception during PhonePe API call:", err);

    return {
      success: false,
      error: err.message || "Unexpected error while initiating PhonePe payment",
    };
  }
};
