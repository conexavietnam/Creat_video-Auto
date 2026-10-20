# Muse Batch Manager - Kiến trúc Hệ thống (System Architecture)

## 1. Tổng quan
React (Vite) + Node/Express + PostgreSQL (Drizzle ORM). Một tiến trình server chạy cả API lẫn dispatcher.

```
server.ts                      Routes API, xác thực, khởi động dispatcher
src/server/dispatcher.ts       Dispatcher, retry/timeout, health check, dừng tất cả
src/server/providers/          Adapter nền tảng: veo, kling, flow, mock (+ types, index)
src/server/jobs.ts             Resolve provider, kiểm tra capability, resolve @tag, tách prompt
src/server/images.ts           Kiểm tra ảnh (magic bytes), chuẩn hóa tag, trích @tag
src/server/crypto.ts           AES-256-GCM cho credential
src/server/auth.ts             Đăng nhập workspace (cookie HttpOnly)
src/server/storage.ts          Lưu video/thumbnail vào .data/videos (phục vụ qua /media)
src/server/migrate.ts          CREATE/ALTER IF NOT EXISTS + seed app_settings khi khởi động
```

## 2. Cơ sở dữ liệu
- `accounts`: tài khoản của một provider; `encrypted_credential` (AES-256-GCM, định dạng `v1:iv:tag:data`), `provider_id`, `max_slots`, `session_status`, `cooldown_until`.
- `ref_images`: kho ảnh, `tag` duy nhất, nội dung ảnh dạng data URL.
- `video_jobs`: `provider_id`, `external_id` (mã thao tác bên nền tảng), `ref_snapshot` (danh sách `{tag, imageId}` ghi lúc tạo job), `input_image_url` (ảnh đầu khung của Studio), `last_progress_at`, `attempts`, `error_code`.
- `studio_cards`, `app_settings` (kèm mặc định provider/thời lượng/tỉ lệ dùng chung Batch và Studio), `system_logs`, `project_progress`.

## 3. Provider
Mỗi nền tảng cài interface `VideoProvider`: `capabilities` (thời lượng, tỉ lệ, số ảnh tham chiếu tối đa), `validate`, `health`, `submit → externalId`, `poll → running | done | failed`, `cancel`. Lỗi trả về bằng `ProviderError(code, retryable)`.

| Provider | Kết nối | Ghi chú |
|---|---|---|
| `veo` | API key Gemini | 4/6/8 giây, 16:9 và 9:16; ảnh `@tag` chỉ khi 8 giây + 16:9 (theo tài liệu Veo 3.1, chưa kiểm chứng) |
| `kling` | `accessKey:secretKey` (JWT HS256) | 5/10 giây; có ảnh → image2video (1 ảnh) |
| `flow` | phiên trình duyệt | Chưa triển khai, `available=false` |
| `mock` | bất kỳ chuỗi | Demo/kiểm thử; prompt chứa `[fail]` luôn lỗi, `[hang]` luôn treo |

## 4. Dispatcher
Mỗi 2 giây (có khóa chống chạy chồng):
1. Poll từng job `running` (theo `pollIntervalMs` của provider). Hết `timeoutMinutes` mà không có tiến độ mới → `TIMEOUT`.
2. Nếu không tạm dừng: trong một transaction, lấy job `pending` theo FIFO (`FOR UPDATE SKIP LOCKED`), gán cho tài khoản **cùng provider**, đang enabled + Online + không trong cooldown, còn slot (`max_slots`) và chưa vượt `min(số luồng cấu hình, tổng slot)`.
3. Gửi job sang provider (ngoài transaction).
4. Đồng bộ `current_running_jobs`.

Quy tắc lỗi:
- Lỗi `retryable` và `attempts < maxRetries` → `Chờ`, `attempts + 1`. Hết lượt → `Thất bại` kèm mã lỗi + thông báo tiếng Việt. Timeout được tính vào số lần retry.
- `AUTH_FAILED` → tài khoản Offline, job về `Chờ` (không tính retry). `RATE_LIMITED` → tài khoản nghỉ 60 giây.
- Tài khoản bị tắt/xóa/health check hỏng → job đang chạy về `Chờ`, không tính retry.
- Retry thủ công đặt lại `attempts = 0`.
- "Dừng tất cả": tạm dừng dispatcher, job đang chạy → `Đã dừng`. "Chạy hàng đợi" hoặc thêm job mới sẽ mở lại.

Health check chạy mỗi 60 giây cho mọi tài khoản enabled và ngay khi thêm/bật/bấm kiểm tra.

## 5. Bảo mật
- Credential mã hóa AES-256-GCM, khóa từ `CREDENTIAL_KEY` (bắt buộc ở production; dev tự tạo `.data/credential.key`). API không bao giờ trả credential.
- Đăng nhập bằng **VAWAY ID** (id.vaway.vn), form nhúng `<vaway-login>` + bộ nạp SSO v3. Kit chép ở `src/server/vaid-kit/` (nguồn: `vaid-integration-kit-v2`, không sửa tay), logic ở `src/server/auth.ts`.
- Phiên là cookie `muse_session` (HttpOnly, SameSite=Lax, Secure ở production) ký HMAC bằng khóa dẫn xuất từ `CREDENTIAL_KEY`, hạn 7 ngày; không lưu phiên ở DB nên sống qua restart. Mọi `/api` (trừ `/api/auth/*`) và `/media` đều qua `requireAuth`.
- `LOGIN_MODE=admin` (mặc định): mỗi request kiểm lại quyền admin với id qua bộ nhớ đệm 60 giây; id lỗi thì từ chối (fail closed); gỡ admin ở id thì mất quyền sau tối đa 60 giây.
- Production thiếu `VAID_APP_ID`/`VAID_APP_SECRET`/`VAID_PUBLIC_URL` (https) thì server từ chối khởi động. Không còn đăng nhập bằng mã truy cập.
- Đăng xuất hai chiều: nút Đăng xuất xóa phiên rồi chuyển tới `id.vaway.vn/connect/vaidsignout`; id đăng xuất thì gọi `/api/auth/vaid/signout?local=1` để xóa phiên tại đây.
- Endpoint: `POST /api/auth/vaid/code` (form nhúng), `GET /api/auth/vaid` (callback bộ nạp, một `access_verify` dùng một lần, 10 lần/phút/IP), `GET /api/auth/vaid/signout?local=1`, `POST /api/auth/logout`, `GET /api/auth/status`.
- Server tự kiểm tra ảnh upload bằng magic bytes và dung lượng thực.

## 6. Định tuyến URL
`?view=batch|studio|accounts|library|progress`.
