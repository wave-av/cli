import { z } from "zod";

const projectConfigSchema = z.object({
  organizationId: z.string(),
  organizationName: z.string(),
  baseUrl: z.string().url().optional(),
  region: z.string().optional(),
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
