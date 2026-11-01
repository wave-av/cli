/** Shapes for `/v1/crest/sessions`. Local types for the same reason as `../srt/types.ts`. */
export interface CrestSession {
  id: string;
  title?: string;
  status?: string;
  createdAt?: string;
  [key: string]: unknown;
}

export interface CrestSessionListResponse {
  data: CrestSession[];
}
