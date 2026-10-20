import React, { useEffect, useRef, useState } from 'react';
import { Shield } from 'lucide-react';
import { AuthInfo, loadVaidLoader, vaidErrorMessage } from '../api';

interface LoginViewProps {
  auth: AuthInfo | null;
  notice: string | null;
  onLoggedIn: () => void;
}

const SDK_URL = 'https://id.vaway.vn/sdk/v1/vaid.js';

export const LoginView: React.FC<LoginViewProps> = ({ auth, notice, onLoggedIn }) => {
  const [error, setError] = useState<string | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const appId = auth?.vaid?.appId;
  const loaderUrl = auth?.vaid?.loaderUrl;

  useEffect(() => {
    if (!appId || !host.current) return;
    if (!document.querySelector(`script[src="${SDK_URL}"]`)) {
      const script = document.createElement('script');
      script.src = SDK_URL;
      script.async = true;
      document.head.appendChild(script);
    }
    const form = document.createElement('vaway-login');
    form.setAttribute('data-app-id', appId);
    host.current.replaceChildren(form);

    const onLogin = () => onLoggedIn();
    const onError = (e: Event) => setError(vaidErrorMessage((e as CustomEvent).detail?.code));
    document.addEventListener('vaid:login', onLogin, true);
    document.addEventListener('vaid:error', onError, true);
    return () => {
      document.removeEventListener('vaid:login', onLogin, true);
      document.removeEventListener('vaid:error', onError, true);
    };
  }, [appId, onLoggedIn]);

  useEffect(() => {
    if (loaderUrl) loadVaidLoader(loaderUrl);
  }, [loaderUrl]);

  const message = error || notice;

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-roboto">
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 w-full max-w-sm space-y-4">
        <h1 className="text-xl font-oswald font-bold text-slate-900 flex items-center gap-2">
          <Shield className="w-5 h-5 text-indigo-600" />
          MUSE BATCH MANAGER
        </h1>
        <p className="text-xs text-slate-500">Đăng nhập bằng tài khoản VAWAY ID để tiếp tục.</p>
        {message && <div className="p-2.5 bg-red-50 text-red-700 text-xs rounded-lg">{message}</div>}
        {auth && !auth.vaid && (
          <div className="p-2.5 bg-amber-50 text-amber-800 text-xs rounded-lg">Máy chủ chưa cấu hình đăng nhập VAWAY ID.</div>
        )}
        <div ref={host} />
      </div>
    </div>
  );
};
