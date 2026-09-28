/** Shapes for `/v1/listen/sessions`. Local types for the same reason as `../srt/types.ts`. */
export interface ListenSession {
  id: string;
  title?: string;
  status?: string;
  createdAt?: string;
  [key: string]: unknown;
}

export interface ListenSessionListResponse {
  data: ListenSession[];
}
