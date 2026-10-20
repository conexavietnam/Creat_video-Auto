import React, { useState, useEffect } from 'react';
import { RefImage } from '../types';
import { Upload, X, Trash2, Image as ImageIcon, Plus } from 'lucide-react';

interface PersistentRefLibraryBarProps {
  onOpenUploadModal: () => void;
  onRefreshState: () => void;
  refImages: RefImage[];
}

export const PersistentRefLibraryBar: React.FC<PersistentRefLibraryBarProps> = ({
  onOpenUploadModal,
  onRefreshState,
  refImages,
}) => {
  const handleDeleteImage = async (tag: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Xóa ảnh tham chiếu @${tag}? Các job đang dùng tag này sẽ mất ảnh tham chiếu.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/ref-images/${tag}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        onRefreshState();
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="bg-white border-b border-slate-200 py-2.5 px-4 sm:px-6 shadow-2xs">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
        
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <ImageIcon className="w-4 h-4 text-indigo-600 shrink-0" />
            <span className="text-sm font-oswald font-bold text-slate-800 tracking-wide">
              KHO ẢNH THAM CHIẾU · {refImages.length} ẢNH
            </span>
          </div>
          <span className="hidden md:inline-block text-2xs text-slate-500 font-roboto">
            Gõ <code className="bg-slate-100 text-indigo-600 px-1 py-0.5 rounded font-mono font-medium">@tag</code> trong prompt để chọn ảnh
          </span>
        </div>

        <div className="flex items-center gap-2 flex-1 min-w-[200px] overflow-x-auto py-1 scrollbar-thin">
          {refImages.length === 0 ? (
            <span className="text-2xs text-slate-400 font-roboto italic">
              Chưa có ảnh nào trong kho. Bấm nút bên phải để tải lên.
            </span>
          ) : (
            refImages.map((img) => (
              <div
                key={img.id}
                className="inline-flex items-center gap-1.5 bg-slate-50 border border-slate-200 hover:border-indigo-300 rounded-md pl-1 pr-1.5 py-0.5 text-xs shrink-0 transition-colors shadow-2xs"
              >
                <img
                  src={img.dataUrl}
                  alt={img.tag}
                  className="w-5 h-5 object-cover rounded-2xs border border-slate-200"
                />
                <span className="font-mono text-2xs font-semibold text-indigo-700">
                  @{img.tag}
                </span>
                <button
                  onClick={(e) => handleDeleteImage(img.tag, e)}
                  title="Xóa ảnh khỏi kho"
                  className="text-slate-400 hover:text-red-600 ml-0.5 p-0.5 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))
          )}
        </div>

        <div className="shrink-0">
          <button
            onClick={onOpenUploadModal}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-oswald text-xs font-medium px-3.5 py-1.5 rounded-lg shadow-2xs transition-colors flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            + THÊM ẢNH THAM CHIẾU
          </button>
        </div>

      </div>
    </div>
  );
};
