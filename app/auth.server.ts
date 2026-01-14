import { authenticate } from "./shopify.server";

/**
 * Shared helper to require shop session for server-side loaders/actions.
 * 
 * Use this in any loader/action that needs:
 * - session.shop (for DB scoping)
 * - session.accessToken (for Admin API calls)
 * - merchant-scoped queries
 * 
 * This centralizes auth logic and ensures session is always derived from the request.
 */
export async function requireShopSession(request: Request) {
  const { session, admin } = await authenticate.admin(request);
  return { session, admin, shop: session.shop };
}
