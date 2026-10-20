import React, { useCallback, useEffect, useState } from 'react';
import { adminApi } from './adminApi';
import type { AuditItem } from './types';
import { Banner, Card, formatDateTime, Loading, quietButton } from './ui';

const ACTIONS: Record<string, string> = {
  'account.add': 'Thêm khóa API',
  'account.rotate': 'Thay khóa API',
  'account.update': 'Sửa khóa API',
  'account.delete': 'Xóa khóa API',
  'provider.update': 'Sửa cấu hình nền tảng',
  'settings.update': 'Sửa thông số hệ thống',
};

export const AuditTab: React.FC = () => {
  const [items, setItems] = useState<AuditItem[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (before?: number) => {
    setBusy(true);
    const result = await adminApi.audit(before);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setError(null);
    setItems(prev => (before && prev ? [...prev, ...result.data.items] : result.data.items));
    setNext(result.data.nextBefore);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!items) return error ? <Banner kind="error" message={error} /> : <Loading />;

  return (
    <Card title="NHẬT KÝ QUẢN TRỊ">
      <Banner kind="error" message={error} onClose={() => setError(null)} />
      {items.length === 0 ? (
        <p className="text-xs text-slate-500 font-roboto">Chưa có thao tác nào được ghi lại.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                {['Thời gian', 'Người thực hiện', 'Hành động', 'Đối tượng', 'Giá trị trước / sau'].map(h => (
                  <th key={h} className="text-left text-2xs font-oswald font-semibold text-slate-500 uppercase tracking-wide py-2 pr-4 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id} className="border-t border-slate-100 align-top">
                  <td className="py-2 pr-4 text-xs font-roboto text-slate-700 whitespace-nowrap">{formatDateTime(item.at)}</td>
                  <td className="py-2 pr-4 text-xs font-mono text-slate-700 whitespace-nowrap">VAWAY ID {item.actorVaid}</td>
                  <td className="py-2 pr-4 text-xs font-roboto font-medium text-slate-900 whitespace-nowrap">{ACTIONS[item.action] || item.action}</td>
                  <td className="py-2 pr-4 text-xs font-mono text-slate-600 whitespace-nowrap">{item.target || '—'}</td>
                  <td className="py-2 pr-4 text-2xs font-mono text-slate-600 min-w-[220px]">
                    {item.detail ? (
                      <details>
                        <summary className="cursor-pointer text-indigo-600 font-roboto">Xem chi tiết</summary>
                        <pre className="mt-1 whitespace-pre-wrap break-all bg-slate-50 border border-slate-200 rounded p-2">{JSON.stringify(item.detail, null, 2)}</pre>
                      </details>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {next !== null && (
        <div className="mt-4 text-center">
          <button onClick={() => load(next)} disabled={busy} className={quietButton}>{busy ? 'Đang tải...' : 'Tải thêm'}</button>
        </div>
      )}
    </Card>
  );
};
