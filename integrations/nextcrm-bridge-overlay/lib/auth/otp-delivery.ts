/**
 * Resend's SDK returns {data, error} for provider failures rather than
 * necessarily throwing. Do not report "OTP sent" on an unsuccessful send.
 * Keep the public error generic; provider details can contain PII.
 */
export function assertOTPEmailAccepted(response: {
  data?: { id?: string | null } | null;
  error?: unknown;
}): void {
  if (response.error || typeof response.data?.id !== "string" || !response.data.id.trim()) {
    throw new Error("OTP_EMAIL_DELIVERY_REJECTED");
  }
}
