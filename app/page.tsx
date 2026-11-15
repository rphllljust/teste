import { headers } from "next/headers";
import HomeView from "./HomeView";
import PublicDemoWorkspace from "./PublicDemoWorkspace";
import { isPublicDemoModeEnabled } from "../lib/public-demo-mode.mjs";

export const dynamic = "force-dynamic";

export default async function Home() {
  await headers();
  if (isPublicDemoModeEnabled()) return <PublicDemoWorkspace />;
  return <HomeView />;
}
