/** Shape for `POST /v1/dante/observe`. Local type for the same reason as `../srt/types.ts`. */
export interface DanteObserveResult {
  node?: string;
  channels?: unknown[];
  observedAt?: string;
  [key: string]: unknown;
}
