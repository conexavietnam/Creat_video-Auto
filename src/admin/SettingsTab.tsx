import React, { useEffect, useState } from 'react';
import { adminApi } from './adminApi';
import type { AdminProvider, AdminSettings } from './types';
import { Banner, Card, Field, inputClass, Loading, primaryButton, Switch } from './ui';

const DURATIONS = [4, 5, 6, 8, 10, 15];
const RATIOS: Array<AdminSettings['defaultAspectRatio']> = ['9:16', '16:9', '1:1'];

interface Form {
  concurrencyLimit: string;
  maxRetries: string;
  timeoutMinutes: string;
  defaultDuration: string;
  defaultAspectRatio: AdminSettings['defaultAspectRatio'];
  defaultProviderId: string;
  autoEnqueueOnPaste: boolean;
}

const toForm = (s: AdminSettings): Form => ({
  concurrencyLimit: String(s.concurrencyLimit),
  maxRetries: String(s.maxRetries),
  timeoutMinutes: String(s.timeoutMinutes),
  defaultDuration: String(s.defaultDuration),
  defaultAspectRatio: s.defaultAspectRatio,
  defaultProviderId: s.defaultProviderId,
  autoEnqueueOnPaste: s.autoEnqueueOnPaste,
});

function checkInt(value: string, min: number, max: number, label: string): string | null {
  const n = Number(value);
  return value.trim() !== '' && Number.isInteger(n) && n >= min && n <= max ? null : `${label} phải là số nguyên từ ${min} đến ${max}`;
}

export const SettingsTab: React.FC = () => {
  const [saved, setSaved] = useState<AdminSettings | null>(null);
  const [providers, setProviders] = useState<AdminProvider[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [settings, list] = await Promise.all([adminApi.settings(), adminApi.providers()]);
      if (!settings.ok) return setError(settings.error);
      setSaved(settings.data);
      setForm(toForm(settings.data));
      if (list.ok) setProviders(list.data);
    })();
  }, []);

  if (!form || !saved) return error ? <Banner kind="error" message={error} /> : <Loading />;

  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(saved));
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm(f => (f ? { ...f, [key]: value } : f));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const found: Record<string, string> = {};
    const checks: Array<[keyof Form, string | null]> = [
      ['concurrencyLimit', checkInt(form.concurrencyLimit, 1, 50, 'Số luồng')],
      ['maxRetries', checkInt(form.maxRetries, 0, 10, 'Số lần retry')],
      ['timeoutMinutes', checkInt(form.timeoutMinutes, 1, 240, 'Thời gian timeout')],
    ];
    for (const [key, message] of checks) if (message) found[key] = message;
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    setError(null);
    const result = await adminApi.saveSettings({
      concurrencyLimit: Number(form.concurrencyLimit),
      maxRetries: Number(form.maxRetries),
      timeoutMinutes: Number(form.timeoutMinutes),
      defaultDuration: Number(form.defaultDuration),
      defaultAspectRatio: form.defaultAspectRatio,
      defaultProviderId: form.defaultProviderId,
      autoEnqueueOnPaste: form.autoEnqueueOnPaste,
    });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setSaved(result.data);
    setForm(toForm(result.data));
    setNotice('Đã lưu thông số hệ thống, có hiệu lực ngay cho các lần gán job tiếp theo');
  };

  return (
    <Card title="THÔNG SỐ HỆ THỐNG">
      <form onSubmit={submit} noValidate className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
        <Field label="Số luồng song song (1–50)" htmlFor="set-concurrency" error={errors.concurrencyLimit} hint="Giới hạn tối đa; số luồng thực tế còn bị chặn bởi tổng slot của các khóa Online.">
          <input id="set-concurrency" inputMode="numeric" aria-invalid={!!errors.concurrencyLimit} value={form.concurrencyLimit} onChange={e => set('concurrencyLimit', e.target.value)} className={inputClass} />
        </Field>
        <Field label="Số lần thử lại tối đa (0–10)" htmlFor="set-retries" error={errors.maxRetries}>
          <input id="set-retries" inputMode="numeric" aria-invalid={!!errors.maxRetries} value={form.maxRetries} onChange={e => set('maxRetries', e.target.value)} className={inputClass} />
        </Field>
        <Field label="Timeout khi không có tiến độ (phút, 1–240)" htmlFor="set-timeout" error={errors.timeoutMinutes}>
          <input id="set-timeout" inputMode="numeric" aria-invalid={!!errors.timeoutMinutes} value={form.timeoutMinutes} onChange={e => set('timeoutMinutes', e.target.value)} className={inputClass} />
        </Field>
        <Field label="Nền tảng mặc định" htmlFor="set-provider">
          <select id="set-provider" value={form.defaultProviderId} onChange={e => set('defaultProviderId', e.target.value)} className={inputClass}>
            <option value="auto">Tự động chọn</option>
            {providers.map(p => (
              <option key={p.id} value={p.id}>{p.label}{p.available ? '' : ' (không khả dụng)'}</option>
            ))}
          </select>
        </Field>
        <Field label="Thời lượng mặc định" htmlFor="set-duration">
          <select id="set-duration" value={form.defaultDuration} onChange={e => set('defaultDuration', e.target.value)} className={inputClass}>
            {DURATIONS.map(d => (
              <option key={d} value={d}>{d} giây</option>
            ))}
          </select>
        </Field>
        <Field label="Tỉ lệ khung hình mặc định" htmlFor="set-ratio">
          <select id="set-ratio" value={form.defaultAspectRatio} onChange={e => set('defaultAspectRatio', e.target.value as Form['defaultAspectRatio'])} className={inputClass}>
            {RATIOS.map(r => (
              <option key={r} value={r}>{r === '9:16' ? '9:16 · Dọc' : r === '16:9' ? '16:9 · Ngang' : '1:1 · Vuông'}</option>
            ))}
          </select>
        </Field>
        <div className="md:col-span-2">
          <Switch id="set-auto" checked={form.autoEnqueueOnPaste} onChange={value => set('autoEnqueueOnPaste', value)} label="Dán là chạy luôn (tự thêm prompt vào hàng đợi sau khi dán)" />
        </div>
        <div className="md:col-span-2 flex items-center gap-3">
          <button type="submit" disabled={busy || !dirty} className={primaryButton}>Lưu thông số</button>
          {dirty && <span className="text-2xs text-amber-700 font-roboto">Có thay đổi chưa lưu</span>}
        </div>
        <div className="md:col-span-2 space-y-2">
          <Banner kind="error" message={error} onClose={() => setError(null)} />
          <Banner kind="success" message={notice} onClose={() => setNotice(null)} />
        </div>
      </form>
    </Card>
  );
};
