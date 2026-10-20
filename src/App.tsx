import React, { useState, useEffect, useCallback } from 'react';
import { OverviewState, RefImage } from './types';
import { Header } from './components/Header';
import { PersistentRefLibraryBar } from './components/PersistentRefLibraryBar';
import { BatchManagerView } from './components/BatchManagerView';
import { FlowStudioView } from './components/FlowStudioView';
import { RefLibraryModal } from './components/RefLibraryModal';
import { AccountPoolView } from './components/AccountPoolView';
import { ProgressAndLogsView } from './components/ProgressAndLogsView';
import { LoginView } from './components/LoginView';
import { AuthInfo, consumeAuthHash, loadAuthStatus, loadVaidLoader, logout } from './api';

export default function App() {
  const [activeTab, setActiveTab] = useState<'batch' | 'studio' | 'library' | 'accounts' | 'progress'>('batch');
  const [overviewState, setOverviewState] = useState<OverviewState | null>(null);
  const [refImagesList, setRefImagesList] = useState<RefImage[]>([]);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [authState, setAuthState] = useState<'checking' | 'required' | 'ok'>('checking');
  const [authInfo, setAuthInfo] = useState<AuthInfo | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  const checkAuth = useCallback(async () => {
    try {
      const info = await loadAuthStatus();
      setAuthInfo(info);
      if (info?.unavailable) setAuthNotice('Chưa xác minh được quyền với VAWAY ID, vui lòng thử lại sau.');
      setAuthState(info && info.required && !info.authenticated ? 'required' : 'ok');
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    setAuthNotice(consumeAuthHash());
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (authState === 'ok' && authInfo?.authenticated && authInfo.vaid) loadVaidLoader(authInfo.vaid.loaderUrl);
  }, [authState, authInfo]);

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
  if (authState === 'required') return <LoginView auth={authInfo} notice={authNotice} onLoggedIn={checkAuth} />;

  return (
    <div className="min-h-screen bg-slate-50 font-roboto text-slate-900 flex flex-col">
      <Header
        activeTab={activeTab}
        setActiveTab={handleTabChange}
        state={overviewState}
        userName={authInfo?.user?.name}
        onLogout={authInfo?.required ? logout : undefined}
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
