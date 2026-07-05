// Public surface for every Kairos SDK integration point in this app (delegate-sdk route,
// connect/* onboarding routes). Same import path as the old flat lib/sdk.ts
// (`@/app/lib/sdk` / `../../lib/sdk` both resolve to this folder's index.ts), so no
// call site had to change when this split out.
export * from "./client";
export * from "./wallet";
