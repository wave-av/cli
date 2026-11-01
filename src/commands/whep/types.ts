/** Shape for `POST /v1/whep/subscribe`. Local type for the same reason as `../srt/types.ts`. */
export interface WhepSubscribeResult {
  whepUrl: string;
  token?: string;
  [key: string]: unknown;
}
