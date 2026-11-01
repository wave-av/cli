/** Shape for `POST /v1/whip/publish`. Local type for the same reason as `../srt/types.ts`. */
export interface WhipPublishResult {
  whipUrl: string;
  token: string;
  location?: string;
  sdpAnswer?: string;
  [key: string]: unknown;
}
