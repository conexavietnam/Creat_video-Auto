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
`?view=batch|studio|accounts|library|progress`. Khu quản trị dùng đường dẫn thật `/admin` (`?tab=providers|settings|stats|audit`).

## 7. Khu quản trị `/admin` (ADM-A, backend)
Chỉ superadmin vào được; thiết kế đã chốt ở `docs/plans/active/2026-10-21-admin-console.md`.

- **Phân quyền:** `SUPERADMIN_VAIDS` (danh sách VAWAY ID, dấu phẩy). Không đặt hoặc rỗng thì không ai vào được (fail closed, server chỉ cảnh báo lúc khởi động, không dừng). `requireSuperAdmin` (`src/server/auth.ts`) đứng sau `requireAuth`, người không đủ quyền nhận **404**. Người chưa đăng nhập vẫn nhận 401 từ `requireAuth`. Admin của app (`LOGIN_MODE=admin`) không tự động là superadmin.
- **Route:** `src/server/admin.ts`, mount tại `/api/admin` (`server.ts`). Hợp đồng ở file kế hoạch, riêng hai điểm bổ sung khi cài đặt: `GET /api/admin/audit` trả `{ items: [{id, at, actorVaid, action, target, detail}], nextBefore }` (`detail` đã là object, `nextBefore` null khi hết trang); `GET /api/admin/providers` có thêm `credentialHint` và `settings.effectiveModel` là model đang dùng thật (DB hoặc dự phòng env).
- **Khóa API vẫn ở bảng `accounts`.** `src/server/accountOps.ts` là nơi duy nhất thêm/thay/xóa khóa, dùng chung cho `/api/admin/*` và nhóm `/api/accounts` (`src/server/accountRoutes.ts`). Ở nhóm cũ, `POST`, `PATCH /:id`, `DELETE /:id` cần superadmin; đọc, bật/tắt, kiểm tra sức khỏe giữ cho mọi admin.
- **Không lộ khóa:** API chỉ trả `maskedIdentifier`; `admin_audit_log` chỉ lưu trước/sau của các trường an toàn (`src/server/audit.ts` còn tự bỏ mọi khóa có tên credential/secret/token/password/api key). Thay khóa lưu mã che cũ và mới (băm một chiều, không đảo ngược được).
- **Cấu hình provider ở DB** (`provider_settings`, `src/server/providerConfig.ts`): `enabled`, `model`, `base_url`, đơn giá, ghi chú; nạp vào bộ nhớ khi khởi động, làm mới ngay sau mỗi lần `PUT` và 10 giây một lần. Veo dùng `model`; Kling dùng `model` và `base_url`; chưa có hàng thì dùng env. `enabled=false` được cài ở `src/server/providers/index.ts` (thuộc tính `available` của mọi provider tự phản ánh công tắc), nên `resolveProvider`, dispatcher, thêm tài khoản đều thấy mà không phải sửa. Job đang chạy của provider vừa bị tắt vẫn được poll tiếp, job chờ thì nằm yên cho tới khi bật lại.
- **Thống kê** (`src/server/adminStats.ts`): SQL gộp, ngày theo `Asia/Ho_Chi_Minh` (giả định cột `timestamp` lưu giờ UTC, đúng khi máy chủ và Postgres đặt múi giờ UTC). `totals`, `perProvider`, `perAccount`, `topErrors`, `retries` tính trên job **tạo** trong khoảng ngày, theo trạng thái hiện tại; `perDay.completed/failed` tính theo ngày **kết thúc**. `queue` là toàn thời gian. Thời gian hoàn thành lấy từ lần chạy cuối của job (retry đặt lại `started_at`). `perAccount` chỉ có job còn giữ `account_id` (job xếp lại hàng chờ bị xóa liên kết). Chi phí chỉ là ước tính `giây video × đơn giá`.
- **Kiểm thử:** `npm test` (`node --test`, thư mục `tests/`) cần một Postgres riêng với `SQL_DB_NAME` kết thúc bằng `_test` (bộ test xóa dữ liệu bảng, từ chối chạy nếu tên khác). CI dựng sẵn Postgres cho việc này.

## 8. Giao diện `/admin` (ADM-B)
- **Mã nguồn:** `src/admin/` (`AdminApp.tsx` khung + 4 tab `ProvidersTab`, `SettingsTab`, `StatsTab`, `AuditTab`; `adminApi.ts` lớp gọi API; `types.ts` kiểu theo hợp đồng; `mock.ts` dữ liệu giả). `App.tsx` chỉ thêm một nhánh: `pathname === '/admin'` thì dựng `AdminApp` (sau cổng đăng nhập, không tải `/api/state` và kho ảnh).
- **Quyền:** giao diện không tự quyết. `AdminApp` gọi `GET /api/admin/me`; 404 thì hiện trang "Không tìm thấy trang" (không gợi ý có khu admin). Header app chính chỉ hiện liên kết "Quản trị" khi `/api/admin/me` thành công; tab Tài khoản ở app chính là chỉ xem (bật/tắt, kiểm tra sức khỏe) và chỉ superadmin thấy lối sang `/admin`.
- **Dữ liệu giả:** `/admin?mock=1` (mọi thao tác chạy trong bộ nhớ) và `/admin?mock=denied` (giả lập 404). Chỉ hoạt động khi `import.meta.env.DEV`; bản production không chứa mã dữ liệu giả.
- **Khóa:** ô nhập là `type=password`, xóa sạch ngay khi gửi, không lưu ở state lâu hơn lúc gửi hay ở `localStorage`/`sessionStorage`, không hiện lại sau khi lưu. Xóa khóa có hộp xác nhận.
- **Biểu đồ thống kê** vẽ bằng SVG tự viết (không thêm thư viện), co giãn theo bề rộng khung, cuộn ngang khi khoảng ngày dài.
- Ảnh chụp từng tab: `docs/screenshots/admin/`.

## 9. Độ tin cậy dispatcher & hai nền tảng thật (W1-A)

### Quy tắc mới của dispatcher (mục tiêu: không gửi lại job mà nền tảng có thể vẫn đang xử lý)
- **Health check mềm:** chỉ `AUTH_FAILED` hoặc lỗi vĩnh viễn (không giải mã được khóa, nền tảng không còn) mới đưa tài khoản Offline ngay. Lỗi khác (timeout, mạng, 5xx) phải thất bại **liên tiếp 3 lần** mới Offline; trong lúc đó trạng thái giữ nguyên và `healthReason` ghi "lần i/3". Một lần thành công xóa bộ đếm. Bộ đếm nằm trong bộ nhớ. Chỉ khi tài khoản thực sự Offline mới trả job đang chạy về Chờ.
- **Poll lỗi tạm thời giữ nguyên job:** mạng, 5xx, 429, JSON hỏng đều giữ job `running` và thử lại ở lần poll sau (không đụng `last_progress_at`, nên timeout 15 phút vẫn là chốt chặn cuối). Từ **10 lần lỗi liên tiếp** mới coi là `PROVIDER_ERROR` (retryable). `AUTH_FAILED` khi poll thì tài khoản Offline và job **thất bại** (không gửi lại) kèm cảnh báo "video có thể đã được tạo và tính phí, kiểm tra tại nền tảng trước khi thử lại".
- **Khôi phục khi khởi động:** job `running` chưa có `external_id` (gửi dở lúc server tắt) được xếp lại ngay, không tính retry (mã `SERVER_RESTART`). Job đã có `external_id` tiếp tục được poll.
- **Hết hạn mức (`QUOTA_EXHAUSTED`):** job thất bại ngay, không retry; tài khoản vào cooldown 30 phút với `healthReason` bắt đầu bằng "Hết hạn mức: ..." (hiện ở `/admin`); health check tự động giữ nguyên cảnh báo đó, bấm "Kiểm tra" thủ công hoặc thay khóa thì gỡ cooldown. Giới hạn tốc độ tạm thời (`RATE_LIMITED`) chỉ cho tài khoản nghỉ 60 giây và job được thử lại.
- **Rủi ro còn lại (chưa xử lý được):** Veo và Kling chưa có API hủy trong adapter (`cancel` là no-op). Khi quản trị viên tắt/xóa tài khoản, hoặc khóa bị từ chối lúc gửi (`AUTH_FAILED`), các job đang chạy của tài khoản đó vẫn bị đưa về Chờ và gửi lại sang khóa khác, có thể tính phí hai lần. Lỗi mạng ngay lúc gửi job cũng có thể tạo một thao tác bên nền tảng mà hệ thống không biết.

### Kling
- `text2video` nhận `aspect_ratio`. `image2video` **không** có tham số này (theo các bản sao tài liệu tham chiếu Kling, chưa mở được trang chính thức từ môi trường phát triển): tỉ lệ lấy theo ảnh đầu vào. Vì vậy `validate()` đọc kích thước ảnh và từ chối khi tỉ lệ người dùng chọn không khớp ảnh ("Kling image-to-video lấy tỉ lệ theo ảnh đầu vào..."), cũng từ chối ảnh dưới 300×300 pixel. Ảnh không đọc được kích thước thì không chặn.

### Veo (Gemini API): điều kiện để tạo được video
1. **Khóa phải thuộc dự án Google đã bật thanh toán (paid tier).** Gói miễn phí không có hạn mức Veo, gọi sẽ nhận `429 RESOURCE_EXHAUSTED: You exceeded your current quota, please check your plan and billing details`. Gói thuê bao Google AI Pro dùng trong ứng dụng Gemini/Flow là thứ khác với thanh toán của Gemini API. Phải bật thanh toán cho **từng dự án** chứa khóa. Có báo cáo trên diễn đàn Google rằng tài khoản mới bật thanh toán đôi khi vẫn bị giữ hạn mức miễn phí một thời gian.
2. Tên model dùng cho Veo 3.1: `veo-3.1-generate-preview` (mặc định) hoặc `veo-3.1-fast-generate-preview` (nhanh, rẻ hơn, đặt ở `/admin` ô Model). Veo 3.0 đã được Google đánh dấu ngừng cho Gemini API.
3. Thông số: `aspectRatio` 16:9 hoặc 9:16; `durationSeconds` 4, 6 hoặc 8; ảnh tham chiếu `@tag` tối đa 3 và chỉ khi 8 giây (và 16:9); ảnh đầu khung và ảnh tham chiếu không dùng đồng thời. Adapter chặn các tổ hợp sai ngay khi thêm vào hàng đợi.
4. Luồng: gọi tạo video → nhận mã thao tác dài hạn → hỏi trạng thái tới khi `done` → lấy `generatedVideos[0].video.uri` → tải bằng header `x-goog-api-key` (theo chuyển hướng). Hệ thống tải về `.data/videos` ngay khi xong vì liên kết của Google chỉ tạm thời.
5. Chi phí tính theo giây video, không phụ thuộc video có bị xóa sau đó hay không. Đơn giá khai báo ở `/admin` chỉ để ước tính.
6. Kiểm chứng: bấm "Kiểm tra" ở `/admin` chỉ chứng minh khóa hợp lệ, **không** chứng minh có hạn mức Veo (lỗi 429 chỉ xuất hiện khi gọi tạo video). Cách chắc chắn duy nhất là thử một prompt ngắn nhất (4 giây).

