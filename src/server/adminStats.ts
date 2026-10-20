import { sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { videoJobs } from '../db/schema.ts';
import { listProviders } from './providers/index.ts';

const TZ = 'Asia/Ho_Chi_Minh';
const MAX_RANGE_DAYS = 365;
const DAY_MS = 86_400_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function todayInVietnam(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function parseDate(value: string): number | null {
  if (!DATE_PATTERN.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== value) return null;
  return ms;
}

export function resolveRange(fromInput: unknown, toInput: unknown): { ok: true; from: string; to: string } | { ok: false; error: string } {
  const to = typeof toInput === 'string' && toInput ? toInput : todayInVietnam();
  const toMs = parseDate(to);
  if (toMs === null) return { ok: false, error: 'Ngày kết thúc phải có dạng YYYY-MM-DD hợp lệ' };
  const from = typeof fromInput === 'string' && fromInput ? fromInput : new Date(toMs - 29 * DAY_MS).toISOString().slice(0, 10);
  const fromMs = parseDate(from);
  if (fromMs === null) return { ok: false, error: 'Ngày bắt đầu phải có dạng YYYY-MM-DD hợp lệ' };
  if (fromMs > toMs) return { ok: false, error: 'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc' };
  if ((toMs - fromMs) / DAY_MS + 1 > MAX_RANGE_DAYS) return { ok: false, error: `Khoảng thống kê tối đa ${MAX_RANGE_DAYS} ngày` };
  return { ok: true, from, to };
}

const localDate = (column: unknown) => sql`((${column} AT TIME ZONE 'UTC') AT TIME ZONE ${sql.raw(`'${TZ}'`)})::date`;

const rate = (completed: number, failed: number) => (completed + failed > 0 ? completed / (completed + failed) : null);

export async function computeStats(from: string, to: string, prices: Map<string, number | null>) {
  const inRange = sql`${localDate(videoJobs.createdAt)} BETWEEN ${from}::date AND ${to}::date`;

  const totalsRows = await db.execute(sql`
    SELECT count(*)::int AS jobs,
      (count(*) FILTER (WHERE status = 'completed'))::int AS completed,
      (count(*) FILTER (WHERE status = 'failed'))::int AS failed,
      (count(*) FILTER (WHERE status = 'stopped'))::int AS stopped,
      (count(*) FILTER (WHERE status = 'pending'))::int AS pending,
      (count(*) FILTER (WHERE status = 'running'))::int AS running,
      (count(*) FILTER (WHERE attempts > 0))::int AS jobs_with_retry,
      COALESCE(sum(attempts), 0)::int AS extra_attempts
    FROM video_jobs WHERE ${inRange}
  `);
  const totals: any = totalsRows.rows[0];

  const perDayRows = await db.execute(sql`
    SELECT to_char(d, 'YYYY-MM-DD') AS date,
      (SELECT count(*) FROM video_jobs WHERE ${localDate(videoJobs.createdAt)} = d)::int AS created,
      (SELECT count(*) FROM video_jobs WHERE status = 'completed' AND finished_at IS NOT NULL AND ${localDate(videoJobs.finishedAt)} = d)::int AS completed,
      (SELECT count(*) FROM video_jobs WHERE status = 'failed' AND finished_at IS NOT NULL AND ${localDate(videoJobs.finishedAt)} = d)::int AS failed
    FROM generate_series(${from}::date, ${to}::date, interval '1 day') AS g(d)
    ORDER BY d
  `);

  const completeSeconds = sql`extract(epoch FROM (finished_at - started_at))::float8`;
  const hasTiming = sql`status = 'completed' AND started_at IS NOT NULL AND finished_at IS NOT NULL`;
  const perProviderRows = await db.execute(sql`
    SELECT provider_id,
      count(*)::int AS jobs,
      (count(*) FILTER (WHERE status = 'completed'))::int AS completed,
      (count(*) FILTER (WHERE status = 'failed'))::int AS failed,
      COALESCE(sum(duration) FILTER (WHERE status = 'completed'), 0)::int AS video_seconds,
      (avg(${completeSeconds}) FILTER (WHERE ${hasTiming}))::float8 AS avg_seconds,
      (percentile_cont(0.95) WITHIN GROUP (ORDER BY ${completeSeconds}) FILTER (WHERE ${hasTiming}))::float8 AS p95_seconds
    FROM video_jobs WHERE ${inRange}
    GROUP BY provider_id
  `);
  const byProvider = new Map<string, any>(perProviderRows.rows.map((r: any) => [r.provider_id, r]));
  const providerIds = Array.from(new Set([...listProviders().map(p => p.id), ...byProvider.keys()]));
  const perProvider = providerIds.map(providerId => {
    const row = byProvider.get(providerId);
    const completed = row?.completed ?? 0;
    const failed = row?.failed ?? 0;
    const videoSeconds = row?.video_seconds ?? 0;
    const price = prices.get(providerId) ?? null;
    return {
      providerId,
      jobs: row?.jobs ?? 0,
      completed,
      failed,
      successRate: rate(completed, failed),
      videoSeconds,
      estimatedCostUsd: price === null ? null : Math.round(videoSeconds * price * 10000) / 10000,
      avgCompleteSeconds: row?.avg_seconds ?? null,
      p95CompleteSeconds: row?.p95_seconds ?? null,
    };
  });

  const perAccountRows = await db.execute(sql`
    SELECT j.account_id AS account_id, a.name AS name, j.provider_id AS provider_id,
      count(*)::int AS jobs,
      (count(*) FILTER (WHERE j.status = 'completed'))::int AS completed,
      (count(*) FILTER (WHERE j.status = 'failed'))::int AS failed
    FROM video_jobs j LEFT JOIN accounts a ON a.id = j.account_id
    WHERE j.account_id IS NOT NULL AND ${localDate(sql`j.created_at`)} BETWEEN ${from}::date AND ${to}::date
    GROUP BY j.account_id, a.name, j.provider_id
    ORDER BY jobs DESC, j.account_id
  `);

  const topErrorRows = await db.execute(sql`
    SELECT error_code, count(*)::int AS count,
      (array_agg(error_message ORDER BY finished_at DESC NULLS LAST))[1] AS last_message
    FROM video_jobs
    WHERE status = 'failed' AND error_code IS NOT NULL AND ${inRange}
    GROUP BY error_code ORDER BY count DESC, error_code LIMIT 10
  `);

  const queueRows = await db.execute(sql`
    SELECT (count(*) FILTER (WHERE status = 'pending'))::int AS pending,
      (count(*) FILTER (WHERE status = 'running'))::int AS running,
      (extract(epoch FROM (now() - min(created_at) FILTER (WHERE status = 'pending'))))::float8 AS oldest_pending
    FROM video_jobs
  `);
  const queue: any = queueRows.rows[0];

  return {
    range: { from, to },
    totals: {
      jobs: totals.jobs,
      completed: totals.completed,
      failed: totals.failed,
      stopped: totals.stopped,
      pending: totals.pending,
      running: totals.running,
      successRate: rate(totals.completed, totals.failed),
    },
    perDay: perDayRows.rows,
    perProvider,
    perAccount: perAccountRows.rows.map((r: any) => ({
      accountId: r.account_id,
      name: r.name,
      providerId: r.provider_id,
      jobs: r.jobs,
      completed: r.completed,
      failed: r.failed,
    })),
    topErrors: topErrorRows.rows.map((r: any) => ({ errorCode: r.error_code, count: r.count, lastMessage: r.last_message })),
    queue: {
      pending: queue.pending,
      running: queue.running,
      oldestPendingAgeSeconds: queue.oldest_pending === null ? null : Math.max(0, Math.round(queue.oldest_pending)),
    },
    retries: { jobsWithRetry: totals.jobs_with_retry, totalExtraAttempts: totals.extra_attempts },
  };
}
