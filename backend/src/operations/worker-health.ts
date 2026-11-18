import { PrismaService } from '../prisma/prisma.service.js';
import { redisReady } from './operations.service.js';
const prisma = new PrismaService();
try {
  const heartbeat = await prisma.workerHeartbeat.findUnique({
    where: { name: 'market-data' },
  });
  if (
    !heartbeat ||
    Date.now() - heartbeat.updatedAt.getTime() >= 120000 ||
    !(await redisReady())
  )
    process.exitCode = 1;
} catch {
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
