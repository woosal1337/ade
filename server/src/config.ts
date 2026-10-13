import { z } from "zod";
import type { WorkosOptions } from "./auth.ts";

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
  DATABASE_URL: z.string().min(1),
  ADE_SITE_URL: z.url().default("https://ade.chele.bi"),
  ADE_PUBLIC_API_URL: z.url().default("https://ade.chele.bi/api"),
  WORKOS_API_KEY: z.string().min(1).optional(),
  WORKOS_CLIENT_ID: z.string().min(1).optional(),
  WORKOS_COOKIE_PASSWORD: z.string().min(32).optional(),
  WORKOS_API_URL: z.url().optional(),
});

export interface Config {
  readonly port: number;
  readonly databaseUrl: string;
  readonly siteUrl: string;
  readonly publicApiUrl: string;
  readonly workos: WorkosOptions | undefined;
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function loadConfig(env: Readonly<Record<string, string | undefined>>): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`The environment is not valid. Check these variables: ${fields}.`);
  }
  const values = parsed.data;
  const workosValues = [
    values.WORKOS_API_KEY,
    values.WORKOS_CLIENT_ID,
    values.WORKOS_COOKIE_PASSWORD,
  ];
  const given = workosValues.filter((value) => value !== undefined).length;
  if (given !== 0 && given !== workosValues.length) {
    throw new Error(
      "Set WORKOS_API_KEY, WORKOS_CLIENT_ID, and WORKOS_COOKIE_PASSWORD together, or none of them.",
    );
  }
  return {
    port: values.PORT,
    databaseUrl: values.DATABASE_URL,
    siteUrl: trimSlash(values.ADE_SITE_URL),
    publicApiUrl: trimSlash(values.ADE_PUBLIC_API_URL),
    workos:
      values.WORKOS_API_KEY !== undefined &&
      values.WORKOS_CLIENT_ID !== undefined &&
      values.WORKOS_COOKIE_PASSWORD !== undefined
        ? {
            apiKey: values.WORKOS_API_KEY,
            clientId: values.WORKOS_CLIENT_ID,
            cookiePassword: values.WORKOS_COOKIE_PASSWORD,
            apiUrl: values.WORKOS_API_URL,
          }
        : undefined,
  };
}
