import React, { useState, useEffect } from 'react';
import { RefImage } from '../types';
import { Upload, X, Trash2, Tag, AlertCircle, Check, Image as ImageIcon } from 'lucide-react';

interface RefLibraryProps {
  onClose?: () => void;
  onRefreshState?: () => void;
}

interface PendingUpload {
  id: string;
  file: File;
  dataUrl: string;
  tag: string;
  filename: string;
  fileSize: number;
  mimeType: string;
  error?: string;
}

export const RefLibraryModal: React.FC<RefLibraryProps> = ({ onClose, onRefreshState }) => {
  const [images, setImages] = useState<RefImage[]>([]);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const fetchImages = async () => {
    try {
      const res = await fetch('/api/ref-images');
      const json = await res.json();
      if (json.success) {
        setImages(json.data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchImages();
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setGlobalError(null);
    setSuccessMsg(null);
    const newPending: PendingUpload[] = [];

    Array.from(files).forEach((file) => {
      if (file.size > 8 * 1024 * 1024) {
        setGlobalError(`File ${file.name} vượt quá dung lượng 8MB và đã bị loại bỏ`);
        return;
      }

      const extIdx = file.name.lastIndexOf('.');
      const baseName = extIdx !== -1 ? file.name.substring(0, extIdx) : file.name;
      const cleanTag = baseName.toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-');

      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        
        let errorMsg = '';
        if (images.some(img => img.tag === cleanTag)) {
          errorMsg = 'Tag đã tồn tại trong kho';
        }

        setPending(prev => [
          ...prev,
          {
            id: Math.random().toString(),
            file,
            dataUrl,
            tag: cleanTag,
            filename: file.name,
            fileSize: file.size,
            mimeType: file.type || 'image/png',
            error: errorMsg,
          }
        ]);
      };
      reader.readAsDataURL(file);
    });
  };

  const updatePendingTag = (id: string, newTagRaw: string) => {
    const cleanTag = newTagRaw.toLowerCase().replace(/[^a-z0-9-_]/g, '');
    setPending(prev => prev.map(p => {
      if (p.id !== id) return p;
      
      let err = '';
      if (!cleanTag) {
        err = 'Tag không được rỗng';
      } else if (images.some(img => img.tag === cleanTag)) {
        err = 'Tag đã có trong kho';
      } else if (prev.some(other => other.id !== id && other.tag === cleanTag)) {
        err = 'Tag trùng với file khác trong đợt này';
      }

      return { ...p, tag: cleanTag, error: err };
    }));
  };

  const removePending = (id: string) => {
    setPending(prev => prev.filter(p => p.id !== id));
  };

  const handleSaveAll = async () => {
    const validFiles = pending.filter(p => !p.error && p.tag.length > 0);
    if (validFiles.length === 0) {
      setGlobalError('Không có file hợp lệ để lưu vào kho');
      return;
    }

    setIsUploading(true);
    setGlobalError(null);

    try {
      const payload = validFiles.map(p => ({
        tag: p.tag,
        filename: p.filename,
        dataUrl: p.dataUrl,
        mimeType: p.mimeType,
        fileSize: p.fileSize,
      }));

      const res = await fetch('/api/ref-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: payload }),
      });

      const json = await res.json();
      setIsUploading(false);

      if (json.success) {
        setSuccessMsg(`Đã lưu thành công ${json.data.length} ảnh vào kho tham chiếu`);
        setPending([]);
        fetchImages();
        if (onRefreshState) onRefreshState();
      } else {
        setGlobalError(json.error || 'Lỗi khi lưu ảnh vào kho');
      }
    } catch (err: any) {
      setIsUploading(false);
      setGlobalError(err.message || 'Lỗi kết nối máy chủ');
    }
  };

  const handleDeleteImage = async (tag: string) => {
    if (!confirm(`Bạn có chắc muốn xóa ảnh tham chiếu @${tag}? Thao tác này sẽ ảnh hưởng tới các job dùng tag này.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/ref-images/${tag}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        setSuccessMsg(`Đã xóa ảnh tham chiếu @${tag}`);
        fetchImages();
        if (onRefreshState) onRefreshState();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const validCount = pending.filter(p => !p.error && p.tag.length > 0).length;

  return (
    <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-6 max-w-5xl mx-auto my-6">
      <div className="flex items-center justify-between pb-4 border-b border-slate-200">
        <div>
          <h2 className="text-2xl font-oswald font-bold text-slate-900 flex items-center gap-2">
            <ImageIcon className="w-6 h-6 text-indigo-600" />
            KHO ẢNH THAM CHIẾU (REFERENCE LIBRARY)
          </h2>
          <p className="text-xs text-slate-500 font-roboto mt-1">
            Gõ <code className="bg-slate-100 text-indigo-700 px-1.5 py-0.5 rounded font-mono font-medium">@tag</code> trong prompt để chèn ảnh tương ứng. Tag là duy nhất trong toàn kho.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <label className="cursor-pointer bg-indigo-600 hover:bg-indigo-700 text-white font-oswald tracking-wide font-medium px-4 py-2.5 rounded-lg shadow-xs transition-colors flex items-center gap-2">
            <Upload className="w-4 h-4" />
            + THÊM ẢNH THAM CHIẾU
            <input
              type="file"
              multiple
              accept="image/png, image/jpeg, image/webp"
              onChange={handleFileSelect}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {globalError && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-xs flex items-center gap-2 font-roboto">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{globalError}</span>
        </div>
      )}

      {successMsg && (
        <div className="mt-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs flex items-center gap-2 font-roboto">
          <Check className="w-4 h-4 shrink-0 text-emerald-600" />
          <span>{successMsg}</span>
        </div>
      )}

      {pending.length > 0 && (
        <div className="mt-6 bg-slate-50 border border-indigo-100 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-oswald font-semibold text-slate-800">
              DANH SÁCH CHỜ LƯU ({pending.length} ảnh)
            </h3>
            <button
              onClick={handleSaveAll}
              disabled={isUploading || validCount === 0}
              className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-oswald font-medium px-4 py-1.5 rounded-lg text-xs transition-colors flex items-center gap-1.5 shadow-2xs"
            >
              <Check className="w-3.5 h-3.5" />
              Lưu {validCount} ảnh vào kho
            </button>
          </div>

          <div className="space-y-3">
            {pending.map((item) => (
              <div key={item.id} className="bg-white border border-slate-200 rounded-lg p-3 flex items-center gap-4">
                <img
                  src={item.dataUrl}
                  alt={item.filename}
                  className="w-12 h-12 object-cover rounded-md border border-slate-200 shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 font-mono truncate max-w-xs">{item.filename}</span>
                    <span className="text-2xs text-slate-400">({(item.fileSize / 1024).toFixed(1)} KB)</span>
                  </div>

                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs font-semibold text-indigo-600 font-mono">@</span>
                    <input
                      type="text"
                      value={item.tag}
                      onChange={(e) => updatePendingTag(item.id, e.target.value)}
                      placeholder="nhap-tag"
                      className="text-xs font-mono border border-slate-300 rounded px-2 py-1 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 w-48"
                    />
                    {item.error && (
                      <span className="text-2xs text-red-600 font-roboto flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        {item.error}
                      </span>
                    )}
                  </div>
                </div>

                <button
                  onClick={() => removePending(item.id)}
                  className="text-slate-400 hover:text-red-600 p-1 rounded-md transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-oswald font-semibold text-slate-700 tracking-wider">
            ẢNH ĐÃ CÓ TRONG KHO ({images.length} ảnh)
          </span>
        </div>

        {images.length === 0 ? (
          <div className="text-center py-10 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
            <ImageIcon className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p className="text-sm font-roboto text-slate-500 font-medium">Chưa có ảnh tham chiếu nào trong kho</p>
            <p className="text-xs font-roboto text-slate-400 mt-1">Bấm "+ Thêm ảnh tham chiếu" ở trên để tải lên nhiều ảnh</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {images.map((img) => (
              <div key={img.id} className="group relative bg-slate-50 border border-slate-200 rounded-lg p-2 hover:shadow-xs transition-shadow">
                <div className="aspect-square rounded-md overflow-hidden bg-slate-200 mb-2 border border-slate-100 relative">
                  <img
                    src={img.dataUrl}
                    alt={img.tag}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                  />
                  <button
                    onClick={() => handleDeleteImage(img.tag)}
                    title="Xóa ảnh khỏi kho"
                    className="absolute top-1.5 right-1.5 bg-red-600/90 text-white p-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-700"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono font-semibold text-indigo-600 truncate">
                    @{img.tag}
                  </span>
                  <span className="text-2xs text-slate-400 font-mono">
                    {(img.fileSize / 1024).toFixed(0)}KB
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
