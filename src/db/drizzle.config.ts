import { defineConfig } from 'drizzle-kit';
import * as dotenv from 'dotenv';

dotenv.config();

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    host: process.env.SQL_HOST || '127.0.0.1',
    user: process.env.SQL_ADMIN_USER || process.env.SQL_USER || 'postgres',
    password: process.env.SQL_ADMIN_PASSWORD || process.env.SQL_PASSWORD || '',
    database: process.env.SQL_DB_NAME || 'postgres',
    ssl: false,
  },
});
