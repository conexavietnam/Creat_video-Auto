import React, { useState, useEffect, useRef } from 'react';
import { StudioCard, RefImage } from '../types';
import { Play, Plus, ZoomIn, ZoomOut, Maximize2, Trash2, Download, Upload, Image as ImageIcon, Sparkles, X, Settings } from 'lucide-react';

interface FlowStudioProps {
  onRefreshState: () => void;
}

export const FlowStudioView: React.FC<FlowStudioProps> = ({ onRefreshState }) => {
  const [cards, setCards] = useState<StudioCard[]>([]);
  const [refImages, setRefImages] = useState<RefImage[]>([]);
  const [zoom, setZoom] = useState<number>(100);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  
  const [draggingCardId, setDraggingCardId] = useState<number | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  
  const [showAddModal, setShowAddModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [selectedRefImg, setSelectedRefImg] = useState<string | null>(null);
  const [uploadDataUrl, setUploadDataUrl] = useState<string | null>(null);

  const [activeMentionCardId, setActiveMentionCardId] = useState<number | null>(null);
  const [cardMentionFilter, setCardMentionFilter] = useState('');

  const [studioDuration, setStudioDuration] = useState<number>(10);
  const [studioRatio, setStudioRatio] = useState<'9:16' | '16:9' | '1:1'>('9:16');

  const containerRef = useRef<HTMLDivElement>(null);

  const fetchCards = async () => {
    try {
      const res = await fetch('/api/studio/cards');
      const json = await res.json();
      if (json.success) setCards(json.data);

      const refRes = await fetch('/api/ref-images');
      const refJson = await refRes.json();
      if (refJson.success) setRefImages(refJson.data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchCards();
    const interval = setInterval(fetchCards, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey) {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 5 : -5;
      setZoom(z => Math.max(50, Math.min(150, z + delta)));
    }
  };

  const handleAddCard = async () => {
    const targetUrl = uploadDataUrl || selectedRefImg;
    if (!targetUrl) return;

    try {
      const res = await fetch('/api/studio/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputImageUrl: targetUrl,
          posX: 100 + (cards.length % 4) * 320,
          posY: 100 + Math.floor(cards.length / 4) * 380,
          prompt: 'Tạo video sinh động từ ảnh đầu vào',
        }),
      });

      const json = await res.json();
      if (json.success) {
        setShowAddModal(false);
        setUploadDataUrl(null);
        setSelectedRefImg(null);
        fetchCards();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handlePromptChange = (id: number, val: string, e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setCards(prev => prev.map(c => c.id === id ? { ...c, prompt: val } : c));

    const cursorPos = e.target.selectionStart;
    const textBefore = val.substring(0, cursorPos);
    const lastAtIdx = textBefore.lastIndexOf('@');

    if (lastAtIdx !== -1 && !/\s/.test(textBefore.substring(lastAtIdx))) {
      const filterStr = textBefore.substring(lastAtIdx + 1).toLowerCase();
      setCardMentionFilter(filterStr);
      setActiveMentionCardId(id);
    } else {
      setActiveMentionCardId(null);
    }

    fetch(`/api/studio/cards/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: val }),
    }).catch(console.error);
  };

  const selectCardMention = (cardId: number, tag: string) => {
    const card = cards.find(c => c.id === cardId);
    if (!card) return;

    const val = card.prompt;
    const lastAtIdx = val.lastIndexOf('@');
    if (lastAtIdx !== -1) {
      const newPrompt = val.substring(0, lastAtIdx) + `@${tag} `;
      setCards(prev => prev.map(c => c.id === cardId ? { ...c, prompt: newPrompt } : c));

      fetch(`/api/studio/cards/${cardId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: newPrompt }),
      }).catch(console.error);
    }

    setActiveMentionCardId(null);
  };

  const handleMouseDown = (cardId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const card = cards.find(c => c.id === cardId);
    if (!card) return;

    setDraggingCardId(cardId);
    setDragOffset({
      x: e.clientX - card.posX,
      y: e.clientY - card.posY,
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (draggingCardId === null) return;

    const newX = e.clientX - dragOffset.x;
    const newY = e.clientY - dragOffset.y;

    setCards(prev => prev.map(c => c.id === draggingCardId ? { ...c, posX: newX, posY: newY } : c));
  };

  const handleMouseUp = async () => {
    if (draggingCardId === null) return;
    const card = cards.find(c => c.id === draggingCardId);
    setDraggingCardId(null);

    if (card) {
      try {
        await fetch(`/api/studio/cards/${card.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ posX: card.posX, posY: card.posY }),
        });
      } catch (err) {
        console.error(err);
      }
    }
  };

  const handleDeleteCard = async (id: number) => {
    try {
      await fetch(`/api/studio/cards/${id}`, { method: 'DELETE' });
      fetchCards();
    } catch (err) {
      console.error(err);
    }
  };

  const handleGenerateAll = async () => {
    try {
      await fetch('/api/studio/generate-all', { method: 'POST' });
      fetchCards();
      onRefreshState();
    } catch (err) {
      console.error(err);
    }
  };

  const handleFitToFrame = () => {
    setZoom(100);
    setPan({ x: 0, y: 0 });
  };

  const filteredCardMentions = refImages.filter(img => img.tag.includes(cardMentionFilter));

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      className="relative w-full h-[calc(100vh-6.5rem)] overflow-hidden dot-grid-bg bg-slate-100 select-none"
    >
      
      <div className="absolute top-4 left-4 z-20 bg-white/95 backdrop-blur-xs border border-slate-200 rounded-xl px-4 py-2.5 shadow-sm flex items-center gap-4">
        <div>
          <h1 className="text-lg font-oswald font-bold text-slate-900 tracking-wide">MUSE FLOW STUDIO</h1>
          <p className="text-2xs font-roboto text-slate-500">Image to video workspace</p>
        </div>

        <div className="h-8 w-px bg-slate-200" />

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAddModal(true)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-oswald text-xs px-3.5 py-2 rounded-lg shadow-2xs transition-colors flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            + THÊM ẢNH
          </button>

          <button
            onClick={handleGenerateAll}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-oswald text-xs px-3.5 py-2 rounded-lg shadow-2xs transition-colors flex items-center gap-1.5"
          >
            <Play className="w-4 h-4 fill-white" />
            ▶ TẠO TẤT CẢ
          </button>

          <button
            onClick={() => setShowSettingsModal(true)}
            className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors border border-slate-200"
            title="Cài đặt mặc định Studio"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="absolute bottom-6 right-6 z-20 bg-white/95 backdrop-blur-xs border border-slate-200 rounded-xl p-2 shadow-md flex items-center gap-2 text-xs font-oswald">
        <button
          onClick={() => setZoom(z => Math.max(50, z - 10))}
          className="p-1.5 hover:bg-slate-100 rounded text-slate-700"
          title="Thu nhỏ"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <span className="w-12 text-center font-bold text-slate-900 tabular-nums">{zoom}%</span>
        <button
          onClick={() => setZoom(z => Math.min(150, z + 10))}
          className="p-1.5 hover:bg-slate-100 rounded text-slate-700"
          title="Phóng to (Ctrl + lăn chuột)"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <div className="h-4 w-px bg-slate-200" />
        <button
          onClick={handleFitToFrame}
          className="px-2.5 py-1 hover:bg-slate-100 rounded text-slate-700 flex items-center gap-1"
        >
          <Maximize2 className="w-3.5 h-3.5" />
          Vừa khung
        </button>
      </div>

      <div
        style={{
          transform: `scale(${zoom / 100}) translate(${pan.x}px, ${pan.y}px)`,
          transformOrigin: '0 0',
        }}
        className="w-full h-full relative transition-transform duration-75"
      >
        {cards.map((card) => (
          <div
            key={card.id}
            style={{ left: `${card.posX}px`, top: `${card.posY}px` }}
            className="absolute w-72 bg-white border border-slate-300 rounded-xl shadow-md overflow-hidden z-10 transition-shadow hover:shadow-lg"
          >
            
            <div
              onMouseDown={(e) => handleMouseDown(card.id, e)}
              className="bg-slate-800 text-white px-3 py-2 cursor-grab active:cursor-grabbing flex items-center justify-between"
            >
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${
                  card.status === 'completed' ? 'bg-emerald-400' :
                  card.status === 'generating' ? 'bg-amber-400 animate-ping' :
                  card.status === 'failed' ? 'bg-red-400' : 'bg-slate-400'
                }`} />
                <span className="text-xs font-oswald font-semibold tracking-wide">THẺ IMAGE-TO-VIDEO #{card.id}</span>
              </div>
              <button
                onClick={() => handleDeleteCard(card.id)}
                className="text-slate-400 hover:text-red-400 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 space-y-3">
              
              <div className="aspect-video bg-slate-200 rounded-lg overflow-hidden border border-slate-200 relative">
                <img
                  src={card.inputImageUrl}
                  alt={`Card ${card.id}`}
                  className="w-full h-full object-cover"
                />
                <span className="absolute bottom-1.5 left-1.5 bg-black/60 text-white text-2xs font-mono px-1.5 py-0.5 rounded">
                  Ảnh nguồn
                </span>
                {card.status === 'completed' && (
                  <span className="absolute top-1.5 right-1.5 bg-emerald-600 text-white text-2xs font-oswald font-bold px-1.5 py-0.5 rounded">
                    Đã tạo
                  </span>
                )}
                {card.status === 'generating' && (
                  <span className="absolute top-1.5 right-1.5 bg-amber-600 text-white text-2xs font-oswald font-bold px-1.5 py-0.5 rounded">
                    Đang tạo
                  </span>
                )}
              </div>

              <div className="relative">
                <label className="text-2xs font-roboto text-slate-500 block mb-1">Prompt riêng (gõ @ để chọn ảnh):</label>
                <textarea
                  value={card.prompt}
                  onChange={(e) => handlePromptChange(card.id, e.target.value, e)}
                  rows={2}
                  className="w-full text-xs font-roboto bg-slate-50 border border-slate-300 rounded-lg p-2 focus:ring-1 focus:ring-indigo-500"
                />

                {activeMentionCardId === card.id && filteredCardMentions.length > 0 && (
                  <div className="absolute left-0 bottom-full mb-1 z-30 bg-white border border-slate-300 rounded-lg shadow-lg max-h-40 overflow-y-auto w-full p-1">
                    <div className="text-2xs font-oswald text-slate-400 px-2 py-0.5 uppercase">CHỌN ẢNH (@tag)</div>
                    {filteredCardMentions.map(img => (
                      <button
                        key={img.id}
                        onClick={() => selectCardMention(card.id, img.tag)}
                        className="w-full text-left px-2 py-1 hover:bg-indigo-50 rounded flex items-center gap-2 text-xs font-mono transition-colors"
                      >
                        <img src={img.dataUrl} alt={img.tag} className="w-5 h-5 object-cover rounded border" />
                        <span className="text-indigo-600 font-semibold truncate">@{img.tag}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {card.videoUrl ? (
                <div className="bg-slate-900 rounded-lg p-2 text-white">
                  <div className="flex items-center justify-between text-2xs font-oswald text-indigo-300 mb-1">
                    <span>VIDEO ĐÃ TẠO</span>
                    <span className="bg-emerald-500 text-white px-1.5 py-0.2 rounded font-bold">HD</span>
                  </div>
                  <video
                    src={card.videoUrl}
                    controls
                    className="w-full aspect-video object-contain rounded bg-black mb-2"
                  />
                  <a
                    href={card.videoUrl}
                    download={`studio_card_${card.id}.mp4`}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-oswald text-2xs py-1.5 rounded flex items-center justify-center gap-1 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    TẢI MP4
                  </a>
                </div>
              ) : (
                <div className="text-center p-3 bg-slate-50 border border-slate-200 rounded-lg text-2xs font-roboto text-slate-500">
                  {card.status === 'generating' ? (
                    <span className="text-indigo-600 font-bold flex items-center justify-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 animate-spin" />
                      Đang xử lý tạo video...
                    </span>
                  ) : card.status === 'failed' ? (
                    <span className="text-red-600 font-medium">Lỗi khi tạo video</span>
                  ) : (
                    <span>Chưa tạo · Sẵn sàng</span>
                  )}
                </div>
              )}

            </div>
          </div>
        ))}
      </div>

      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-2xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="text-lg font-oswald font-bold text-slate-900">THÊM THẺ MỚI VÀO CANVAS</h3>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <label className="text-xs font-oswald font-semibold text-slate-700 block mb-2">CHỌN ẢNH TỪ KHO THAM CHIẾU:</label>
                <div className="grid grid-cols-4 gap-2 max-h-40 overflow-y-auto p-1 bg-slate-50 rounded-lg border border-slate-200">
                  {refImages.map((img) => (
                    <div
                      key={img.id}
                      onClick={() => { setSelectedRefImg(img.dataUrl); setUploadDataUrl(null); }}
                      className={`cursor-pointer rounded-lg overflow-hidden border-2 p-1 transition-colors ${selectedRefImg === img.dataUrl ? 'border-indigo-600 bg-indigo-50' : 'border-slate-200'}`}
                    >
                      <img src={img.dataUrl} alt={img.tag} className="w-full h-12 object-cover rounded" />
                      <span className="text-2xs font-mono text-center block mt-1 truncate">@{img.tag}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="text-center text-xs text-slate-400 font-oswald">— HOẶC —</div>

              <div>
                <label className="text-xs font-oswald font-semibold text-slate-700 block mb-2">TẢI ẢNH MỚI TỪ MÁY TÍNH:</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      const reader = new FileReader();
                      reader.onload = (ev) => {
                        setUploadDataUrl(ev.target?.result as string);
                        setSelectedRefImg(null);
                      };
                      reader.readAsDataURL(f);
                    }
                  }}
                  className="w-full text-xs font-roboto file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-xs file:font-oswald file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                />
              </div>

              <div className="pt-4 border-t border-slate-200 flex justify-end gap-3">
                <button
                  onClick={() => setShowAddModal(false)}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-oswald text-xs px-4 py-2 rounded-lg"
                >
                  HỦY BỎ
                </button>
                <button
                  onClick={handleAddCard}
                  disabled={!selectedRefImg && !uploadDataUrl}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-oswald text-xs px-5 py-2 rounded-lg shadow-xs"
                >
                  THÊM THẺ VÀO CANVAS
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showSettingsModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-2xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-5 border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="text-base font-oswald font-bold text-slate-900 flex items-center gap-2">
                <Settings className="w-4 h-4 text-indigo-600" />
                CÀI ĐẶT STUDIO
              </h3>
              <button onClick={() => setShowSettingsModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-roboto text-slate-600 block mb-1">Thời lượng mặc định:</label>
                <select
                  value={studioDuration}
                  onChange={(e) => setStudioDuration(parseInt(e.target.value))}
                  className="w-full text-xs font-roboto bg-slate-50 border border-slate-300 rounded-lg p-2"
                >
                  <option value={5}>5 giây</option>
                  <option value={10}>10 giây</option>
                  <option value={15}>15 giây</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-roboto text-slate-600 block mb-1">Tỉ lệ khung hình:</label>
                <select
                  value={studioRatio}
                  onChange={(e) => setStudioRatio(e.target.value as any)}
                  className="w-full text-xs font-roboto bg-slate-50 border border-slate-300 rounded-lg p-2"
                >
                  <option value="9:16">9:16 · Dọc</option>
                  <option value="16:9">16:9 · Ngang</option>
                  <option value="1:1">1:1 · Vuông</option>
                </select>
              </div>

              <div className="pt-3 border-t border-slate-200 flex justify-end">
                <button
                  onClick={() => setShowSettingsModal(false)}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-oswald text-xs px-4 py-2 rounded-lg"
                >
                  ĐÓNG
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
