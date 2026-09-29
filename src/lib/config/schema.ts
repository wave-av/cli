import { z } from "zod";

// organizationId/organizationName are optional: `wave auth login` creates the project entry before
// anything has told the CLI which org the key belongs to (the gateway resolves the org from the key
// itself). `wave link` / `wave whoami` fill them in when a served route reports them.
const projectConfigSchema = z.object({
  organizationId: z.string().optional(),
  organizationName: z.string().optional(),
  baseUrl: z.string().url().optional(),
  region: z.string().optional(),
  /** Epoch ms when a device-flow access token expires (absent for API keys, which do not). */
  tokenExpiresAt: z.number().optional(),
});

export const waveConfigSchema = z.object({
  version: z.string().default("1.0.0"),
  currentProject: z.string().default("default"),
  projects: z.record(z.string(), projectConfigSchema).default({}),
  defaults: z
    .object({
      outputFormat: z.enum(["table", "json", "yaml"]).default("table"),
      protocol: z.string().optional(),
      color: z.enum(["auto", "on", "off"]).default("auto"),
    })
    .default({}),
  telemetry: z
    .object({
      enabled: z.boolean().default(false),
      errorReporting: z.boolean().default(false),
    })
    .default({}),
});

export type WaveConfigSchema = z.infer<typeof waveConfigSchema>;

export function getDefaultConfig(): WaveConfigSchema {
  return waveConfigSchema.parse({});
}
