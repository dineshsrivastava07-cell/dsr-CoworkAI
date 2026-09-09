/**
 * Bundled Google OAuth credentials loaded from environment variables.
 *
 * Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in your .env file
 * (or via build-time environment injection) to pre-bundle credentials into the
 * app. When these are present, users see a simple "Sign in with Google" button
 * instead of a credential-entry form — the same UX pattern used by Slack,
 * Notion, and other desktop apps that ship their own OAuth client.
 *
 * Security note: Electron desktop apps are "confidential clients" in OAuth
 * terms — the client secret lives on the user's own machine, not a shared
 * server, which is the accepted model for installed desktop applications per
 * RFC 8252 (OAuth 2.0 for Native Apps).
 */

import type { GoogleClientCredentials } from './google-oauth';

/**
 * Returns the bundled credentials from environment variables, or null if not
 * configured.
 */
export function getBundledCredentials(): GoogleClientCredentials | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    return null;
  }

  return { clientId, clientSecret };
}
