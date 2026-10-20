# Nhật ký Sửa lỗi (Error Logs) - Muse Batch Manager

Ghi chép đầy đủ các lỗi phát sinh trong quá trình phát triển, nguyên nhân và phương án khắc phục để không bị tái lập.

| ID Lỗi | Thời gian | Mô tả Lỗi | Nguyên nhân | Phương án Xử lý | Trạng thái |
|---|---|---|---|---|---|
| ERR-001 | 2026-10-19 | TargetFile không phải path tuyệt đối trong write_to_file | Truyền relative path thay vì `/app/applet/...` hoặc `/...` | Đã chuẩn hóa toàn bộ đường dẫn gọi tool dạng absolute path bắt đầu bằng `/` | Đã xử lý |
| ERR-002 | 2026-10-19 | Cần import tĩnh firebase-applet-config.json trong ESM | Dùng fs/require động bị thất bại trong ES Module | Đã dùng static import `import firebaseConfig from '../../firebase-applet-config.json'` | Đã xử lý |
| ERR-003 | 2026-10-20 | "Mã hóa" credential chỉ là base64 cắt ngắn, API/UI trả về chuỗi này | Chưa dùng thuật toán mã hóa thật | AES-256-GCM, khóa riêng, API không trả credential | Đã xử lý |
| ERR-004 | 2026-10-20 | Dispatcher bỏ qua `maxSlots`, dùng `số tài khoản × 2`, chia vòng tròn | Logic giả lập | Tính slot trống từng tài khoản, gán trong transaction `SKIP LOCKED` | Đã xử lý |
| ERR-005 | 2026-10-20 | `PUT /api/settings` không lưu gì | Bảng `app_settings` không có dòng id=1 | Seed khi khởi động, PUT nhận từng trường và kiểm tra giá trị | Đã xử lý |
| ERR-006 | 2026-10-20 | Job tạo video giả: % tăng theo đồng hồ, luôn gắn video mẫu | Chưa có worker thật | Tách provider adapter; progress chỉ lấy từ nền tảng | Đã xử lý (Veo/Kling chưa test API thật) |
| ERR-007 | 2026-10-20 | Nhãn cỡ `text-2xs` hiển thị to bất thường | Tailwind v4 chưa định nghĩa `--text-2xs` | Khai báo trong `@theme` | Đã xử lý |
