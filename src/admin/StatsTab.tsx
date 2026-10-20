import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { adminApi } from './adminApi';
import type { AdminStats } from './types';
import { Banner, Card, formatDuration, formatPercent, formatUsd, inputClass, Loading, primaryButton, quietButton } from './ui';

const PROVIDER_NAMES: Record<string, string> = { veo: 'Google Veo', kling: 'Kling AI', flow: 'Google Flow', mock: 'Mô phỏng' };
const name = (id: string) => PROVIDER_NAMES[id] || id;

const StatTile: React.FC<{ label: string; value: string; sub?: string }> = ({ label, value, sub }) => (
  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
    <div className="text-2xs font-roboto text-slate-500">{label}</div>
    <div className="text-xl font-oswald font-bold text-slate-900 tabular-nums mt-0.5">{value}</div>
    {sub && <div className="text-2xs font-roboto text-slate-400 mt-0.5">{sub}</div>}
  </div>
);

const DayChart: React.FC<{ data: AdminStats['perDay'] }> = ({ data }) => {
  const host = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(640);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const update = () => setAvailable(Math.max(280, Math.floor(el.clientWidth)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const height = 180;
  const padding = { top: 12, right: 8, bottom: 26, left: 32 };
  const minSlot = 22;
  const slot = Math.max(minSlot, (available - padding.left - padding.right) / Math.max(1, data.length));
  const width = Math.max(available, data.length * slot + padding.left + padding.right);
  const max = Math.max(1, ...data.map(d => Math.max(d.created, d.completed, d.failed)));
  const plotH = height - padding.top - padding.bottom;
  const barW = Math.min(18, Math.max(3, (slot - 6) / 3));
  const groupW = barW * 3;
  const y = (value: number) => padding.top + plotH - (value / max) * plotH;
  const labelEvery = Math.max(1, Math.ceil(40 / slot));
  const summary = `Biểu đồ cột theo ngày: tạo, hoàn thành, thất bại, ${data.length} ngày, cao nhất ${max} job.`;

  return (
    <div>
      <div className="flex flex-wrap gap-4 text-2xs font-roboto text-slate-600 mb-2" aria-hidden>
        <span><i className="inline-block w-2.5 h-2.5 rounded-sm bg-indigo-500 mr-1" />Đã tạo</span>
        <span><i className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-500 mr-1" />Hoàn thành</span>
        <span><i className="inline-block w-2.5 h-2.5 rounded-sm bg-red-500 mr-1" />Thất bại</span>
      </div>
      <div ref={host} className="overflow-x-auto" tabIndex={0} aria-label="Biểu đồ có thể cuộn ngang">
        <svg role="img" aria-label={summary} viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="block max-w-none">
          {[0, 0.5, 1].map(t => (
            <g key={t}>
              <line x1={padding.left} x2={width - padding.right} y1={y(max * t)} y2={y(max * t)} stroke="#e2e8f0" strokeWidth={1} />
              <text x={padding.left - 6} y={y(max * t) + 3} textAnchor="end" fontSize={9} fill="#64748b">{Math.round(max * t)}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = padding.left + i * slot + (slot - groupW) / 2;
            const bars: Array<[number, string, string]> = [
              [d.created, '#6366f1', 'đã tạo'],
              [d.completed, '#10b981', 'hoàn thành'],
              [d.failed, '#ef4444', 'thất bại'],
            ];
            return (
              <g key={d.date}>
                {bars.map(([value, color, label], j) => (
                  <rect key={label} x={x + j * barW} y={y(value)} width={barW - 1} height={Math.max(0, padding.top + plotH - y(value))} fill={color} rx={1}>
                    <title>{`${d.date}: ${value} ${label}`}</title>
                  </rect>
                ))}
                {i % labelEvery === 0 && (
                  <text x={x + groupW / 2} y={height - 8} textAnchor="middle" fontSize={9} fill="#64748b">{d.date.slice(5)}</text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
};

const TableWrap: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <Card title={title}>
    <div className="overflow-x-auto">{children}</div>
  </Card>
);

const th = 'text-left text-2xs font-oswald font-semibold text-slate-500 uppercase tracking-wide py-2 pr-4 whitespace-nowrap';
const td = 'py-2 pr-4 text-xs font-roboto text-slate-700 tabular-nums whitespace-nowrap';

export const StatsTab: React.FC = () => {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (f?: string, t?: string) => {
    setBusy(true);
    const result = await adminApi.stats(f, t);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setError(null);
    setStats(result.data);
    setFrom(result.data.range.from);
    setTo(result.data.range.to);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const preset = (days: number) => {
    const end = stats ? new Date(`${stats.range.to}T00:00:00Z`) : new Date();
    const start = new Date(end.getTime() - (days - 1) * 86_400_000);
    void load(start.toISOString().slice(0, 10), end.toISOString().slice(0, 10));
  };

  const totalCost = useMemo(() => {
    if (!stats) return null;
    const costs = stats.perProvider.map(p => p.estimatedCostUsd).filter((c): c is number => c !== null);
    return costs.length > 0 ? costs.reduce((a, b) => a + b, 0) : null;
  }, [stats]);

  return (
    <div className="space-y-4">
      <Card>
        <form
          onSubmit={e => {
            e.preventDefault();
            void load(from, to);
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <div>
            <label htmlFor="stats-from" className="text-2xs font-roboto font-medium text-slate-700 block mb-1">Từ ngày</label>
            <input id="stats-from" type="date" value={from} onChange={e => setFrom(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label htmlFor="stats-to" className="text-2xs font-roboto font-medium text-slate-700 block mb-1">Đến ngày</label>
            <input id="stats-to" type="date" value={to} onChange={e => setTo(e.target.value)} className={inputClass} />
          </div>
          <button type="submit" disabled={busy || !from || !to} className={primaryButton}>Xem thống kê</button>
          <div className="flex gap-2">
            <button type="button" onClick={() => preset(7)} className={quietButton}>7 ngày</button>
            <button type="button" onClick={() => preset(30)} className={quietButton}>30 ngày</button>
            <button type="button" onClick={() => preset(90)} className={quietButton}>90 ngày</button>
          </div>
        </form>
        <div className="mt-3">
          <Banner kind="error" message={error} onClose={() => setError(null)} />
        </div>
      </Card>

      {!stats ? (
        error ? null : <Loading />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatTile label="Tổng job" value={String(stats.totals.jobs)} />
            <StatTile label="Hoàn thành" value={String(stats.totals.completed)} />
            <StatTile label="Thất bại" value={String(stats.totals.failed)} />
            <StatTile label="Tỉ lệ thành công" value={formatPercent(stats.totals.successRate)} />
            <StatTile label="Đang chạy / chờ" value={`${stats.queue.running} / ${stats.queue.pending}`} sub={stats.queue.oldestPendingAgeSeconds === null ? 'Không có job chờ' : `Job chờ lâu nhất: ${formatDuration(stats.queue.oldestPendingAgeSeconds)}`} />
            <StatTile label="Ước tính chi phí" value={totalCost === null ? 'Chưa khai báo đơn giá' : formatUsd(totalCost)} />
          </div>

          <p className="text-2xs font-roboto text-slate-500 bg-slate-100 border border-slate-200 rounded-lg p-2.5">
            Chi phí là ước tính theo đơn giá anh khai báo, không phải hóa đơn của nền tảng, chưa gồm lần thử lại thất bại.
          </p>

          <Card title="JOB THEO NGÀY">
            <DayChart data={stats.perDay} />
            <p className="text-2xs text-slate-400 font-roboto mt-2">Cột "đã tạo" tính theo ngày tạo job; "hoàn thành" và "thất bại" tính theo ngày kết thúc (giờ Việt Nam).</p>
          </Card>

          <TableWrap title="THEO NỀN TẢNG">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={th}>Nền tảng</th><th className={th}>Job</th><th className={th}>Hoàn thành</th><th className={th}>Thất bại</th>
                  <th className={th}>Tỉ lệ thành công</th><th className={th}>Giây video</th><th className={th}>Ước tính chi phí</th><th className={th}>TB hoàn thành</th><th className={th}>P95</th>
                </tr>
              </thead>
              <tbody>
                {stats.perProvider.map(p => (
                  <tr key={p.providerId} className="border-t border-slate-100">
                    <td className={`${td} font-medium text-slate-900`}>{name(p.providerId)}</td>
                    <td className={td}>{p.jobs}</td><td className={td}>{p.completed}</td><td className={td}>{p.failed}</td>
                    <td className={td}>{formatPercent(p.successRate)}</td><td className={td}>{p.videoSeconds}</td>
                    <td className={td}>{formatUsd(p.estimatedCostUsd)}</td>
                    <td className={td}>{formatDuration(p.avgCompleteSeconds)}</td><td className={td}>{formatDuration(p.p95CompleteSeconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>

          <TableWrap title="THEO KHÓA API">
            {stats.perAccount.length === 0 ? (
              <p className="text-xs text-slate-500 font-roboto">Chưa có job nào gắn với khóa trong khoảng này.</p>
            ) : (
              <table className="w-full">
                <thead>
                  <tr><th className={th}>Khóa</th><th className={th}>Nền tảng</th><th className={th}>Job</th><th className={th}>Hoàn thành</th><th className={th}>Thất bại</th></tr>
                </thead>
                <tbody>
                  {stats.perAccount.map(a => (
                    <tr key={a.accountId} className="border-t border-slate-100">
                      <td className={`${td} font-medium text-slate-900`}>{a.name || `(đã xóa) #${a.accountId}`}</td>
                      <td className={td}>{name(a.providerId)}</td><td className={td}>{a.jobs}</td><td className={td}>{a.completed}</td><td className={td}>{a.failed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </TableWrap>

          <TableWrap title="LỖI THƯỜNG GẶP">
            {stats.topErrors.length === 0 ? (
              <p className="text-xs text-slate-500 font-roboto">Không có job thất bại trong khoảng này.</p>
            ) : (
              <table className="w-full">
                <thead>
                  <tr><th className={th}>Mã lỗi</th><th className={th}>Số lần</th><th className={`${th} whitespace-normal`}>Thông báo gần nhất</th></tr>
                </thead>
                <tbody>
                  {stats.topErrors.map(e => (
                    <tr key={e.errorCode} className="border-t border-slate-100">
                      <td className={`${td} font-mono`}>{e.errorCode}</td>
                      <td className={td}>{e.count}</td>
                      <td className={`${td} whitespace-normal min-w-[240px]`}>{e.lastMessage || 'Không có'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="text-2xs text-slate-500 font-roboto mt-3">
              Job có thử lại: <strong>{stats.retries.jobsWithRetry}</strong> · Tổng lần thử thêm: <strong>{stats.retries.totalExtraAttempts}</strong>
            </p>
          </TableWrap>
        </>
      )}
    </div>
  );
};
