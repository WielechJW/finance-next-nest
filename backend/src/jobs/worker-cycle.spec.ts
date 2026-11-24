import { runWorkerCycle } from './worker-cycle.js';

describe('worker cycle', () => {
  it('dispatches queued work and updates the heartbeat even when both planners fail', async () => {
    const failure = new Error('planner unavailable');
    const steps = { market: vi.fn().mockRejectedValue(failure), summaries: vi.fn().mockRejectedValue(failure), strategies: vi.fn().mockRejectedValue(failure), dispatch: vi.fn().mockResolvedValue(1), heartbeat: vi.fn() };
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await runWorkerCycle(steps);
      expect(steps.dispatch).toHaveBeenCalledOnce();
      expect(steps.heartbeat).toHaveBeenCalledOnce();
      steps.dispatch.mockRejectedValue(failure);
      await runWorkerCycle(steps);
      expect(steps.heartbeat).toHaveBeenCalledOnce();
    } finally { log.mockRestore(); }
  });
});
