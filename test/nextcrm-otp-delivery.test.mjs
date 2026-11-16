import test from "node:test";
import assert from "node:assert/strict";
import { assertOTPEmailAccepted } from "../integrations/nextcrm-bridge-overlay/lib/auth/otp-delivery.ts";

test("accepts provider-confirmed email queueing", () => {
  assert.doesNotThrow(() =>
    assertOTPEmailAccepted({ data: { id: "synthetic-mail-id" }, error: null })
  );
});
test("rejects a structured Resend API error even without a throw", () => {
  assert.throws(() =>
    assertOTPEmailAccepted({
      data: null,
      error: { name: "validation_error", message: "Synthetic sender mismatch" },
    }),
    { message: "OTP_EMAIL_DELIVERY_REJECTED" }
  );
});
test("rejects missing provider confirmation", () => {
  assert.throws(() =>
    assertOTPEmailAccepted({ data: null, error: null }),
    { message: "OTP_EMAIL_DELIVERY_REJECTED" }
  );
  assert.throws(() =>
    assertOTPEmailAccepted({ data: { id: " " }, error: null }),
    { message: "OTP_EMAIL_DELIVERY_REJECTED" }
  );
});
