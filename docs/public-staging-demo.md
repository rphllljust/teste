# Public staging demonstration

The public `staging` service domain has no verified network perimeter. Keep it in demonstration mode while that remains true.

Enable the public workspace by setting this **server-only Railway variable on the staging environment and the `cisne-web-staging` service**:

```text
CISNE_PUBLIC_DEMO_MODE=true
```

The entry page also requires Railway's injected `RAILWAY_ENVIRONMENT_NAME` to equal `staging` exactly. The variable alone cannot enable the demo in production or on a local machine. The public workspace is static, clearly labels all sample records, makes no API calls, and performs no writes.

When this mode is enabled, every business API rejects requests before identity resolution, including requests with a caller-supplied `oai-authenticated-user-id` header. This is necessary because the Railway service domain is public and the current application trusts that identity header when requests arrive through the authenticated Sites dispatcher. Do not disable demo mode while the public Railway domain remains reachable. Restore business APIs only after adding an independently verified private perimeter and routing authenticated traffic through the trusted identity dispatcher.

The original ChatGPT sign-in helpers and operational workspace remain available in code. No credential, session, or demo actor is created by public demo mode.
