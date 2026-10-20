import React, { useCallback, useEffect, useState } from 'react';
import { Activity, KeyRound, Plus, Trash2 } from 'lucide-react';
import { adminApi } from './adminApi';
import type { AdminAccount, AdminProvider, ProviderPatch } from './types';
import { Banner, Card, Field, formatDateTime, inputClass, Loading, primaryButton, quietButton, StatusBadge, Switch } from './ui';

interface ProviderFormState {
  enabled: boolean;
  model: string;
  baseUrl: string;
  price: string;
  notes: string;
}

function toForm(provider: AdminProvider): ProviderFormState {
  const s = provider.settings;
  return {
    enabled: s.enabled,
    model: s.model ?? '',
    baseUrl: s.baseUrl ?? '',
    price: s.pricePerSecondUsd === null ? '' : String(s.pricePerSecondUsd),
    notes: s.notes ?? '',
  };
}

function validateForm(form: ProviderFormState): Record<string, string> {
  const errors: Record<string, string> = {};
  if (form.model.trim() && !/^[A-Za-z0-9._:/-]{1,100}$/.test(form.model.trim())) errors.model = 'Model chỉ gồm chữ, số, . _ : / - (tối đa 100 ký tự)';
  if (form.baseUrl.trim()) {
    try {
      const url = new URL(form.baseUrl.trim());
      if (url.protocol !== 'https:') errors.baseUrl = 'Base URL phải bắt đầu bằng https://';
    } catch {
      errors.baseUrl = 'Base URL không hợp lệ';
    }
  }
  if (form.price.trim()) {
    const price = Number(form.price);
    if (!Number.isFinite(price) || price < 0 || price > 1000) errors.price = 'Đơn giá phải là số từ 0 đến 1000 (USD/giây)';
  }
  if (form.notes.length > 500) errors.notes = 'Ghi chú tối đa 500 ký tự';
  return errors;
}

function buildPatch(form: ProviderFormState): ProviderPatch {
  return {
    enabled: form.enabled,
    model: form.model.trim() || null,
    baseUrl: form.baseUrl.trim() || null,
    pricePerSecondUsd: form.price.trim() ? Number(form.price) : null,
    notes: form.notes.trim() || null,
  };
}

const AccountRow: React.FC<{ account: AdminAccount; onChanged: () => void; onError: (message: string) => void; onNotice: (message: string) => void }> = ({ account, onChanged, onError, onNotice }) => {
  const [busy, setBusy] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [newCredential, setNewCredential] = useState('');

  const run = async (action: () => Promise<{ ok: boolean; error?: string }>, success?: string) => {
    setBusy(true);
    const result: any = await action();
    setBusy(false);
    if (!result.ok) {
      onError(result.error || 'Thao tác thất bại');
      return false;
    }
    if (success) onNotice(success);
    onChanged();
    return true;
  };

  const handleRotate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCredential.trim()) {
      onError('Vui lòng nhập khóa mới');
      return;
    }
    const sent = newCredential;
    setNewCredential('');
    const done = await run(() => adminApi.rotateCredential(account.id, sent), `Đã thay khóa của "${account.name}"`);
    if (done) setRotating(false);
  };

  const handleDelete = () => {
    if (!window.confirm(`Xóa khóa "${account.name}" khỏi hệ thống? Job đang chạy sẽ được trả về hàng chờ. Thao tác này không thể hoàn tác.`)) return;
    void run(() => adminApi.deleteAccount(account.id), `Đã xóa "${account.name}"`);
  };

  return (
    <li className="py-3 border-t border-slate-100 first:border-t-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="font-oswald font-bold text-sm text-slate-900">{account.name}</span>
        <span className="font-mono text-2xs text-slate-500">{account.maskedIdentifier}</span>
        <StatusBadge online={account.sessionStatus === 'online'} enabled={account.isEnabled} />
        <span className="text-2xs font-mono text-indigo-600 tabular-nums">{account.currentRunningJobs} / {account.maxSlots} slot</span>
      </div>
      <p className="text-2xs text-slate-500 font-roboto mt-1">
        {account.healthReason || 'Chưa có ghi chú sức khỏe'} · Kiểm tra lúc {formatDateTime(account.lastHealthCheck)}
      </p>
      <div className="flex flex-wrap items-center gap-2 mt-2">
        <button disabled={busy} onClick={() => run(() => adminApi.checkHealth(account.id), 'Đã kiểm tra sức khỏe')} className={quietButton}>
          <Activity className="w-3.5 h-3.5 inline mr-1" />Kiểm tra
        </button>
        <button disabled={busy} onClick={() => setRotating(r => !r)} aria-expanded={rotating} className={quietButton}>
          <KeyRound className="w-3.5 h-3.5 inline mr-1" />Thay khóa
        </button>
        <button disabled={busy} onClick={() => run(() => adminApi.patchAccount(account.id, { isEnabled: !account.isEnabled }), account.isEnabled ? 'Đã tắt khóa' : 'Đã bật khóa')} className={quietButton}>
          {account.isEnabled ? 'Tắt' : 'Bật'}
        </button>
        <button disabled={busy} onClick={handleDelete} className="bg-red-50 hover:bg-red-100 disabled:opacity-50 text-red-700 font-oswald text-xs px-3 py-1.5 rounded-lg transition-colors">
          <Trash2 className="w-3.5 h-3.5 inline mr-1" />Xóa
        </button>
      </div>
      {rotating && (
        <form onSubmit={handleRotate} className="mt-3 flex flex-col sm:flex-row gap-2 sm:items-end">
          <div className="flex-1">
            <Field label="Khóa mới" htmlFor={`rotate-${account.id}`}>
              <input
                id={`rotate-${account.id}`}
                type="password"
                autoComplete="off"
                value={newCredential}
                onChange={e => setNewCredential(e.target.value)}
                className={inputClass}
                placeholder="Dán khóa mới, khóa cũ sẽ bị thay thế"
              />
            </Field>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className={primaryButton}>Lưu khóa</button>
            <button type="button" onClick={() => { setRotating(false); setNewCredential(''); }} className={quietButton}>Hủy</button>
          </div>
        </form>
      )}
    </li>
  );
};

const AddKeyForm: React.FC<{ provider: AdminProvider; onAdded: () => void; onError: (message: string) => void; onNotice: (message: string) => void }> = ({ provider, onAdded, onError, onNotice }) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [credential, setCredential] = useState('');
  const [slots, setSlots] = useState('1');
  const [busy, setBusy] = useState(false);

  if (!provider.available) {
    return <p className="text-2xs text-slate-500 font-roboto mt-3">Không thể thêm khóa: {provider.unavailableReason || 'nền tảng chưa khả dụng'}.</p>;
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const slotCount = Number(slots);
    if (!name.trim() || !credential.trim()) return onError('Vui lòng nhập tên gợi nhớ và khóa');
    if (!Number.isInteger(slotCount) || slotCount < 1 || slotCount > 20) return onError('Số slot phải là số nguyên từ 1 đến 20');
    const sent = credential;
    setCredential('');
    setBusy(true);
    const result = await adminApi.addAccount(provider.id, { name: name.trim(), credential: sent, maxSlots: slotCount });
    setBusy(false);
    if (!result.ok) return onError(result.error);
    setName('');
    setSlots('1');
    setOpen(false);
    onNotice(`Đã thêm khóa "${result.data.name}" vào ${provider.label}`);
    onAdded();
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className={`${quietButton} mt-3`}>
        <Plus className="w-3.5 h-3.5 inline mr-1" />Thêm khóa
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-lg grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Field label="Tên gợi nhớ" htmlFor={`add-name-${provider.id}`}>
        <input id={`add-name-${provider.id}`} value={name} maxLength={80} onChange={e => setName(e.target.value)} className={inputClass} placeholder="Ví dụ: Veo dự án A" />
      </Field>
      <Field label="Số slot đồng thời" htmlFor={`add-slots-${provider.id}`}>
        <input id={`add-slots-${provider.id}`} type="number" min={1} max={20} value={slots} onChange={e => setSlots(e.target.value)} className={inputClass} />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Khóa API" htmlFor={`add-key-${provider.id}`} hint={`Định dạng: ${provider.credentialHint}. Khóa được mã hóa ngay khi lưu và không bao giờ hiển thị lại.`}>
          <input id={`add-key-${provider.id}`} type="password" autoComplete="off" value={credential} onChange={e => setCredential(e.target.value)} className={inputClass} placeholder={provider.credentialHint} />
        </Field>
      </div>
      <div className="sm:col-span-2 flex gap-2">
        <button type="submit" disabled={busy} className={primaryButton}>Lưu khóa</button>
        <button type="button" onClick={() => { setOpen(false); setCredential(''); }} className={quietButton}>Hủy</button>
      </div>
    </form>
  );
};

const ProviderCard: React.FC<{ provider: AdminProvider; onChanged: () => void }> = ({ provider, onChanged }) => {
  const [form, setForm] = useState<ProviderFormState>(() => toForm(provider));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const serverKey = JSON.stringify(toForm(provider));

  useEffect(() => {
    setForm(JSON.parse(serverKey));
  }, [serverKey]);

  const dirty = JSON.stringify(form) !== serverKey;
  const id = (suffix: string) => `${provider.id}-${suffix}`;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const found = validateForm(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setError(null);
    const result = await adminApi.updateProvider(provider.id, buildPatch(form));
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setNotice('Đã lưu cấu hình');
    onChanged();
  };

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-lg font-oswald font-bold text-slate-900">{provider.label}</h3>
          <p className="text-2xs text-slate-500 font-roboto mt-0.5">
            {provider.kind === 'api_key' ? 'Kết nối bằng API key' : provider.kind === 'browser_session' ? 'Kết nối bằng phiên trình duyệt' : 'Chế độ demo'} · Hỗ trợ {provider.capabilities.durations.join('/')} giây · tỉ lệ {provider.capabilities.aspectRatios.join(', ')} · tối đa {provider.capabilities.maxRefImages} ảnh tham chiếu
          </p>
        </div>
        {provider.available ? (
          <span className="bg-emerald-100 text-emerald-800 text-2xs font-bold px-2 py-1 rounded">Khả dụng</span>
        ) : (
          <span className="bg-slate-200 text-slate-700 text-2xs font-bold px-2 py-1 rounded">Không khả dụng</span>
        )}
      </div>
      {!provider.available && provider.unavailableReason && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5 font-roboto mb-3">Lý do: {provider.unavailableReason}</p>
      )}

      <form onSubmit={save} className="grid grid-cols-1 md:grid-cols-2 gap-3" noValidate>
        <div className="md:col-span-2">
          <Switch id={id('enabled')} checked={form.enabled} onChange={value => setForm(f => ({ ...f, enabled: value }))} label={form.enabled ? 'Đang bật: cho phép tạo job' : 'Đang tắt: không nhận job mới'} />
        </div>
        <Field label="Model" htmlFor={id('model')} error={errors.model} hint={`Đang dùng: ${provider.settings.effectiveModel || 'không áp dụng'}. Để trống để dùng mặc định.`}>
          <input id={id('model')} aria-invalid={!!errors.model} value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} className={inputClass} placeholder="Mặc định của nền tảng" />
        </Field>
        <Field label="Base URL (https)" htmlFor={id('baseUrl')} error={errors.baseUrl} hint="Để trống để dùng địa chỉ mặc định.">
          <input id={id('baseUrl')} aria-invalid={!!errors.baseUrl} value={form.baseUrl} onChange={e => setForm(f => ({ ...f, baseUrl: e.target.value }))} className={inputClass} placeholder="https://..." />
        </Field>
        <Field label="Đơn giá ước tính (USD / giây video)" htmlFor={id('price')} error={errors.price} hint="Chỉ dùng để ước tính chi phí ở tab Thống kê.">
          <input id={id('price')} inputMode="decimal" aria-invalid={!!errors.price} value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} className={inputClass} placeholder="Ví dụ 0.40" />
        </Field>
        <Field label="Ghi chú" htmlFor={id('notes')} error={errors.notes}>
          <input id={id('notes')} aria-invalid={!!errors.notes} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className={inputClass} maxLength={500} />
        </Field>
        <div className="md:col-span-2 flex items-center gap-3">
          <button type="submit" disabled={busy || !dirty} className={primaryButton}>Lưu cấu hình</button>
          {dirty && <span className="text-2xs text-amber-700 font-roboto">Có thay đổi chưa lưu</span>}
        </div>
      </form>

      <div className="mt-3 space-y-2">
        <Banner kind="error" message={error} onClose={() => setError(null)} />
        <Banner kind="success" message={notice} onClose={() => setNotice(null)} />
      </div>

      <div className="mt-5">
        <h4 className="text-sm font-oswald font-bold text-slate-800 tracking-wide">KHÓA API ({provider.accounts.length})</h4>
        {provider.accounts.length === 0 ? (
          <p className="text-xs text-slate-500 font-roboto mt-2">Chưa có khóa nào.</p>
        ) : (
          <ul className="mt-1">
            {provider.accounts.map(account => (
              <AccountRow key={account.id} account={account} onChanged={onChanged} onError={setError} onNotice={setNotice} />
            ))}
          </ul>
        )}
        <AddKeyForm provider={provider} onAdded={onChanged} onError={setError} onNotice={setNotice} />
      </div>
    </Card>
  );
};

export const ProvidersTab: React.FC = () => {
  const [providers, setProviders] = useState<AdminProvider[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await adminApi.providers();
    if (result.ok) {
      setProviders(result.data);
      setError(null);
    } else {
      setError(result.error);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!providers) return error ? <Banner kind="error" message={error} /> : <Loading />;

  return (
    <div className="space-y-4">
      <Banner kind="error" message={error} />
      {providers.map(provider => (
        <ProviderCard key={provider.id} provider={provider} onChanged={load} />
      ))}
    </div>
  );
};
