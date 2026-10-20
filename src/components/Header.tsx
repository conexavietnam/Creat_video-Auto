import React from 'react';
import { OverviewState } from '../types';
import { Layers, Workflow, Image as ImageIcon, Users, CheckSquare, Play, Clock, CheckCircle2, Wifi, LogOut, ShieldCheck } from 'lucide-react';

interface HeaderProps {
  activeTab: 'batch' | 'studio' | 'library' | 'accounts' | 'progress';
  setActiveTab: (tab: 'batch' | 'studio' | 'library' | 'accounts' | 'progress') => void;
  state: OverviewState | null;
  userName?: string;
  showAdminLink?: boolean;
  onLogout?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ activeTab, setActiveTab, state, userName, showAdminLink, onLogout }) => {
  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16 gap-4">
        
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-9 h-9 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-oswald text-xl font-bold shadow-xs">
            M
          </div>
          <a
            href="?view=batch"
            onClick={(e) => { e.preventDefault(); setActiveTab('batch'); }}
            className="text-xl font-oswald font-bold tracking-tight text-slate-900 hover:text-indigo-600 transition-colors shrink-0"
          >
            MUSE BATCH MANAGER
          </a>
        </div>

        <nav className="flex items-center gap-1 sm:gap-2">
          <button
            onClick={() => setActiveTab('batch')}
            className={`flex items-center gap-2 px-3 py-2 text-sm font-oswald tracking-wide font-medium rounded-md transition-colors whitespace-nowrap ${
              activeTab === 'batch'
                ? 'bg-indigo-50 text-indigo-700 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <Layers className="w-4 h-4" />
            Hàng Đợi
          </button>

          <button
            onClick={() => setActiveTab('studio')}
            className={`flex items-center gap-2 px-3 py-2 text-sm font-oswald tracking-wide font-medium rounded-md transition-colors whitespace-nowrap ${
              activeTab === 'studio'
                ? 'bg-indigo-50 text-indigo-700 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <Workflow className="w-4 h-4" />
            Studio Kéo Thả
          </button>

          <button
            onClick={() => setActiveTab('library')}
            className={`flex items-center gap-2 px-3 py-2 text-sm font-oswald tracking-wide font-medium rounded-md transition-colors whitespace-nowrap ${
              activeTab === 'library'
                ? 'bg-indigo-50 text-indigo-700 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <ImageIcon className="w-4 h-4" />
            Kho Ảnh (@tag)
            {state?.refImageCount !== undefined && (
              <span className="text-xs bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded-full font-roboto font-normal">
                {state.refImageCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('accounts')}
            className={`flex items-center gap-2 px-3 py-2 text-sm font-oswald tracking-wide font-medium rounded-md transition-colors whitespace-nowrap ${
              activeTab === 'accounts'
                ? 'bg-indigo-50 text-indigo-700 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <Users className="w-4 h-4" />
            Tài Khoản
          </button>

          <button
            onClick={() => setActiveTab('progress')}
            className={`flex items-center gap-2 px-3 py-2 text-sm font-oswald tracking-wide font-medium rounded-md transition-colors whitespace-nowrap ${
              activeTab === 'progress'
                ? 'bg-indigo-50 text-indigo-700 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <CheckSquare className="w-4 h-4" />
            Tiến Độ
          </button>

          {showAdminLink && (
            <a
              href="/admin"
              className="flex items-center gap-2 px-3 py-2 text-sm font-oswald tracking-wide font-medium rounded-md transition-colors whitespace-nowrap text-slate-600 hover:text-slate-900 hover:bg-slate-100"
            >
              <ShieldCheck className="w-4 h-4" />
              Quản trị
            </a>
          )}
        </nav>

        <div className="hidden lg:flex items-center gap-3 shrink-0 text-xs font-roboto">
          <div className="flex items-center gap-1.5 bg-amber-50 text-amber-800 border border-amber-200/80 px-2.5 py-1 rounded-md">
            <Play className="w-3.5 h-3.5 text-amber-600 fill-amber-600" />
            <span>Đang chạy: <strong className="tabular-nums font-bold">{state?.counts.running || 0}</strong></span>
          </div>

          <div className="flex items-center gap-1.5 bg-slate-100 text-slate-700 px-2.5 py-1 rounded-md">
            <Clock className="w-3.5 h-3.5 text-slate-500" />
            <span>Chờ: <strong className="tabular-nums font-bold">{state?.counts.pending || 0}</strong></span>
          </div>

          <div className="flex items-center gap-1.5 bg-emerald-50 text-emerald-800 border border-emerald-200/80 px-2.5 py-1 rounded-md">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            <span>Xong: <strong className="tabular-nums font-bold">{state?.counts.completed || 0}</strong></span>
          </div>

          <div className="flex items-center gap-1.5 bg-indigo-50 text-indigo-800 border border-indigo-200/80 px-2.5 py-1 rounded-md">
            <Wifi className="w-3.5 h-3.5 text-indigo-600" />
            <span>Online: <strong className="tabular-nums font-bold">{state?.onlineAccounts || 0}/{state?.totalAccounts || 0}</strong></span>
          </div>
        </div>

        {onLogout && (
          <div className="flex items-center gap-2 shrink-0 text-xs font-roboto">
            {userName && <span className="hidden md:inline text-slate-600 max-w-[140px] truncate">{userName}</span>}
            <button
              onClick={onLogout}
              title="Đăng xuất khỏi VAWAY ID"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span>Đăng xuất</span>
            </button>
          </div>
        )}

      </div>
    </header>
  );
};
