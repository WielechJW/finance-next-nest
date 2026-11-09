import './src/config/environment.js';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'npm run prisma:seed:run',
  },
  datasource: {
    // Generation works without a database; migrations require DATABASE_URL.
    url: process.env.DATABASE_URL,
  },
});
