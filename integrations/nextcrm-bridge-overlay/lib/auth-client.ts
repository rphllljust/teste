import { createAuthClient } from "better-auth/react";
import { emailOTPClient, adminClient } from "better-auth/client/plugins";
import { ac, admin, manager, user } from "@/lib/auth-permissions";

export const authClient = createAuthClient({
  // The browser must always call the same public HTTPS origin which served the
  // page. NEXT_PUBLIC_* values are compiled at build time in Next.js and may
  // otherwise point to localhost/:3000 after a container deploy.
  baseURL: typeof window !== "undefined"
    ? window.location.origin
    : process.env.NEXT_PUBLIC_APP_URL,
  plugins: [
    emailOTPClient(),
    adminClient({
      ac,
      roles: { admin, manager, user },
    }),
  ],
});

export const { signIn, signOut, useSession } = authClient;
