# Nhật ký Sửa lỗi (Error Logs) - Muse Batch Manager

Ghi chép đầy đủ các lỗi phát sinh trong quá trình phát triển, nguyên nhân và phương án khắc phục để không bị tái lập.

| ID Lỗi | Thời gian | Mô tả Lỗi | Nguyên nhân | Phương án Xử lý | Trạng thái |
|---|---|---|---|---|---|
| ERR-001 | 2026-10-19 | TargetFile không phải path tuyệt đối trong write_to_file | Truyền relative path thay vì `/app/applet/...` hoặc `/...` | Đã chuẩn hóa toàn bộ đường dẫn gọi tool dạng absolute path bắt đầu bằng `/` | Đã xử lý |
| ERR-002 | 2026-10-19 | Cần import tĩnh firebase-applet-config.json trong ESM | Dùng fs/require động bị thất bại trong ES Module | Đã dùng static import `import firebaseConfig from '../../firebase-applet-config.json'` | Đã xử lý |
