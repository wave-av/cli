/**
 * Shapes for the SRT ingest routes (`/v1/srt/inputs`). Defined locally rather than imported from
 * `@wave-av/sdk` because the SDK does not yet ship a dedicated `srt` module (verified against
 * `wave-av/sdk` origin/main: no `src/srt.ts`) — this CLI reaches the route directly through the
 * SDK's already-published, generic `WaveClient.get/post/delete` (see `src/lib/api-client.ts`,
 * and `wave compose` for the established precedent of this exact pattern). When the SDK adds a
 * typed `srt` module, these local types can be dropped in favor of its exports.
 */

export interface SrtInput {
  id: string;
  srtUrl: string;
  title?: string;
  status?: string;
  latencyMs?: number;
  createdAt?: string;
  [key: string]: unknown;
}

export interface SrtInputListResponse {
  data: SrtInput[];
}
