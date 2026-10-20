import React, { useState, useEffect } from 'react';
import { OverviewState } from './types';
import { Header } from './components/Header';
import { BatchManagerView } from './components/BatchManagerView';
import { FlowStudioView } from './components/FlowStudioView';
import { RefLibraryModal } from './components/RefLibraryModal';
import { AccountPoolView } from './components/AccountPoolView';
import { ProgressAndLogsView } from './components/ProgressAndLogsView';

export default function App() {
  const [activeTab, setActiveTab] = useState<'batch' | 'studio' | 'library' | 'accounts' | 'progress'>('batch');
  const [overviewState, setOverviewState] = useState<OverviewState | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const view = params.get('view');
    if (view === 'studio' || view === 'library' || view === 'accounts' || view === 'progress' || view === 'batch') {
      setActiveTab(view);
    }
  }, []);

  const handleTabChange = (tab: 'batch' | 'studio' | 'library' | 'accounts' | 'progress') => {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set('view', tab);
    window.history.pushState({}, '', url.toString());
  };

  const fetchOverviewState = async () => {
    try {
      const res = await fetch('/api/state');
      const json = await res.json();
      if (json.success) {
        setOverviewState(json.data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchOverviewState();
    const interval = setInterval(fetchOverviewState, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 font-roboto text-slate-900 flex flex-col">
      <Header
        activeTab={activeTab}
        setActiveTab={handleTabChange}
        state={overviewState}
      />

      <main className="flex-1">
        {activeTab === 'batch' && (
          <BatchManagerView onRefreshState={fetchOverviewState} />
        )}

        {activeTab === 'studio' && (
          <FlowStudioView onRefreshState={fetchOverviewState} />
        )}

        {activeTab === 'library' && (
          <div className="py-4">
            <RefLibraryModal onRefreshState={fetchOverviewState} />
          </div>
        )}

        {activeTab === 'accounts' && (
          <AccountPoolView onRefreshState={fetchOverviewState} />
        )}

        {activeTab === 'progress' && (
          <ProgressAndLogsView />
        )}
      </main>
    </div>
  );
}
