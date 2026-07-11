import { z } from "zod";

/**
 * Environment-backed configuration. Credentials live here only — they are never
 * returned by a tool and never enter the model's context.
 */
const required = (name: string, hint = "") =>
  z
    .string({ required_error: `${name} is required.${hint ? ` ${hint}` : ""}` })
    .min(1, `${name} is required.${hint ? ` ${hint}` : ""}`);

const envSchema = z.object({
  KANPLA_FIREBASE_API_KEY: required(
    "KANPLA_FIREBASE_API_KEY",
    "The public AIza… Firebase client key.",
  ),
  KANPLA_EMAIL: required("KANPLA_EMAIL"),
  KANPLA_PASSWORD: required("KANPLA_PASSWORD"),
  KANPLA_MODULE_ID: z.string().min(1).optional(),
  KANPLA_BASE: z.string().url().default("https://app.kanpla.io"),
  KANPLA_LANGUAGE: z.string().min(1).default("en"),
});

export interface KanplaConfig {
  firebaseApiKey: string;
  email: string;
  password: string;
  moduleId?: string;
  base: string;
  language: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): KanplaConfig {
  // Treat empty-string vars (e.g. `KANPLA_MODULE_ID=` in a copied .env) as unset,
  // so `.optional()` and `.default()` apply and required fields error clearly.
  const cleaned: Record<string, string> = {};
  for (const key of Object.keys(envSchema.shape)) {
    const value = env[key];
    if (typeof value === "string" && value.length > 0) cleaned[key] = value;
  }

  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.message}`)
      .join("\n");
    throw new Error(`Invalid Kanpla configuration:\n${issues}`);
  }
  const e = parsed.data;
  return {
    firebaseApiKey: e.KANPLA_FIREBASE_API_KEY,
    email: e.KANPLA_EMAIL,
    password: e.KANPLA_PASSWORD,
    moduleId: e.KANPLA_MODULE_ID,
    base: e.KANPLA_BASE.replace(/\/+$/, ""),
    language: e.KANPLA_LANGUAGE,
  };
}
