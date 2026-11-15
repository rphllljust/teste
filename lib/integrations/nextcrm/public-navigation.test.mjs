import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveNextcrmNavigationHref,
  NEXTCRM_STAGING_ENTRY,
  NEXTCRM_STAGING_ORIGIN,
} from "./public-navigation.ts";

test("enabled in staging for the exact reviewed public HTTPS origin", () => {
  assert.equal(
    resolveNextcrmNavigationHref("staging", NEXTCRM_STAGING_ORIGIN),
    NEXTCRM_STAGING_ENTRY,
  );
});
test("disabled in production, local, and when configuration is absent", () => {
  for (const env of ["production", "development", "", undefined]) {
    assert.equal(resolveNextcrmNavigationHref(env, NEXTCRM_STAGING_ORIGIN), null);
  }
  assert.equal(resolveNextcrmNavigationHref("staging", undefined), null);
});
test("rejects insecure hosts, private ports, URL paths, query and userinfo", () => {
  for (const origin of [
    "http://nextcrm-gateway-staging.up.railway.app",
    "https://nextcrm-gateway-staging.up.railway.app:3000",
    "http://nextcrm-web.railway.internal:3000",
    "https://nextcrm-gateway-staging.up.railway.app/en",
    "https://nextcrm-gateway-staging.up.railway.app?next=https://evil.test",
    "https://nextcrm-gateway-staging.up.railway.app.evil.test",
    "https://user@nextcrm-gateway-staging.up.railway.app",
    "https://nextcrm-gateway-staging.up.railway.app/",
  ]) {
    assert.equal(resolveNextcrmNavigationHref("staging", origin), null, origin);
  }
});
test("never passes an ERP client/order ID, cookie or query into CRM", () => {
  assert.equal(new URL(NEXTCRM_STAGING_ENTRY).search, "");
  assert.equal(new URL(NEXTCRM_STAGING_ENTRY).pathname, "/en");
  assert.equal(new URL(NEXTCRM_STAGING_ENTRY).port, "");
});
