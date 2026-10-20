import React, { useState } from 'react';
import { Shield } from 'lucide-react';

interface LoginViewProps {
  onLoggedIn: () => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onLoggedIn }) => {
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const json = await res.json();
      if (json.success) {
        onLoggedIn();
      } else {
        setError(json.error || 'Đăng nhập thất bại');
      }
    } catch {
      setError('Lỗi kết nối máy chủ');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-roboto">
      <form onSubmit={handleSubmit} className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 w-full max-w-sm space-y-4">
        <h1 className="text-xl font-oswald font-bold text-slate-900 flex items-center gap-2">
          <Shield className="w-5 h-5 text-indigo-600" />
          MUSE BATCH MANAGER
        </h1>
        <p className="text-xs text-slate-500">Nhập mã truy cập của workspace để tiếp tục.</p>
        {error && <div className="p-2.5 bg-red-50 text-red-700 text-xs rounded-lg">{error}</div>}
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Mã truy cập"
          autoFocus
          className="w-full text-sm bg-slate-50 border border-slate-300 rounded-lg p-2.5"
        />
        <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-oswald py-2.5 rounded-lg text-sm">
          ĐĂNG NHẬP
        </button>
      </form>
    </div>
  );
};
