import React, { useState, useEffect, useRef } from 'react';
import { VideoJob, RefImage, AppSettings } from '../types';
import { Play, Square, Plus, Trash2, Search, Download, ChevronLeft, ChevronRight, AlertTriangle, CheckCircle, Clock, AlertCircle, RefreshCw, X, FileText, Settings, Sparkles, Layers } from 'lucide-react';

interface BatchManagerProps {
  onRefreshState: () => void;
}

export const BatchManagerView: React.FC<BatchManagerProps> = ({ onRefreshState }) => {
  const [promptText, setPromptText] = useState('');
  const [splitMode, setSplitMode] = useState<'line' | 'paragraph' | 'all'>('line');
  const [promptCount, setPromptCount] = useState(0);

  const [duration, setDuration] = useState<number>(10);
  const [aspectRatio, setAspectRatio] = useState<'9:16' | '16:9' | '1:1'>('9:16');
  const [concurrency, setConcurrency] = useState<number>(3);
  const [autoPasteEnqueue, setAutoPasteEnqueue] = useState<boolean>(true);
  const [batchRefTag, setBatchRefTag] = useState<string>('');

  const [refImagesList, setRefImagesList] = useState<RefImage[]>([]);
  const [detectedTags, setDetectedTags] = useState<string[]>([]);
  const [missingTags, setMissingTags] = useState<string[]>([]);

  const [showMentionDropdown, setShowMentionDropdown] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [lastAddedJobIds, setLastAddedJobIds] = useState<string[]>([]);

  const [runningStripJobs, setRunningStripJobs] = useState<any[]>([]);
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [activeFilterTab, setActiveFilterTab] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalJobCount, setTotalJobCount] = useState(0);
  const [counts, setCounts] = useState({ all: 0, pending: 0, running: 0, completed: 0, failed: 0, stopped: 0 });

  const [effectiveConcurrency, setEffectiveConcurrency] = useState<number>(3);
  const [concurrencyLimit, setConcurrencyLimit] = useState<number>(3);
  const [onlineAccountsCount, setOnlineAccountsCount] = useState<number>(0);

  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [activePlayingJobId, setActivePlayingJobId] = useState<string | null>(null);

  const pasteTimerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchRefImages = async () => {
    try {
      const res = await fetch('/api/ref-images');
      const json = await res.json();
      if (json.success) setRefImagesList(json.data);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/settings');
      const json = await res.json();
      if (json.success) {
        const s: AppSettings = json.data;
        setConcurrency(s.concurrencyLimit);
        setAutoPasteEnqueue(s.autoEnqueueOnPaste);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchJobs = async () => {
    try {
      const queryParams = new URLSearchParams({
        status: activeFilterTab,
        search: searchTerm,
        page: currentPage.toString(),
        limit: '10',
      });

      const res = await fetch(`/api/queue/jobs?${queryParams}`);
      const json = await res.json();
      if (json.success) {
        setJobs(json.data);
        setCurrentPage(json.pagination.page);
        setTotalPages(json.pagination.totalPages);
        setTotalJobCount(json.pagination.total);
      }

      const stateRes = await fetch('/api/state');
      const stateJson = await stateRes.json();
      if (stateJson.success) {
        setCounts(stateJson.data.counts);
        setRunningStripJobs(stateJson.data.runningJobs || []);
        setEffectiveConcurrency(stateJson.data.effectiveConcurrency || 1);
        setConcurrencyLimit(stateJson.data.concurrencyLimit || 3);
        setOnlineAccountsCount(stateJson.data.onlineAccounts || 0);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchRefImages();
    fetchSettings();
  }, []);

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 2000);
    return () => clearInterval(interval);
  }, [activeFilterTab, searchTerm, currentPage]);

  useEffect(() => {
    const handler = setTimeout(() => {
      if (!promptText.trim()) {
        setPromptCount(0);
        setDetectedTags([]);
        setMissingTags([]);
        return;
      }

      let count = 0;
      if (splitMode === 'paragraph') {
        count = promptText.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0).length;
      } else if (splitMode === 'all') {
        count = 1;
      } else {
        count = promptText.split('\n').map(p => p.trim()).filter(p => p.length > 0).length;
      }

      setPromptCount(count);

      const matches = promptText.match(/@([a-z0-9-_]+)/gi) || [];
      const tags = Array.from(new Set(matches.map(m => m.substring(1).toLowerCase())));
      
      const availableTags = refImagesList.map(i => i.tag);
      const valid = tags.filter(t => availableTags.includes(t));
      const missing = tags.filter(t => !availableTags.includes(t));

      setDetectedTags(valid);
      setMissingTags(missing);
    }, 200);

    return () => clearTimeout(handler);
  }, [promptText, splitMode, refImagesList]);

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setPromptText(val);

    const cursorPos = e.target.selectionStart;
    const textBefore = val.substring(0, cursorPos);
    const lastAtIdx = textBefore.lastIndexOf('@');

    if (lastAtIdx !== -1 && !/\s/.test(textBefore.substring(lastAtIdx))) {
      const filterStr = textBefore.substring(lastAtIdx + 1).toLowerCase();
      setMentionFilter(filterStr);
      setShowMentionDropdown(true);
    } else {
      setShowMentionDropdown(false);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!autoPasteEnqueue) return;
    const pasted = e.clipboardData.getData('text');
    if (!pasted || !pasted.trim()) return;

    if (pasteTimerRef.current) clearTimeout(pasteTimerRef.current);

    pasteTimerRef.current = setTimeout(() => {
      enqueuePrompts(pasted);
    }, 2000);
  };

  const selectMention = (tag: string) => {
    if (!textareaRef.current) return;
    const val = promptText;
    const cursorPos = textareaRef.current.selectionStart;
    const textBefore = val.substring(0, cursorPos);
    const textAfter = val.substring(cursorPos);

    const lastAtIdx = textBefore.lastIndexOf('@');
    if (lastAtIdx !== -1) {
      const newBefore = textBefore.substring(0, lastAtIdx) + `@${tag} `;
      setPromptText(newBefore + textAfter);
    }

    setShowMentionDropdown(false);
    textareaRef.current.focus();
  };

  const enqueuePrompts = async (textToEnqueue?: string) => {
    const targetText = textToEnqueue || promptText;
    if (!targetText || !targetText.trim()) return;

    try {
      const res = await fetch('/api/queue/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawText: targetText,
          splitMode,
          duration,
          aspectRatio,
          concurrency,
          batchRefTag: batchRefTag || undefined,
        }),
      });

      const json = await res.json();
      if (json.success) {
        const addedCount = json.count;
        const newIds = json.jobs.map((j: any) => j.id);
        setLastAddedJobIds(newIds);
        setToastMsg(`Đã tự động thêm ${addedCount} prompt vào hàng đợi!`);
        
        if (!textToEnqueue) {
          setPromptText('');
        }

        fetchJobs();
        onRefreshState();

        setTimeout(() => setToastMsg(null), 5000);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleUndoLastAdded = async () => {
    if (lastAddedJobIds.length === 0) return;
    try {
      for (const id of lastAddedJobIds) {
        await fetch(`/api/queue/jobs/${id}`, { method: 'DELETE' });
      }
      setToastMsg('Đã hoàn tác đợt thêm prompt!');
      setLastAddedJobIds([]);
      fetchJobs();
      onRefreshState();
      setTimeout(() => setToastMsg(null), 3000);
    } catch (err) {
      console.error(err);
    }
  };

  const handleStartQueue = async () => {
    if (onlineAccountsCount === 0) {
      setToastMsg('Không còn tài khoản Online nào trong pool! Vui lòng bật hoặc thêm tài khoản để chạy hàng đợi.');
      return;
    }

    try {
      const res = await fetch('/api/queue/process', { method: 'POST' });
      const json = await res.json();
      if (!json.success) {
        setToastMsg(json.error || 'Lỗi khi khởi động dispatcher');
        return;
      }
      fetchJobs();
      onRefreshState();
    } catch (err: any) {
      setToastMsg(err.message || 'Lỗi kết nối máy chủ');
    }
  };

  const handleStopAll = async () => {
    try {
      await fetch('/api/queue/stop-all', { method: 'POST' });
      fetchJobs();
      onRefreshState();
    } catch (err) {
      console.error(err);
    }
  };

  const handleClearFinished = async () => {
    try {
      await fetch('/api/queue/clear-finished', { method: 'DELETE' });
      fetchJobs();
      onRefreshState();
    } catch (err) {
      console.error(err);
    }
  };

  const handleRetryJob = async (id: string) => {
    try {
      await fetch(`/api/queue/retry/${id}`, { method: 'POST' });
      fetchJobs();
      onRefreshState();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteJob = async (id: string) => {
    try {
      await fetch(`/api/queue/jobs/${id}`, { method: 'DELETE' });
      fetchJobs();
      onRefreshState();
    } catch (err) {
      console.error(err);
    }
  };

  const applyConcurrency = async () => {
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ concurrencyLimit: concurrency, autoEnqueueOnPaste: autoPasteEnqueue }),
      });
      fetchJobs();
      onRefreshState();
    } catch (err) {
      console.error(err);
    }
  };

  const filteredMentions = refImagesList.filter(img => img.tag.includes(mentionFilter));

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-lg flex items-center gap-3 border border-slate-700 animate-slide-up text-xs font-roboto">
          <Sparkles className="w-4 h-4 text-amber-400" />
          <span>{toastMsg}</span>
          {lastAddedJobIds.length > 0 && (
            <button
              onClick={handleUndoLastAdded}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-oswald text-2xs px-2.5 py-1 rounded-md transition-colors"
            >
              HOÀN TÁC
            </button>
          )}
          <button onClick={() => setToastMsg(null)} className="text-slate-400 hover:text-white">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-indigo-600" />
                <h2 className="text-xl font-oswald font-bold text-slate-900">SOẠN BATCH PROMPT</h2>
              </div>
              <span className="bg-indigo-100 text-indigo-800 text-xs font-oswald font-bold px-2.5 py-1 rounded-full">
                {promptCount} PROMPT
              </span>
            </div>

            <div className="mb-3">
              <label className="text-xs font-roboto text-slate-600 block mb-1">Cách tách prompt:</label>
              <select
                value={splitMode}
                onChange={(e) => setSplitMode(e.target.value as any)}
                className="w-full text-xs font-roboto bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
              >
                <option value="line">Mỗi dòng = 1 video (Mặc định)</option>
                <option value="paragraph">Mỗi đoạn = 1 video (cách nhau bởi dòng trống)</option>
                <option value="all">Toàn bộ = 1 video</option>
              </select>
            </div>

            <div className="relative mb-3">
              <textarea
                ref={textareaRef}
                value={promptText}
                onChange={handleTextareaChange}
                onPaste={handlePaste}
                rows={7}
                placeholder="Dán danh sách prompt ở đây (mỗi dòng 1 prompt). Gõ @ để chèn ảnh tham chiếu..."
                className="w-full text-xs font-roboto bg-slate-50 border border-slate-300 rounded-lg p-3 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 resize-y leading-relaxed"
              />

              {showMentionDropdown && filteredMentions.length > 0 && (
                <div className="absolute left-3 bottom-12 z-30 bg-white border border-slate-300 rounded-lg shadow-lg max-h-48 overflow-y-auto w-64 p-1">
                  <div className="text-2xs font-oswald text-slate-400 px-2 py-1 uppercase">GỢI Ý KHO ẢNH (@tag)</div>
                  {filteredMentions.map(img => (
                    <button
                      key={img.id}
                      onClick={() => selectMention(img.tag)}
                      className="w-full text-left px-2 py-1.5 hover:bg-indigo-50 rounded flex items-center gap-2 text-xs font-mono transition-colors"
                    >
                      <img src={img.dataUrl} alt={img.tag} className="w-6 h-6 object-cover rounded border border-slate-200" />
                      <span className="text-indigo-600 font-semibold">@{img.tag}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2 mb-4">
              {detectedTags.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-2xs text-slate-500 font-roboto">Ảnh đã gắn:</span>
                  {detectedTags.map(tag => {
                    const matchedImg = refImagesList.find(i => i.tag === tag);
                    return (
                      <span key={tag} className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 border border-indigo-200 text-2xs font-mono px-2 py-0.5 rounded-md">
                        {matchedImg && <img src={matchedImg.dataUrl} alt={tag} className="w-3.5 h-3.5 object-cover rounded-2xs" />}
                        @{tag} · đã tự gắn ảnh
                      </span>
                    );
                  })}
                </div>
              )}

              {missingTags.length > 0 && (
                <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-2xs text-red-700 flex items-center gap-2 font-roboto">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>
                    Chưa có ảnh trong kho cho: <strong>{missingTags.map(t => `@${t}`).join(', ')}</strong>. Vui lòng thêm ảnh vào kho trước khi chạy.
                  </span>
                </div>
              )}
            </div>

            <div className="border-t border-slate-200 pt-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-2xs font-roboto text-slate-600 block mb-1">Thời lượng:</label>
                  <select
                    value={duration}
                    onChange={(e) => setDuration(parseInt(e.target.value))}
                    className="w-full text-xs font-roboto bg-slate-50 border border-slate-300 rounded-md px-2.5 py-1.5"
                  >
                    <option value={5}>5 giây</option>
                    <option value={10}>10 giây (Mặc định)</option>
                    <option value={15}>15 giây</option>
                  </select>
                </div>

                <div>
                  <label className="text-2xs font-roboto text-slate-600 block mb-1">Tỉ lệ khung hình:</label>
                  <select
                    value={aspectRatio}
                    onChange={(e) => setAspectRatio(e.target.value as any)}
                    className="w-full text-xs font-roboto bg-slate-50 border border-slate-300 rounded-md px-2.5 py-1.5"
                  >
                    <option value="9:16">9:16 · Dọc (Mặc định)</option>
                    <option value="16:9">16:9 · Ngang</option>
                    <option value="1:1">1:1 · Vuông</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-2xs font-roboto text-slate-600 block mb-1">Ảnh dùng chung cho batch (tùy chọn):</label>
                <select
                  value={batchRefTag}
                  onChange={(e) => setBatchRefTag(e.target.value)}
                  className="w-full text-xs font-roboto bg-slate-50 border border-slate-300 rounded-md px-2.5 py-1.5 font-mono"
                >
                  <option value="">(Không dùng chung - chỉ dùng @tag trong prompt)</option>
                  {refImagesList.map(img => (
                    <option key={img.id} value={img.tag}>@{img.tag} — {img.filename}</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-2xs font-roboto text-slate-600">Luồng / tài khoản:</span>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={concurrency}
                    onChange={(e) => setConcurrency(parseInt(e.target.value) || 1)}
                    className="w-14 text-xs font-mono bg-slate-50 border border-slate-300 rounded-md px-2 py-1 text-center"
                  />
                  <button
                    onClick={applyConcurrency}
                    className="text-2xs font-oswald bg-slate-200 hover:bg-slate-300 text-slate-800 px-2.5 py-1 rounded-md transition-colors"
                  >
                    Áp dụng
                  </button>
                  {effectiveConcurrency !== concurrencyLimit && (
                    <span className="text-2xs font-roboto text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                      Hiệu dụng: {effectiveConcurrency} (Cấu hình: {concurrencyLimit})
                    </span>
                  )}
                </div>

                <label className="flex items-center gap-2 cursor-pointer text-2xs font-roboto text-slate-700">
                  <input
                    type="checkbox"
                    checked={autoPasteEnqueue}
                    onChange={(e) => setAutoPasteEnqueue(e.target.checked)}
                    className="rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>Dán là chạy luôn (~2s)</span>
                </label>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-200 flex items-center justify-between gap-3 mt-4">
            <button
              onClick={() => enqueuePrompts()}
              disabled={promptCount === 0}
              className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-oswald font-medium py-2.5 px-4 rounded-lg text-sm transition-colors shadow-xs flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" />
              THÊM VÀO HÀNG ĐỢI →
            </button>

            <button
              onClick={handleStartQueue}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-oswald font-medium py-2.5 px-4 rounded-lg text-sm transition-colors shadow-xs flex items-center gap-1.5"
            >
              <Play className="w-4 h-4 fill-white" />
              CHẠY HÀNG ĐỢI
            </button>

            <button
              onClick={handleStopAll}
              className="bg-slate-200 hover:bg-red-100 hover:text-red-700 text-slate-700 font-oswald font-medium py-2.5 px-3 rounded-lg text-sm transition-colors flex items-center gap-1"
            >
              <Square className="w-4 h-4" />
              DỪNG TẤT CẢ
            </button>
          </div>
        </div>

        <div className="lg:col-span-7 space-y-4">
          
          {runningStripJobs.length > 0 && (
            <div className="bg-indigo-950 text-white rounded-xl p-4 shadow-sm border border-indigo-800">
              <div className="flex items-center justify-between mb-3 border-b border-indigo-800 pb-2">
                <span className="text-xs font-oswald font-bold tracking-wide text-amber-400 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span>
                  DẢI ĐANG CHẠY TRỰC TIẾP ({runningStripJobs.length} video)
                </span>
                <span className="text-2xs text-indigo-300 font-roboto">Tần suất làm mới: 2 giây</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {runningStripJobs.map(rJob => (
                  <div key={rJob.id} className="bg-indigo-900/80 border border-indigo-700/80 rounded-lg p-3 flex items-center gap-3">
                    <img
                      src={rJob.thumbnailUrl}
                      alt={rJob.id}
                      className="w-12 h-12 object-cover rounded-md border border-indigo-700 shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between text-2xs font-mono text-indigo-200 mb-1">
                        <span className="font-semibold text-amber-300">{rJob.id}</span>
                        <span className="tabular-nums">{rJob.elapsedSeconds}s</span>
                      </div>
                      <div className="w-full bg-indigo-950 rounded-full h-2 overflow-hidden mb-1">
                        <div
                          className="bg-gradient-to-r from-amber-500 to-emerald-400 h-full transition-all duration-300"
                          style={{ width: `${rJob.progress}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-2xs font-roboto text-indigo-300">
                        <span className="truncate max-w-[140px] text-slate-300">{rJob.prompt}</span>
                        <span className="font-mono font-bold text-emerald-400 tabular-nums">{rJob.progress}%</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
            
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-3 border-b border-slate-200">
              <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg text-xs font-oswald">
                <button
                  onClick={() => { setActiveFilterTab('all'); setCurrentPage(1); }}
                  className={`px-3 py-1.5 rounded-md transition-colors ${activeFilterTab === 'all' ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  Tất cả ({counts.all})
                </button>
                <button
                  onClick={() => { setActiveFilterTab('pending'); setCurrentPage(1); }}
                  className={`px-3 py-1.5 rounded-md transition-colors ${activeFilterTab === 'pending' ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  Chờ ({counts.pending})
                </button>
                <button
                  onClick={() => { setActiveFilterTab('running'); setCurrentPage(1); }}
                  className={`px-3 py-1.5 rounded-md transition-colors ${activeFilterTab === 'running' ? 'bg-white text-indigo-700 shadow-2xs font-semibold' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  Đang chạy ({counts.running})
                </button>
                <button
                  onClick={() => { setActiveFilterTab('completed'); setCurrentPage(1); }}
                  className={`px-3 py-1.5 rounded-md transition-colors ${activeFilterTab === 'completed' ? 'bg-white text-emerald-700 shadow-2xs font-semibold' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  Hoàn thành ({counts.completed})
                </button>
                <button
                  onClick={() => { setActiveFilterTab('failed'); setCurrentPage(1); }}
                  className={`px-3 py-1.5 rounded-md transition-colors ${activeFilterTab === 'failed' ? 'bg-white text-red-700 shadow-2xs font-semibold' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  Thất bại ({counts.failed})
                </button>
                <button
                  onClick={() => { setActiveFilterTab('stopped'); setCurrentPage(1); }}
                  className={`px-3 py-1.5 rounded-md transition-colors ${activeFilterTab === 'stopped' ? 'bg-white text-slate-700 shadow-2xs font-semibold' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  Đã dừng ({counts.stopped})
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleClearFinished}
                  className="text-xs font-oswald bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg transition-colors"
                >
                  Dọn mục đã xong
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Tìm theo nội dung prompt hoặc Task ID (task_...)"
                  className="w-full text-xs font-roboto bg-slate-50 border border-slate-300 rounded-lg pl-9 pr-3 py-2"
                />
              </div>
              <span className="text-2xs text-slate-500 font-roboto whitespace-nowrap">
                Trang {currentPage} / {totalPages} ({totalJobCount} video)
              </span>
            </div>

            {jobs.length === 0 ? (
              <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                <Clock className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                <p className="text-sm font-roboto text-slate-500 font-medium">Chưa có video nào trong danh sách</p>
                <p className="text-xs font-roboto text-slate-400 mt-1">Soạn prompt bên trái và bấm "Thêm vào hàng đợi" để bắt đầu</p>
              </div>
            ) : (
              <div className="space-y-2">
                {jobs.map((job) => {
                  const isExpanded = expandedJobId === job.id;
                  const isPlaying = activePlayingJobId === job.id;

                  return (
                    <div
                      key={job.id}
                      className="bg-slate-50 border border-slate-200 rounded-lg p-3 hover:border-slate-300 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-3">
                        
                        <div
                          onClick={() => job.status === 'completed' && setActivePlayingJobId(isPlaying ? null : job.id)}
                          className={`w-14 h-14 rounded-md overflow-hidden bg-slate-200 shrink-0 border border-slate-300 relative ${job.status === 'completed' ? 'cursor-pointer hover:opacity-90' : ''}`}
                        >
                          <img
                            src={job.thumbnailUrl || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=150&q=80'}
                            alt={job.id}
                            className="w-full h-full object-cover"
                          />
                          {job.status === 'completed' && (
                            <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                              <Play className="w-5 h-5 text-white fill-white" />
                            </div>
                          )}
                        </div>

                        <div
                          onClick={() => setExpandedJobId(isExpanded ? null : job.id)}
                          className="flex-1 min-w-0 cursor-pointer"
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-mono font-bold text-slate-900">{job.id}</span>
                            <span className="text-2xs text-slate-400 font-roboto">· {job.duration}s · {job.aspectRatio}</span>
                            
                            {job.status === 'pending' && <span className="bg-slate-200 text-slate-700 text-2xs font-roboto px-2 py-0.5 rounded">Chờ</span>}
                            {job.status === 'running' && <span className="bg-amber-100 text-amber-800 text-2xs font-roboto px-2 py-0.5 rounded font-bold">Đang chạy ({job.progress}%)</span>}
                            {job.status === 'completed' && <span className="bg-emerald-100 text-emerald-800 text-2xs font-roboto px-2 py-0.5 rounded font-bold">Hoàn thành</span>}
                            {job.status === 'failed' && <span className="bg-red-100 text-red-800 text-2xs font-roboto px-2 py-0.5 rounded font-bold">Thất bại</span>}
                            {job.status === 'stopped' && <span className="bg-slate-200 text-slate-700 text-2xs font-roboto px-2 py-0.5 rounded">Đã dừng</span>}
                          </div>

                          <p className="text-xs font-roboto text-slate-700 truncate">{job.prompt}</p>

                          {job.status === 'running' && (
                            <div className="w-full bg-slate-200 rounded-full h-1.5 mt-2 overflow-hidden">
                              <div className="bg-indigo-600 h-full transition-all duration-300" style={{ width: `${job.progress}%` }} />
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {job.status === 'completed' && job.videoUrl && (
                            <a
                              href={job.videoUrl}
                              download={`${job.id}.mp4`}
                              target="_blank"
                              rel="noreferrer"
                              className="bg-indigo-600 hover:bg-indigo-700 text-white text-2xs font-oswald px-3 py-1.5 rounded-md transition-colors flex items-center gap-1 shadow-2xs"
                            >
                              <Download className="w-3.5 h-3.5" />
                              TẢI MP4
                            </a>
                          )}

                          {(job.status === 'failed' || job.status === 'stopped') && (
                            <button
                              onClick={() => handleRetryJob(job.id)}
                              className="bg-slate-200 hover:bg-slate-300 text-slate-800 text-2xs font-oswald px-2.5 py-1.5 rounded-md transition-colors flex items-center gap-1"
                            >
                              <RefreshCw className="w-3 h-3" />
                              THỬ LẠI
                            </button>
                          )}

                          <button
                            onClick={() => handleDeleteJob(job.id)}
                            className="text-slate-400 hover:text-red-600 p-1 rounded-md transition-colors"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {isPlaying && job.videoUrl && (
                        <div className="mt-3 p-2 bg-slate-900 rounded-lg">
                          <div className="flex items-center justify-between text-xs text-slate-300 mb-2 font-mono px-1">
                            <span>Đang xem trực tiếp: {job.id}</span>
                            <button
                              onClick={() => setActivePlayingJobId(null)}
                              className="text-slate-400 hover:text-white text-2xs uppercase font-oswald"
                            >
                              Thu nhỏ [X]
                            </button>
                          </div>
                          <video
                            src={job.videoUrl}
                            controls
                            autoPlay
                            className="w-full max-h-80 object-contain rounded bg-black"
                          />
                        </div>
                      )}

                      {isExpanded && (
                        <div className="mt-3 pt-3 border-t border-slate-200 text-xs font-roboto space-y-2 text-slate-600 bg-white p-3 rounded-md">
                          <div>
                            <strong className="text-slate-900 font-medium">Prompt đầy đủ:</strong>
                            <p className="mt-1 p-2 bg-slate-50 border border-slate-200 rounded font-mono text-2xs whitespace-pre-wrap">{job.prompt}</p>
                          </div>
                          {job.errorMessage && (
                            <div className="p-2 bg-red-50 text-red-700 border border-red-200 rounded text-2xs font-roboto">
                              <strong>Lỗi:</strong> [{job.errorCode}] {job.errorMessage}
                            </div>
                          )}
                          <div className="flex items-center gap-4 text-2xs text-slate-400 font-mono">
                            <span>Tạo lúc: {new Date(job.createdAt).toLocaleString('vi-VN')}</span>
                            {job.elapsedSeconds > 0 && <span>Thời gian chạy: {job.elapsedSeconds}s</span>}
                            <span>Số lần retry: {job.attempts}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-200 text-xs font-roboto text-slate-600">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="bg-slate-100 hover:bg-slate-200 disabled:opacity-50 px-3 py-1.5 rounded-md flex items-center gap-1"
                >
                  <ChevronLeft className="w-4 h-4" /> Trước
                </button>
                <span>Trang {currentPage} / {totalPages}</span>
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="bg-slate-100 hover:bg-slate-200 disabled:opacity-50 px-3 py-1.5 rounded-md flex items-center gap-1"
                >
                  Sau <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}

          </div>

        </div>

      </div>

    </div>
  );
};
