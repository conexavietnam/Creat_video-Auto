import React, { useEffect, useState } from 'react';
import { ArrowLeft, BarChart3, ClipboardList, LogOut, Server, SlidersHorizontal } from 'lucide-react';
import { adminApi } from './adminApi';
import type { AdminMe } from './types';
import { AuditTab } from './AuditTab';
import { ProvidersTab } from './ProvidersTab';
import { SettingsTab } from './SettingsTab';
import { StatsTab } from './StatsTab';
import { Loading } from './ui';

type TabId = 'providers' | 'settings' | 'stats' | 'audit';

const TABS: Array<{ id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'providers', label: 'Nhà cung cấp', icon: Server },
  { id: 'settings', label: 'Thông số', icon: SlidersHorizontal },
  { id: 'stats', label: 'Thống kê', icon: BarChart3 },
  { id: 'audit', label: 'Nhật ký', icon: ClipboardList },
];

const isTab = (value: string | null): value is TabId => TABS.some(t => t.id === value);

export const AdminNotFound: React.FC = () => (
  <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-roboto">
    <div className="text-center">
      <h1 className="text-5xl font-oswald font-bold text-slate-900">404</h1>
      <p className="text-sm text-slate-600 mt-2">Không tìm thấy trang.</p>
      <a href="/" className="inline-block mt-4 text-sm text-indigo-600 hover:text-indigo-800 underline">Về trang chủ</a>
    </div>
  </div>
);

interface AdminAppProps {
  userName?: string;
  onLogout?: () => void;
}

export const AdminApp: React.FC<AdminAppProps> = ({ userName, onLogout }) => {
  const [me, setMe] = useState<AdminMe | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'notfound'>('loading');
  const [tab, setTab] = useState<TabId>(() => {
    const value = new URLSearchParams(window.location.search).get('tab');
    return isTab(value) ? value : 'providers';
  });

  useEffect(() => {
    (async () => {
      const result = await adminApi.me();
      if (result.ok) {
        setMe(result.data);
        setState('ok');
      } else if (result.status !== 401) {
        setState('notfound');
      }
    })();
  }, []);

  useEffect(() => {
    const onPop = () => {
      const value = new URLSearchParams(window.location.search).get('tab');
      setTab(isTab(value) ? value : 'providers');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const selectTab = (next: TabId) => {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', next);
    window.history.pushState({}, '', url.toString());
  };

  const onTabKey = (e: React.KeyboardEvent, index: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const nextIndex = (index + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
    selectTab(TABS[nextIndex].id);
    document.getElementById(`admin-tab-${TABS[nextIndex].id}`)?.focus();
  };

  if (state === 'loading') return <Loading />;
  if (state === 'notfound') return <AdminNotFound />;

  return (
    <div className="min-h-screen bg-slate-50 font-roboto text-slate-900">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-xs">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 bg-slate-900 rounded-lg flex items-center justify-center text-white font-oswald font-bold shrink-0">Q</div>
            <h1 className="text-lg font-oswald font-bold tracking-tight truncate">QUẢN TRỊ MUSE</h1>
          </div>
          <div className="flex items-center gap-1 sm:gap-3 text-xs">
            <span className="hidden md:inline text-slate-600 max-w-[180px] truncate">{userName || me?.name}</span>
            <a href="/" className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-slate-600 hover:text-slate-900 hover:bg-slate-100">
              <ArrowLeft className="w-4 h-4" />
              <span>Về ứng dụng</span>
            </a>
            {onLogout && (
              <button onClick={onLogout} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-slate-600 hover:text-slate-900 hover:bg-slate-100">
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">Đăng xuất</span>
              </button>
            )}
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-2 sm:px-6 overflow-x-auto">
          <div role="tablist" aria-label="Khu quản trị" className="flex gap-1 min-w-max">
            {TABS.map((t, index) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  id={`admin-tab-${t.id}`}
                  role="tab"
                  aria-selected={active}
                  aria-controls={`admin-panel-${t.id}`}
                  tabIndex={active ? 0 : -1}
                  onClick={() => selectTab(t.id)}
                  onKeyDown={e => onTabKey(e, index)}
                  className={`flex items-center gap-2 px-3 py-2.5 text-sm font-oswald tracking-wide font-medium border-b-2 transition-colors whitespace-nowrap ${
                    active ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-5">
        <div role="tabpanel" id={`admin-panel-${tab}`} aria-labelledby={`admin-tab-${tab}`}>
          {tab === 'providers' && <ProvidersTab />}
          {tab === 'settings' && <SettingsTab />}
          {tab === 'stats' && <StatsTab />}
          {tab === 'audit' && <AuditTab />}
        </div>
      </main>
    </div>
  );
};
