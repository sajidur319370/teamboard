import { execSync } from 'node:child_process';
import path from 'node:path';

/** Fresh demo data before every run (the specs move cards and complete sprints). */
export default function globalSetup() {
  if (process.env.E2E_SKIP_SEED) return;
  execSync('npm run seed -w @teamboard/api -- --reset', {
    cwd: path.resolve(import.meta.dirname, '../../..'),
    stdio: 'inherit',
  });
}
