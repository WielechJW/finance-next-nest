import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import type { MarketJob } from '../generated/prisma/client.js';
import { MarketJobsService } from './jobs.service.js';

export class MarketWorkerRuntime {
  readonly queue: Queue;
  readonly worker: Worker;
  constructor(
    private readonly jobs: MarketJobsService,
    connection: ConnectionOptions,
    handler: (job: MarketJob) => Promise<unknown>,
    queueName = 'finance-market-data',
    private readonly kinds?: string[],
  ) {
    this.queue = new Queue(queueName, { connection });
    this.worker = new Worker(
      queueName,
      async (job) => {
        const id: unknown = (job.data as { id?: unknown }).id;
        if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id))
          throw new Error('invalid_job');
        const claimed = await jobs.begin(id);
        if (!claimed?.runToken) return;
        const runToken = claimed.runToken;
        const heartbeat = setInterval(() => {
          void jobs.heartbeat(id, runToken).catch(() => {});
        }, 30000);
        heartbeat.unref();
        try {
          const result = await handler(claimed);
          if (
            result &&
            typeof result === 'object' &&
            'retryAt' in result &&
            result.retryAt instanceof Date
          )
            await jobs.defer(id, runToken, result.retryAt);
          else await jobs.complete(id, runToken);
        } catch (error) {
          await jobs.fail(id, runToken, error);
          throw new Error('job_failed');
        } finally {
          clearInterval(heartbeat);
        }
      },
      { connection, concurrency: 1, limiter: { max: 1, duration: 3200 } },
    );
    // Connection errors must not log credential-bearing Redis URLs.
    this.queue.on('error', () => {});
    this.worker.on('error', () => {});
    this.worker.on('failed', () => {});
  }
  async dispatch() {
    return this.jobs.dispatch(this.queue, new Date(), this.kinds);
  }
  async close() {
    await this.worker.close();
    await this.queue.close();
  }
}
