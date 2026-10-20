import React, { useState, useEffect } from 'react';
import { Account } from '../types';
import { Users, Power, Activity, ShieldCheck } from 'lucide-react';

interface AccountPoolProps {
  isSuperAdmin?: boolean;
  onRefreshState: () => void;
}

export const AccountPoolView: React.FC<AccountPoolProps> = ({ isSuperAdmin, onRefreshState }) => {
  const [accountsList, setAccountsList] = useState<Account[]>([]);

  const fetchAccounts = async () => {
    try {
      const res = await fetch('/api/accounts');
      const json = await res.json();
      if (json.success) setAccountsList(json.data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchAccounts();
    const interval = setInterval(fetchAccounts, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleToggleEnable = async (id: number, currentEnabled: boolean) => {
    try {
      const res = await fetch(`/api/accounts/${id}/enable`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isEnabled: !currentEnabled }),
      });
      const json = await res.json();
      if (json.success) {
        fetchAccounts();
        onRefreshState();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleProbeHealth = async (id: number) => {
    try {
      const res = await fetch(`/api/accounts/${id}/health`, { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        fetchAccounts();
        onRefreshState();
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-oswald font-bold text-slate-900 flex items-center gap-2">
            <Users className="w-6 h-6 text-indigo-600" />
            TRẠNG THÁI TÀI KHOẢN (ACCOUNT POOL)
          </h2>
          <p className="text-xs text-slate-500 font-roboto mt-1">
            Danh sách khóa API đang chạy đa luồng song song. Việc thêm, thay hoặc xóa khóa do quản trị viên thực hiện ở khu Quản trị.
          </p>
        </div>

        {isSuperAdmin && (
          <a
            href="/admin"
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-oswald font-medium px-4 py-2.5 rounded-lg shadow-xs transition-colors flex items-center gap-2"
          >
            <ShieldCheck className="w-4 h-4" />
            QUẢN LÝ KHÓA API TẠI QUẢN TRỊ
          </a>
        )}
      </div>

      {accountsList.length === 0 && (
        <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
          <p className="text-sm font-roboto text-slate-500 font-medium">Chưa có tài khoản nào trong pool</p>
          <p className="text-xs font-roboto text-slate-400 mt-1">Liên hệ quản trị viên để thêm khóa API cho nền tảng tạo video.</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {accountsList.map((acc) => (
          <div
            key={acc.id}
            className={`bg-white border rounded-xl p-5 shadow-xs transition-all relative overflow-hidden ${acc.isEnabled ? 'border-slate-200' : 'border-slate-200 opacity-60 bg-slate-50'}`}
          >
            <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-oswald font-bold text-slate-900 text-base">{acc.name}</h3>
                <span className="text-2xs font-mono text-slate-400 block">{acc.maskedIdentifier}</span>
                <span className="text-2xs font-roboto text-indigo-600 block">{acc.providerLabel}</span>
              </div>

              <button
                onClick={() => handleToggleEnable(acc.id, acc.isEnabled)}
                className={`p-2 rounded-lg transition-colors ${acc.isEnabled ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100' : 'bg-slate-200 text-slate-500 hover:bg-slate-300'}`}
                title={acc.isEnabled ? 'Đang BẬT - Bấm để TẮT' : 'Đang TẮT - Bấm để BẬT'}
                aria-label={acc.isEnabled ? 'Tắt tài khoản' : 'Bật tài khoản'}
              >
                <Power className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 text-xs font-roboto text-slate-600 mb-4">
              <div className="flex items-center justify-between">
                <span>Trạng thái phiên:</span>
                {acc.sessionStatus === 'online' ? (
                  <span className="bg-emerald-100 text-emerald-800 text-2xs font-bold px-2 py-0.5 rounded flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                    Online
                  </span>
                ) : (
                  <span className="bg-slate-200 text-slate-700 text-2xs font-bold px-2 py-0.5 rounded">
                    Offline
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between">
                <span>Job đang xử lý:</span>
                <span className="font-mono font-bold text-indigo-600 tabular-nums">
                  {acc.currentRunningJobs} / {acc.maxSlots} slot
                </span>
              </div>

              <div className="pt-2 border-t border-slate-100 text-2xs text-slate-400">
                <span>Ghi chú sức khỏe: {acc.healthReason || 'Bình thường'}</span>
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-100 text-2xs font-oswald">
              <button
                onClick={() => handleProbeHealth(acc.id)}
                className="text-indigo-600 hover:text-indigo-800 flex items-center gap-1 font-semibold"
              >
                <Activity className="w-3.5 h-3.5" />
                KIỂM TRA SỨC KHỎE
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
