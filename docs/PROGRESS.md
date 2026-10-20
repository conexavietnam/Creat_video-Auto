# Bảng Thống kê Tiến độ Dự án Muse Batch Manager

| STT | Hạng mục / Tính năng | Tiêu chuẩn Nghiệm thu (Acceptance Criteria) | Trạng thái |
|---|---|---|---|
| 1 | Khởi tạo Dự án & Font | Tải Google Fonts Oswald & Roboto, cập nhật index.html, index.css, metadata.json | ĐÃ HOÀN THÀNH |
| 2 | Khởi tạo Tài liệu Dự án | Tạo docs/ARCHITECTURE.md, docs/ERROR_LOGS.md, docs/SKILLS_REGISTRY.md, docs/PROGRESS.md | ĐÃ HOÀN THÀNH |
| 3 | Tích hợp PostgreSQL & Drizzle Schema | Định nghĩa bảng accounts, ref_images, video_jobs, studio_cards, app_settings, system_logs, project_progress | ĐÃ HOÀN THÀNH |
| 4 | Triển khai Server Express & API Contract | Đầy đủ API Account Pool, Reference Library, Video Queue Dispatcher, Flow Studio, System State | ĐÃ HOÀN THÀNH |
| 5 | Worker API Engine & Multi-threading Dispatcher | Dispatcher FIFO đa luồng thật, gán session Online, tự động retry N lần, timeout X phút, gán lại khi mất kết nối | ĐÃ HOÀN THÀNH |
| 6 | Header Persistent & Reference Library Panel | Thêm ảnh tham chiếu (multiple file, max 8MB, tự sinh tag sạch, cảnh báo trùng tag), xóa ảnh | ĐÃ HOÀN THÀNH |
| 7 | Batch Manager - Soạn Batch Prompt & Autocomplete @tag | Ô textarea, 3 chế độ tách prompt, badge đếm trực tiếp (~200ms), dropdown gợi ý @, chip xác nhận, cảnh báo đỏ | ĐÃ HOÀN THÀNH |
| 8 | Batch Manager - Toggle Dán là chạy & Cài đặt Batch | Auto-enqueue khi paste (~2s debounce), toast Hoàn tác, cài đặt thời lượng/tỉ lệ/luồng/ảnh dùng chung | ĐÃ HOÀN THÀNH |
| 9 | Batch Manager - Dải "Đang chạy trực tiếp" | Dải ghim hiển thị toàn bộ job running cùng lúc, tiến độ %, thời gian chạy nhảy mỗi 2s | ĐÃ HOÀN THÀNH |
| 10 | Batch Manager - Bảng Danh sách Video 1 Dòng | Player nhúng inline khi hoàn thành, filter tabs với counter, ô tìm kiếm, phân trang, nút Tải MP4 | ĐÃ HOÀN THÀNH |
| 11 | Flow Studio - Canvas Kéo Thả Image-to-Video | Dot-grid canvas, thẻ draggable, prompt riêng có @tag, zoom -/+/%/Fit, nút Tạo tất cả | ĐÃ HOÀN THÀNH |
| 12 | Trang Quản lý Account Pool & Bảo mật | Thêm/xóa/bật/tắt tài khoản, mã hóa token at rest, che định danh dạng usr_***, kiểm tra sức khỏe session | ĐÃ HOÀN THÀNH |
| 13 | Trang Nhật ký Lỗi & Bảng Tiến độ Trực quan | Giao diện theo dõi lỗi hệ thống và bảng thống kê tiến độ công việc đầy đủ Xem/Thêm/Sửa/Xóa | ĐÃ HOÀN THÀNH |
| 14 | Định tuyến URL Phân Tách & Verification | Đường link riêng cho từng tính năng (?view=...), compile_applet & kịch bản kiểm thử AC-01 -> AC-12 | ĐÃ HOÀN THÀNH |
