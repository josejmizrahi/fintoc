import { z } from "zod";

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ENCRYPTION_KEY: z.string().min(64),
  FINTOC_API_KEY: z.string().min(1),
  FINTOC_SECRET_KEY: z.string().min(1),
  FINTOC_WEBHOOK_SECRET: z.string().min(1),
  FINTOC_JWS_PRIVATE_KEY: z.string().min(1),
  SYNTAGE_API_KEY: z.string().min(1),
  SYNTAGE_WEBHOOK_SECRET: z.string().min(1),
  ODOO_URL: z.string().url(),
  ODOO_DB: z.string().min(1),
  ODOO_USERNAME: z.string().min(1),
  ODOO_PASSWORD: z.string().min(1),
  RESEND_API_KEY: z.string().min(1),
  CRON_SECRET: z.string().min(1),
});

const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().url(),
});

export function validateEnv() {
  const serverResult = serverSchema.safeParse(process.env);
  const clientResult = clientSchema.safeParse(process.env);

  const errors: string[] = [];

  if (!serverResult.success) {
    for (const issue of serverResult.error.issues) {
      errors.push(`${issue.path.join(".")}: ${issue.message}`);
    }
  }

  if (!clientResult.success) {
    for (const issue of clientResult.error.issues) {
      errors.push(`${issue.path.join(".")}: ${issue.message}`);
    }
  }

  if (errors.length > 0) {
    console.error("Environment validation failed:\n" + errors.join("\n"));
  }
}
