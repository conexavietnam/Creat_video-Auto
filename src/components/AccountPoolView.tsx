import React, { useState, useEffect } from 'react';
import { Account, ProviderInfo } from '../types';
import { loadProviders } from '../api';
import { Users, Plus, Shield, RefreshCw, Trash2, Power, CheckCircle, AlertTriangle, Key, Activity } from 'lucide-react';

interface AccountPoolProps {
  onRefreshState: () => void;
}

export const AccountPoolView: React.FC<AccountPoolProps> = ({ onRefreshState }) => {
  const [accountsList, setAccountsList] = useState<Account[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [credentialInput, setCredentialInput] = useState('');
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [providerInput, setProviderInput] = useState('');
  const [slotsInput, setSlotsInput] = useState(1);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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
    loadProviders().then(list => {
      setProviders(list);
      const first = list.find(p => p.available);
      if (first) setProviderInput(first.id);
    });
    const interval = setInterval(fetchAccounts, 5000);
    return () => clearInterval(interval);
  }, []);

  const selectedProvider = providers.find(p => p.id === providerInput);

  const handleSlotsChange = async (id: number, value: number) => {
    try {
      await fetch(`/api/accounts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxSlots: value }),
      });
      fetchAccounts();
      onRefreshState();
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameInput.trim() || !credentialInput.trim()) {
      setErrorMsg('Vui lòng điền đầy đủ tên gợi nhớ và thông tin đăng nhập');
      return;
    }

    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nameInput, credential: credentialInput, providerId: providerInput, maxSlots: slotsInput }),
      });

      const json = await res.json();
      if (json.success) {
        setNameInput('');
        setCredentialInput('');
        setShowAddModal(false);
        setErrorMsg(null);
        fetchAccounts();
        onRefreshState();
      } else {
        setErrorMsg(json.error || 'Lỗi khi thêm tài khoản');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Lỗi kết nối máy chủ');
    }
  };

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

  const handleDeleteAccount = async (id: number, name: string) => {
    if (!confirm(`Bạn có chắc muốn xóa tài khoản "${name}" khỏi pool? Các job đang gán cho tài khoản này sẽ được tự động gán lại cho tài khoản khác.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/accounts/${id}`, { method: 'DELETE' });
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
      
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-oswald font-bold text-slate-900 flex items-center gap-2">
            <Users className="w-6 h-6 text-indigo-600" />
            QUẢN LÝ TÀI KHOẢN (ACCOUNT POOL)
          </h2>
          <p className="text-xs text-slate-500 font-roboto mt-1">
            Hệ thống quản lý pool tài khoản chạy đa luồng song song. Thông tin đăng nhập được mã hóa an toàn (encrypted at rest).
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white font-oswald font-medium px-4 py-2.5 rounded-lg shadow-xs transition-colors flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          + THÊM TÀI KHOẢN VÀO POOL
        </button>
      </div>

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

              <div className="flex items-center justify-between">
                <span>Số slot đồng thời:</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  defaultValue={acc.maxSlots}
                  onBlur={(e) => {
                    const value = parseInt(e.target.value);
                    if (value >= 1 && value <= 20 && value !== acc.maxSlots) handleSlotsChange(acc.id, value);
                  }}
                  className="w-14 text-xs font-mono bg-slate-50 border border-slate-300 rounded-md px-2 py-0.5 text-center"
                />
              </div>

              <div className="flex items-center justify-between">
                <span>Khóa bảo mật:</span>
                <span className="font-mono text-2xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                  Đã mã hóa AES-256
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

              <button
                onClick={() => handleDeleteAccount(acc.id, acc.name)}
                className="text-red-500 hover:text-red-700 flex items-center gap-1 font-semibold"
              >
                <Trash2 className="w-3.5 h-3.5" />
                XÓA KHỎI POOL
              </button>
            </div>

          </div>
        ))}
      </div>

      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-2xs z-50 flex items-center justify-center p-4">
          <form onSubmit={handleAddAccount} className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="text-lg font-oswald font-bold text-slate-900 flex items-center gap-2">
                <Shield className="w-5 h-5 text-indigo-600" />
                THÊM TÀI KHOẢN MỚI VÀO POOL
              </h3>
              <button type="button" onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>

            {errorMsg && (
              <div className="mt-3 p-2.5 bg-red-50 text-red-700 text-xs rounded-lg font-roboto">
                {errorMsg}
              </div>
            )}

            <div className="mt-4 space-y-4">
              <div>
                <label className="text-xs font-roboto text-slate-700 block mb-1 font-medium">Nền tảng tạo video:</label>
                <select
                  value={providerInput}
                  onChange={(e) => setProviderInput(e.target.value)}
                  className="w-full text-xs font-roboto bg-slate-50 border border-slate-300 rounded-lg p-2.5"
                >
                  {providers.map(p => (
                    <option key={p.id} value={p.id} disabled={!p.available}>
                      {p.label}{p.available ? '' : ' — chưa khả dụng'}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-roboto text-slate-700 block mb-1 font-medium">Tên gợi nhớ tài khoản:</label>
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="Ví dụ: Tài khoản Studio Pro #4"
                  className="w-full text-xs font-roboto bg-slate-50 border border-slate-300 rounded-lg p-2.5"
                />
              </div>

              <div>
                <label className="text-xs font-roboto text-slate-700 block mb-1 font-medium">Credential / API Key / Session Token:</label>
                <textarea
                  value={credentialInput}
                  onChange={(e) => setCredentialInput(e.target.value)}
                  rows={3}
                  placeholder={selectedProvider ? `Dán ${selectedProvider.credentialHint} vào đây...` : 'Dán token đăng nhập hoặc API key vào đây...'}
                  className="w-full text-xs font-mono bg-slate-50 border border-slate-300 rounded-lg p-2.5"
                />
                <span className="text-2xs text-slate-400 font-roboto mt-1 block">
                  Thông tin sẽ được mã hóa AES-256 ngay khi lưu và không bao giờ xuất hiện dạng plaintext.
                </span>
              </div>

              <div>
                <label className="text-xs font-roboto text-slate-700 block mb-1 font-medium">Số slot đồng thời của tài khoản:</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={slotsInput}
                  onChange={(e) => setSlotsInput(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-24 text-xs font-mono bg-slate-50 border border-slate-300 rounded-lg p-2 text-center"
                />
              </div>

              <div className="pt-4 border-t border-slate-200 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-oswald text-xs px-4 py-2 rounded-lg"
                >
                  HỦY BỎ
                </button>
                <button
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-oswald text-xs px-5 py-2 rounded-lg shadow-xs"
                >
                  LƯU TÀI KHOẢN
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

    </div>
  );
};
