import React from 'react';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';

export const inputClass =
  'w-full text-xs font-roboto bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-2 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 aria-[invalid=true]:border-red-400';

export const primaryButton =
  'bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-oswald text-xs px-4 py-2 rounded-lg shadow-2xs transition-colors';

export const quietButton =
  'bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 font-oswald text-xs px-3 py-1.5 rounded-lg transition-colors';

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Chưa có';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Chưa có' : date.toLocaleString('vi-VN');
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return 'Chưa có';
  if (seconds < 90) return `${Math.round(seconds)} giây`;
  if (seconds < 5400) return `${(seconds / 60).toFixed(1)} phút`;
  return `${(seconds / 3600).toFixed(1)} giờ`;
}

export function formatPercent(rate: number | null | undefined): string {
  return rate === null || rate === undefined ? 'Chưa có mẫu' : `${(rate * 100).toFixed(1)}%`;
}

export function formatUsd(value: number | null | undefined): string {
  return value === null || value === undefined ? 'Chưa khai báo đơn giá' : `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const Card: React.FC<{ title?: string; children: React.ReactNode; className?: string }> = ({ title, children, className = '' }) => (
  <section className={`bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-xs ${className}`}>
    {title && <h2 className="text-base font-oswald font-bold text-slate-900 mb-3 tracking-wide">{title}</h2>}
    {children}
  </section>
);

export const Field: React.FC<{ label: string; htmlFor: string; error?: string | null; hint?: string; children: React.ReactNode }> = ({ label, htmlFor, error, hint, children }) => (
  <div>
    <label htmlFor={htmlFor} className="text-2xs font-roboto font-medium text-slate-700 block mb-1">{label}</label>
    {children}
    {error ? (
      <p id={`${htmlFor}-error`} role="alert" className="text-2xs text-red-600 font-roboto mt-1">{error}</p>
    ) : hint ? (
      <p className="text-2xs text-slate-400 font-roboto mt-1">{hint}</p>
    ) : null}
  </div>
);

export const Banner: React.FC<{ kind: 'error' | 'success'; message: string | null; onClose?: () => void }> = ({ kind, message, onClose }) => {
  if (!message) return null;
  const error = kind === 'error';
  return (
    <div
      role={error ? 'alert' : 'status'}
      className={`flex items-start gap-2 p-2.5 rounded-lg text-xs font-roboto border ${error ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-800 border-emerald-200'}`}
    >
      {error ? <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> : <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />}
      <span className="flex-1">{message}</span>
      {onClose && (
        <button onClick={onClose} aria-label="Đóng thông báo" className="shrink-0 opacity-70 hover:opacity-100">
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};

export const Switch: React.FC<{ checked: boolean; onChange: (value: boolean) => void; label: string; id: string }> = ({ checked, onChange, label, id }) => (
  <label htmlFor={id} className="inline-flex items-center gap-2 cursor-pointer text-xs font-roboto text-slate-700">
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${checked ? 'bg-indigo-600' : 'bg-slate-300'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${checked ? 'translate-x-4' : ''}`} />
    </button>
    <span>{label}</span>
  </label>
);

export const StatusBadge: React.FC<{ online: boolean; enabled?: boolean }> = ({ online, enabled = true }) => {
  if (!enabled) return <span className="bg-slate-200 text-slate-700 text-2xs font-bold px-2 py-0.5 rounded">Đã tắt</span>;
  return online ? (
    <span className="bg-emerald-100 text-emerald-800 text-2xs font-bold px-2 py-0.5 rounded inline-flex items-center gap-1">
      <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
      Online
    </span>
  ) : (
    <span className="bg-red-100 text-red-800 text-2xs font-bold px-2 py-0.5 rounded inline-flex items-center gap-1">
      <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-red-500" />
      Offline
    </span>
  );
};

export const Loading: React.FC = () => (
  <div role="status" className="text-center py-12 text-sm font-roboto text-slate-500">Đang tải dữ liệu...</div>
);
