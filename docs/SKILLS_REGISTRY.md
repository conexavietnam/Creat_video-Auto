# Registry Kỹ năng (Skills Registry) & Quy tắc Dự án

Tài liệu lưu trữ quy chuẩn kỹ thuật và kỹ năng áp dụng xuyên suốt dự án Muse Batch Manager.

## 1. Quy tắc Thiết kế UI & Typography
- **Font tiêu đề**: Oswald (Google Fonts). Tất cả tiêu đề dùng cùng cấp font Oswald.
- **Font nội dung**: Roboto (Google Fonts). Dùng cho toàn bộ text, form, nút bấm, thông số.
- **Bảo mật**: Không bao giờ hiển thị credential/token ở dạng plaintext. Định danh che dạng `usr_***4812`.
- **Dữ liệu thực tế**: Không hardcode dữ liệu. Tất cả danh mục (Kho ảnh, Tài khoản, Job, Canvas Studio, Cấu hình) đều có đầy đủ Xem / Thêm / Sửa / Xóa liên kết PostgreSQL Database.
- **Tách biệt đường link**: Mọi module có Query URL riêng (`?view=batch`, `?view=studio`, `?view=accounts`, `?view=library`, `?view=progress`).
- **Không chú thích code**: Mọi file code không chứa comment chú thích thừa.

## 2. Quy tắc PostgreSQL & Drizzle ORM
- Dùng Drizzle type-safe query API (`db.select()`, `db.insert()`, `db.update()`, `db.delete()`).
- Tên biến môi trường kết nối dùng `SQL_HOST`, `SQL_USER`, `SQL_PASSWORD`, `SQL_DB_NAME`.
- Tách biệt `drizzle.config.ts` (dùng `SQL_ADMIN_USER`, `SQL_ADMIN_PASSWORD`) và runtime app pool (dùng Object Method `new Pool({ host, user, password, database })`).
- Cấu hình import đuôi `.ts` / `.js` rõ ràng cho ES Module resolution.
