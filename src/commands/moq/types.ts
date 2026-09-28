/**
 * Shapes for the MoQ (Media over QUIC) token-mint routes (`/v1/moq/publish/:ns/:track`,
 * `/v1/moq/subscribe/:ns/:track`). Local types for the same reason as `../srt/types.ts` — no
 * dedicated `moq` SDK module exists yet; this reaches the route through the SDK's generic client.
 */
export interface MoqToken {
  token: string;
  ns: string;
  track: string;
  relayUrl?: string;
  expiresAt?: string;
  [key: string]: unknown;
}
