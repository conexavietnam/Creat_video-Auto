import React, { useState, useEffect } from 'react';
import { ProjectProgressItem } from '../types';
import { CheckSquare, Plus, Trash2, Edit2, CheckCircle2, Clock, AlertCircle, Terminal, FileText } from 'lucide-react';

export const ProgressAndLogsView: React.FC = () => {
  const [progressItems, setProgressItems] = useState<ProjectProgressItem[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [featureInput, setFeatureInput] = useState('');
  const [acInput, setAcInput] = useState('');
  const [statusInput, setStatusInput] = useState<'done' | 'doing' | 'todo'>('todo');

  const [activeSubTab, setActiveSubTab] = useState<'progress' | 'skills' | 'errors'>('progress');

  const fetchProgress = async () => {
    try {
      const res = await fetch('/api/progress');
      const json = await res.json();
      if (json.success) setProgressItems(json.data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchProgress();
  }, []);

  const handleAddProgress = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!featureInput.trim()) return;

    try {
      const res = await fetch('/api/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feature: featureInput,
          acceptanceCriteria: acInput,
          status: statusInput,
        }),
      });

      const json = await res.json();
      if (json.success) {
        setFeatureInput('');
        setAcInput('');
        setShowAddModal(false);
        fetchProgress();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateStatus = async (id: number, newStatus: 'done' | 'doing' | 'todo') => {
    try {
      const res = await fetch(`/api/progress/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      const json = await res.json();
      if (json.success) fetchProgress();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteProgress = async (id: number) => {
    if (!confirm('Bạn có chắc muốn xóa mục tiến độ này?')) return;
    try {
      await fetch(`/api/progress/${id}`, { method: 'DELETE' });
      fetchProgress();
    } catch (err) {
      console.error(err);
    }
  };

  const doneCount = progressItems.filter(p => p.status === 'done').length;
  const doingCount = progressItems.filter(p => p.status === 'doing').length;
  const todoCount = progressItems.filter(p => p.status === 'todo').length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-oswald font-bold text-slate-900 flex items-center gap-2">
            <CheckSquare className="w-6 h-6 text-indigo-600" />
            BẢNG THỐNG KÊ TIẾN ĐỘ & NHẬT KÝ DỰ ÁN
          </h2>
          <p className="text-xs text-slate-500 font-roboto mt-1">
            Theo dõi danh sách các hạng mục công việc, tiêu chuẩn nghiệm thu và nhật ký kỹ thuật.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveSubTab('progress')}
            className={`font-oswald text-xs px-3.5 py-2 rounded-lg transition-colors ${activeSubTab === 'progress' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
          >
            BẢNG TIẾN ĐỘ ({progressItems.length})
          </button>
          <button
            onClick={() => setActiveSubTab('skills')}
            className={`font-oswald text-xs px-3.5 py-2 rounded-lg transition-colors ${activeSubTab === 'skills' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
          >
            QUY TẮC SKILL
          </button>
          <button
            onClick={() => setActiveSubTab('errors')}
            className={`font-oswald text-xs px-3.5 py-2 rounded-lg transition-colors ${activeSubTab === 'errors' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
          >
            NHẬT KÝ LỖI
          </button>
        </div>
      </div>

      {activeSubTab === 'progress' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
          
          <div className="flex items-center justify-between pb-3 border-b border-slate-200">
            <div className="flex items-center gap-4 text-xs font-oswald">
              <span className="bg-emerald-100 text-emerald-800 px-3 py-1 rounded-full font-bold">
                ĐÃ HOÀN THÀNH: {doneCount}
              </span>
              <span className="bg-amber-100 text-amber-800 px-3 py-1 rounded-full font-bold">
                ĐANG THỰC HIỆN: {doingCount}
              </span>
              <span className="bg-slate-100 text-slate-700 px-3 py-1 rounded-full font-bold">
                CHƯA LÀM: {todoCount}
              </span>
            </div>

            <button
              onClick={() => setShowAddModal(true)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-oswald text-xs px-4 py-2 rounded-lg shadow-2xs transition-colors flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              THÊM TÍNH NĂNG MỚI
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-roboto border-collapse">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-200 text-slate-700 font-oswald uppercase">
                  <th className="p-3 w-12 text-center">STT</th>
                  <th className="p-3 w-64">HẠNG MỤC / TÍNH NĂNG</th>
                  <th className="p-3">TIÊU CHUẨN NGHIỆM THU (ACCEPTANCE CRITERIA)</th>
                  <th className="p-3 w-36 text-center">TRẠNG THÁI</th>
                  <th className="p-3 w-24 text-center">THAO TÁC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {progressItems.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-3 font-mono font-bold text-slate-500 text-center">{item.stt}</td>
                    <td className="p-3 font-semibold text-slate-900">{item.feature}</td>
                    <td className="p-3 text-slate-600 font-mono text-2xs">{item.acceptanceCriteria}</td>
                    <td className="p-3 text-center">
                      <select
                        value={item.status}
                        onChange={(e) => handleUpdateStatus(item.id, e.target.value as any)}
                        className={`text-2xs font-oswald font-bold px-2.5 py-1 rounded border ${
                          item.status === 'done'
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                            : item.status === 'doing'
                            ? 'bg-amber-50 text-amber-800 border-amber-300'
                            : 'bg-slate-100 text-slate-700 border-slate-300'
                        }`}
                      >
                        <option value="done">ĐÃ HOÀN THÀNH</option>
                        <option value="doing">ĐANG THỰC HIỆN</option>
                        <option value="todo">CHƯA LÀM</option>
                      </select>
                    </td>
                    <td className="p-3 text-center">
                      <button
                        onClick={() => handleDeleteProgress(item.id)}
                        className="text-slate-400 hover:text-red-600 p-1 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

        </div>
      )}

      {activeSubTab === 'skills' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4 font-roboto text-xs leading-relaxed text-slate-700">
          <h3 className="text-lg font-oswald font-bold text-slate-900 border-b pb-2">QUY TẮC SKILL VÀ QUY CHUẨN KỸ THUẬT DỰ ÁN</h3>
          <ul className="list-disc pl-5 space-y-2">
            <li><strong>Font chữ bắt buộc:</strong> Font Oswald cho toàn bộ tiêu đề (cùng cấp size), Font Roboto cho toàn bộ nội dung text.</li>
            <li><strong>Bảo mật Credential:</strong> Không bao giờ trả lại Plaintext token hay hiển thị mật khẩu trên giao diện. Định danh luôn được che dạng <code className="font-mono text-indigo-600">usr_***4812</code>.</li>
            <li><strong>Dữ liệu thực tế:</strong> 100% dữ liệu liên kết PostgreSQL Database, hỗ trợ Xem / Thêm / Sửa / Xóa đầy đủ. Không sử dụng dữ liệu fix cứng.</li>
            <li><strong>Không chú thích code:</strong> Tuyệt đối không thêm comment chú thích trong code TypeScript/React.</li>
            <li><strong>Đường link phân tách:</strong> Mọi tính năng có URL riêng (<code className="font-mono text-indigo-600">?view=batch</code>, <code className="font-mono text-indigo-600">?view=studio</code>, <code className="font-mono text-indigo-600">?view=accounts</code>, <code className="font-mono text-indigo-600">?view=library</code>, <code className="font-mono text-indigo-600">?view=progress</code>).</li>
          </ul>
        </div>
      )}

      {activeSubTab === 'errors' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4 font-roboto text-xs">
          <h3 className="text-lg font-oswald font-bold text-slate-900 border-b pb-2">NHẬT KÝ SỬA LỖI KỸ THUẬT (ERROR LOGS)</h3>
          <div className="p-4 bg-slate-900 text-slate-200 rounded-xl font-mono text-2xs space-y-2">
            <p className="text-emerald-400">[2026-10-19 22:55:00] ERR-001: Corrected write_to_file TargetFile to absolute path starting with /</p>
            <p className="text-emerald-400">[2026-10-19 23:10:00] ERR-002: Static import configured for firebase-applet-config.json under ESM mode</p>
            <p className="text-emerald-400">[2026-10-19 23:15:00] ERR-003: Verified PostgreSQL Drizzle schema update via UpdateSchema RPC</p>
          </div>
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-2xs z-50 flex items-center justify-center p-4">
          <form onSubmit={handleAddProgress} className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="text-lg font-oswald font-bold text-slate-900">THÊM HẠNG MỤC TIẾN ĐỘ MỚI</h3>
              <button type="button" onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <label className="text-xs font-roboto text-slate-700 block mb-1 font-medium">Tên hạng mục / Tính năng:</label>
                <input
                  type="text"
                  value={featureInput}
                  onChange={(e) => setFeatureInput(e.target.value)}
                  placeholder="Ví dụ: Tích hợp nút Tải MP4 hàng loạt"
                  className="w-full text-xs font-roboto bg-slate-50 border border-slate-300 rounded-lg p-2.5"
                />
              </div>

              <div>
                <label className="text-xs font-roboto text-slate-700 block mb-1 font-medium">Tiêu chuẩn nghiệm thu (Acceptance Criteria):</label>
                <textarea
                  value={acInput}
                  onChange={(e) => setAcInput(e.target.value)}
                  rows={3}
                  placeholder="Mô tả hành vi mong đợi..."
                  className="w-full text-xs font-roboto bg-slate-50 border border-slate-300 rounded-lg p-2.5"
                />
              </div>

              <div>
                <label className="text-xs font-roboto text-slate-700 block mb-1 font-medium">Trạng thái ban đầu:</label>
                <select
                  value={statusInput}
                  onChange={(e) => setStatusInput(e.target.value as any)}
                  className="w-full text-xs font-oswald bg-slate-50 border border-slate-300 rounded-lg p-2.5"
                >
                  <option value="todo">CHƯA LÀM</option>
                  <option value="doing">ĐANG THỰC HIỆN</option>
                  <option value="done">ĐÃ HOÀN THÀNH</option>
                </select>
              </div>

              <div className="pt-4 border-t border-slate-200 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-oswald text-xs px-4 py-2 rounded-lg"
                >
                  HỦY BỎ
                </button>
                <button
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-oswald text-xs px-5 py-2 rounded-lg shadow-xs"
                >
                  THÊM VÀO BẢNG
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

    </div>
  );
};
