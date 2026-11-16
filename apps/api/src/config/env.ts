import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  MONGODB_URI: z.string().min(1),
  APP_URL: z.url().default('http://localhost:5173'), // used in invite / reset links
  DEBUG_MONGO: z.string().optional(),
  JWT_ACCESS_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(900), // 15 min; set 30 in dev to test refresh
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  // Public demo: one-click logins, locked demo accounts, a protected demo workspace.
  DEMO_MODE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // In demo mode, rebuild the demo data once it is older than this. 0 = never.
  DEMO_RESET_HOURS: z.coerce.number().min(0).default(24),
  // The demo accounts' password (the seed and the auto reset). Shown in the README.
  SEED_DEMO_PASSWORD: z.string().min(8).default('Demo1234!'),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment variables:\n' + z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
