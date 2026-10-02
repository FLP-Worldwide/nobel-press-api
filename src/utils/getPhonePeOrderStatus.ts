import { getPhonePeToken } from "./getPhonePeToken";

export interface PhonePePaymentAttempt {
  transactionId?: string;
  amount?: number;
  state?: string;
  paymentMode?: string;
}

export interface PhonePeOrderStatus {
  orderId?: string;
  state: "PENDING" | "FAILED" | "COMPLETED" | string;
  amount: number;
  paymentDetails?: PhonePePaymentAttempt[];
  errorCode?: string;
  detailedErrorCode?: string;
}

export async function getPhonePeOrderStatus(merchantOrderId: string): Promise<PhonePeOrderStatus> {
  if (!process.env.PHONEPE_BASE_URL) throw new Error("PhonePe base URL is not configured");
  const accessToken = await getPhonePeToken();
  const endpoint = new URL(
    `${process.env.PHONEPE_BASE_URL}/checkout/v2/order/${encodeURIComponent(merchantOrderId)}/status`,
  );
  endpoint.searchParams.set("details", "false");
  endpoint.searchParams.set("errorContext", "true");

  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `O-Bearer ${accessToken}`,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.message || `PhonePe status request failed (${response.status})`);
  }
  if (typeof body?.state !== "string" || !Number.isFinite(Number(body?.amount))) {
    throw new Error("PhonePe returned an invalid order status response");
  }
  return body as PhonePeOrderStatus;
}
