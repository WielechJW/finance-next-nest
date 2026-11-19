// A failed planner must leave the durable outbox available for delivery.
export async function runWorkerCycle(steps: {
  market(): Promise<unknown>;
  summaries(): Promise<unknown>;
  dispatch(): Promise<unknown>;
  heartbeat(): Promise<unknown>;
}) {
  try { await steps.market(); } catch { console.error('Błąd planowania danych rynkowych.'); }
  try { await steps.summaries(); } catch { console.error('Błąd planowania podsumowań.'); }
  try {
    await steps.dispatch();
    await steps.heartbeat();
  } catch { console.error('Błąd przekazania kolejki lub zapisu stanu workera.'); }
}
