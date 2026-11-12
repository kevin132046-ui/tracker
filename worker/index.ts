/**
 * The Worker's entry: vinext's app router for requests, plus the Cron trigger (`triggers.crons` in
 * vite.config.ts) that writes 每日彙總 after the US close. The page writes a missed one when it opens.
 */
import app from 'vinext/server/app-router-entry';
import { runDailyDigest } from '@/lib/server/daily-digest';

const worker = {
  ...app,
  async scheduled(controller: ScheduledController, _env: unknown, ctx: ExecutionContext) {
    ctx.waitUntil(runDailyDigest(controller.scheduledTime).then(
      (run) => console.log(`Daily digest: ${run.state}${run.record ? ` (${run.record.day}, ${run.record.status})` : ''}`),
      (error: unknown) => console.warn('Daily digest failed:', error instanceof Error ? error.message : error),
    ));
  },
};

export default worker;
