import React, { useState, useEffect } from 'react';
import { OverviewState, RefImage } from './types';
import { Header } from './components/Header';
import { PersistentRefLibraryBar } from './components/PersistentRefLibraryBar';
import { BatchManagerView } from './components/BatchManagerView';
import { FlowStudioView } from './components/FlowStudioView';
import { RefLibraryModal } from './components/RefLibraryModal';
import { AccountPoolView } from './components/AccountPoolView';
import { ProgressAndLogsView } from './components/ProgressAndLogsView';
import { LoginView } from './components/LoginView';

export default function App() {
  const [activeTab, setActiveTab] = useState<'batch' | 'studio' | 'library' | 'accounts' | 'progress'>('batch');
  const [overviewState, setOverviewState] = useState<OverviewState | null>(null);
  const [refImagesList, setRefImagesList] = useState<RefImage[]>([]);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [authState, setAuthState] = useState<'checking' | 'required' | 'ok'>('checking');

  const checkAuth = async () => {
    try {
      const res = await fetch('/api/auth/status');
      const json = await res.json();
      setAuthState(json.data.required && !json.data.authenticated ? 'required' : 'ok');
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

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

  const fetchRefImages = async () => {
    try {
      const res = await fetch('/api/ref-images');
      if (res.status === 401) {
        setAuthState('required');
        return;
      }
      const json = await res.json();
      if (json.success) {
        setRefImagesList(json.data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchOverviewState = async () => {
    try {
      const res = await fetch('/api/state');
      if (res.status === 401) {
        setAuthState('required');
        return;
      }
      const json = await res.json();
      if (json.success) {
        setOverviewState(json.data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (authState !== 'ok') return;
    fetchOverviewState();
    fetchRefImages();
    const stateInterval = setInterval(fetchOverviewState, 2000);
    const refInterval = setInterval(fetchRefImages, 20000);
    return () => {
      clearInterval(stateInterval);
      clearInterval(refInterval);
    };
  }, [authState]);

  if (authState === 'checking') return null;
  if (authState === 'required') return <LoginView onLoggedIn={() => setAuthState('ok')} />;

  return (
    <div className="min-h-screen bg-slate-50 font-roboto text-slate-900 flex flex-col">
      <Header
        activeTab={activeTab}
        setActiveTab={handleTabChange}
        state={overviewState}
      />

      <PersistentRefLibraryBar
        refImages={refImagesList}
        onOpenUploadModal={() => setIsUploadModalOpen(true)}
        onRefreshState={() => {
          fetchRefImages();
          fetchOverviewState();
        }}
      />

      {isUploadModalOpen && (
        <RefLibraryModal
          isModal={true}
          onClose={() => setIsUploadModalOpen(false)}
          onRefreshState={() => {
            fetchRefImages();
            fetchOverviewState();
          }}
        />
      )}

      <main className="flex-1">
        {activeTab === 'batch' && (
          <BatchManagerView
            refImages={refImagesList}
            onRefreshState={() => {
              fetchOverviewState();
              fetchRefImages();
            }}
          />
        )}

        {activeTab === 'studio' && (
          <FlowStudioView
            refImages={refImagesList}
            onRefreshState={() => {
              fetchOverviewState();
              fetchRefImages();
            }}
          />
        )}

        {activeTab === 'library' && (
          <div className="py-4">
            <RefLibraryModal
              onRefreshState={() => {
                fetchRefImages();
                fetchOverviewState();
              }}
            />
          </div>
        )}

        {activeTab === 'accounts' && (
          <AccountPoolView
            onRefreshState={() => {
              fetchOverviewState();
              fetchRefImages();
            }}
          />
        )}

        {activeTab === 'progress' && (
          <ProgressAndLogsView />
        )}
      </main>
    </div>
  );
}
