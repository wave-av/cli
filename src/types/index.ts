export interface DeviceAuthResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
}

export interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
}

export interface WaveConfig {
  version: string;
  currentProject: string;
  projects: Record<string, {
    organizationId: string;
    organizationName: string;
    baseUrl?: string;
    region?: string;
  }>;
  defaults: { outputFormat: OutputFormat; protocol?: string; color: "auto" | "on" | "off" };
  telemetry: { enabled: boolean; errorReporting: boolean };
}

export type OutputFormat = "table" | "json" | "yaml";
