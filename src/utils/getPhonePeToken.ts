export interface PhonePeTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

export const getPhonePeToken = async (): Promise<string> => {
  const url = `${process.env.PHONEPE_BASE_URL}/v1/oauth/token`;

  const params = new URLSearchParams();
  params.append("client_id", process.env.PHONEPE_CLIENT_ID || "");
  params.append("client_version", process.env.PHONEPE_CLIENT_VERSION || "2023-01-01");
  params.append("client_secret", process.env.PHONEPE_CLIENT_SECRET || "");
  params.append("grant_type", "client_credentials");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    throw new Error(`Failed to get PhonePe token: ${response.statusText}`);
  }

  const data = (await response.json()) as PhonePeTokenResponse;

  if (!data.access_token) {
    throw new Error("No access token received from PhonePe");
  }

  return data.access_token;
};
