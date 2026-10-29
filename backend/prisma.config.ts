import './src/config/environment.js';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Generation works without a database; migrations require DATABASE_URL.
    url: process.env.DATABASE_URL,
  },
});
