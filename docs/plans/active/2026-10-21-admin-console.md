# Khu quản trị `/admin` (chỉ info@vaway.vn)

Yêu cầu của anh (21/10/2026): một khu `/admin` riêng, **chỉ nick `info@vaway.vn` (VAWAY ID số `1`) vào được**, dùng để (1) cài đặt API Veo 3 và các nhà cung cấp nền tảng khác, (2) chỉnh các thông số hệ thống, (3) xem thống kê.

Hai task bên dưới **tách theo lớp** (backend / giao diện) để chạy song song được nhờ hợp đồng API cố định ở mục 3. Chạy **sau Sóng 1** (W1-A, W1-B) để khỏi xung đột file, xem mục 5.

## 1. Quyết định thiết kế (đã chốt, agent không tự đổi)

1. **Ai vào được `/admin`:** biến môi trường `SUPERADMIN_VAIDS` (danh sách VAWAY ID, cách nhau dấu phẩy). Production đặt `SUPERADMIN_VAIDS=1`. **Không đặt = không ai vào được** (fail closed, không có giá trị mặc định). Người chỉ là admin của app ở id (qua `LOGIN_MODE=admin`) **không** vào được `/admin`.
2. **Mọi route `/api/admin/*` kiểm quyền ở server**, không tin cờ phía trình duyệt. Người không đủ quyền nhận **404** (không lộ rằng khu admin tồn tại). Trang `/admin` trong SPA gọi `GET /api/admin/me`; 404 thì hiện trang "Không tìm thấy".
3. **Khóa API (credential) vẫn lưu ở bảng `accounts`** (dispatcher đang dựa vào đó, mỗi khóa = một "tài khoản" có số slot). `/admin` là nơi **duy nhất** thêm, xóa, thay khóa. Các route ghi `POST/DELETE /api/accounts…` đổi sang yêu cầu quyền superadmin. Tab "Tài khoản" ở app chính chuyển thành **chỉ xem** (trạng thái, bật/tắt) cộng liên kết sang `/admin` cho superadmin.
4. **Khóa không bao giờ trả ra ngoài:** API chỉ trả `maskedIdentifier` (`usr_***xxxx`). Thay khóa = nhập khóa mới, mã hóa lại bằng `encryptCredential`. Không log khóa, không đưa khóa vào nhật ký kiểm toán.
5. **Cấu hình nhà cung cấp ở DB, có dự phòng env:** model, base URL, bật/tắt đọc từ bảng `provider_settings`; chưa có hàng thì dùng env hiện tại (`VEO_MODEL`, `KLING_MODEL`, `KLING_BASE_URL`). Thay đổi có hiệu lực ngay, không cần restart.
6. **Thêm nhà cung cấp mới** (Runway, Luma, MiniMax, fal.ai…) là việc **viết adapter riêng**, ngoài phạm vi hai task này. `/admin` phải tự hiển thị mọi provider có trong registry (`src/server/providers/index.ts`), nên adapter mới chỉ cần đăng ký là có chỗ cài đặt.
7. **Chi phí chỉ là ước tính:** nền tảng không trả giá cho từng video. Superadmin nhập **đơn giá USD/giây video** cho từng provider; thống kê = tổng giây video hoàn thành × đơn giá. Ghi rõ trên giao diện: "Ước tính, không phải hóa đơn của nền tảng; chưa gồm các lần thử lại thất bại".

## 2. Dữ liệu mới (thêm vào `src/db/schema.ts` và `src/server/migrate.ts`, kiểu `CREATE TABLE IF NOT EXISTS`)

```sql
provider_settings (
  provider_id text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  model text,                          -- null = dùng env/mặc định của adapter
  base_url text,                       -- null = mặc định
  price_per_second_usd numeric(10,4),  -- null = chưa khai báo
  notes text,
  updated_at timestamp DEFAULT now(),
  updated_by text
)
admin_audit_log (
  id serial PRIMARY KEY,
  at timestamp NOT NULL DEFAULT now(),
  actor_vaid text NOT NULL,
  action text NOT NULL,                -- vd 'account.add', 'account.delete', 'account.rotate', 'provider.update', 'settings.update'
  target text,                         -- vd 'veo#12'
  detail text                          -- JSON TRƯỚC/SAU đã loại mọi trường bí mật
)
```
`app_settings` giữ nguyên (đã có `concurrencyLimit`, `maxRetries`, `timeoutMinutes`, `defaultDuration`, `defaultAspectRatio`, `defaultProviderId`, `autoEnqueueOnPaste`).

## 3. Hợp đồng API (cố định, backend cài đặt, giao diện dùng)

Mọi phản hồi dạng `{ success: boolean, data?, error? }`, lỗi bằng tiếng Việt. Tất cả nằm sau `requireAuth` **và** `requireSuperAdmin`.

| Route | Việc |
|---|---|
| `GET /api/admin/me` | `{ vaid, name }` của người đang đăng nhập nếu là superadmin, ngược lại 404 |
| `GET /api/admin/providers` | Mỗi provider: `id, label, kind, available, unavailableReason, capabilities, settings{enabled, model, baseUrl, pricePerSecondUsd, notes, effectiveModel}, accounts[{id, name, maskedIdentifier, isEnabled, sessionStatus, healthReason, maxSlots, currentRunningJobs, lastHealthCheck}]` |
| `PUT /api/admin/providers/:id` | Sửa `enabled, model, baseUrl, pricePerSecondUsd, notes` (kiểm tra kiểu và độ dài; `baseUrl` phải `https://`) |
| `POST /api/admin/providers/:id/accounts` | Thêm khóa `{ name, credential, maxSlots }`, chạy health check ngay, trả tài khoản (đã che) |
| `PUT /api/admin/accounts/:id/credential` | Thay khóa `{ credential }`, chạy lại health check |
| `PATCH /api/admin/accounts/:id` | Sửa `name, maxSlots, isEnabled` |
| `DELETE /api/admin/accounts/:id` | Xóa (job đang chạy được trả về Chờ như hiện nay) |
| `POST /api/admin/accounts/:id/health` | Kiểm tra sức khỏe ngay |
| `GET /api/admin/settings` / `PUT /api/admin/settings` | Đọc/ghi `app_settings` (giữ các giới hạn hiện có trong `PUT /api/settings`) |
| `GET /api/admin/stats?from=YYYY-MM-DD&to=YYYY-MM-DD` | Thống kê, xem dưới |
| `GET /api/admin/audit?limit=50&before=<id>` | Nhật ký kiểm toán, mới nhất trước |

`GET /api/admin/stats` trả (mặc định 30 ngày gần nhất, tối đa 365):
```
{
  range: { from, to },
  totals: { jobs, completed, failed, stopped, pending, running, successRate },   // successRate = completed / (completed+failed), null nếu mẫu = 0
  perDay: [{ date, created, completed, failed }],
  perProvider: [{ providerId, jobs, completed, failed, successRate, videoSeconds, estimatedCostUsd|null, avgCompleteSeconds, p95CompleteSeconds }],
  perAccount: [{ accountId, name, providerId, jobs, completed, failed }],
  topErrors: [{ errorCode, count, lastMessage }],
  queue: { pending, running, oldestPendingAgeSeconds|null },
  retries: { jobsWithRetry, totalExtraAttempts }
}
```
Tính bằng SQL gộp (`GROUP BY`) chứ không kéo cả bảng `video_jobs` về Node. `estimatedCostUsd` = `videoSeconds × price_per_second_usd`, `null` nếu chưa khai báo đơn giá.

## 4. Task

| Task | Độ khó | Model | Vì sao | Chạy |
|---|---|---|---|---|
| ADM-A (backend) | KHÓ | Sonnet 5 | Phân quyền, đổi hợp đồng ghi khóa, schema, SQL thống kê | Sau Sóng 1; song song với ADM-B |
| ADM-B (giao diện) | TRUNG BÌNH | Haiku 4.5 | Giao diện theo hợp đồng cố định, không có logic bảo mật | Sau Sóng 1; song song với ADM-A (dùng dữ liệu giả cho tới khi ADM-A merge) |

### ADM-A — Backend `/api/admin/*`

> Repo `conexavietnam/Creat_video-Auto` (Muse Batch Manager, Express + Drizzle + Postgres). Đọc `docs/plans/active/2026-10-21-admin-console.md` (mục 1, 2, 3), `docs/ARCHITECTURE.md` mục 5 và `src/server/auth.ts` trước khi viết. **Chỉ sửa:** file mới `src/server/admin.ts` (router) và `src/server/providerConfig.ts` (đọc cấu hình provider), `src/db/schema.ts`, `src/server/migrate.ts`, `src/server/auth.ts` (thêm `requireSuperAdmin`, `isSuperAdminVaid`), `server.ts` (mount router, đổi quyền cho `POST/DELETE /api/accounts…`), và thêm 2–4 dòng vào `src/server/providers/veo.ts` / `kling.ts` để đọc model/baseUrl từ `providerConfig`. Không đụng `dispatcher.ts`, frontend.
>
> 1. **Quyền:** `SUPERADMIN_VAIDS` như mục 1. `requireSuperAdmin` đứng sau `requireAuth`, trả **404** với người không đủ quyền. Production thiếu biến này thì **không** làm server lỗi, nhưng mọi `/api/admin/*` phải trả 404 (fail closed) và ghi một dòng cảnh báo khi khởi động.
> 2. **Schema + migrate:** hai bảng ở mục 2, kiểu `IF NOT EXISTS`, chạy lặp lại không lỗi.
> 3. **`providerConfig.ts`:** `getProviderConfig(providerId)` đọc `provider_settings` có bộ nhớ đệm ngắn (≤10 giây, xóa khi `PUT`), trả `{ enabled, model, baseUrl }` với dự phòng env. Provider bị `enabled=false` thì `provider.available` hiệu dụng là false (dispatcher và `resolveProvider` phải bỏ qua) với lý do "Đã bị quản trị viên tắt". Sửa tối thiểu: Veo dùng `model`, Kling dùng `model` và `baseUrl` từ cấu hình.
> 4. **Router `/api/admin/*`** đúng hợp đồng mục 3. Thêm/thay khóa dùng `encryptCredential`, `maskIdentifier`, `checkAccountHealth` như `server.ts` đang làm. Mỗi thao tác ghi (`account.add|rotate|delete`, `provider.update`, `settings.update`) ghi một dòng `admin_audit_log`; `detail` chứa giá trị trước/sau **đã loại khóa**.
> 5. **Đổi quyền ghi khóa:** `POST /api/accounts`, `DELETE /api/accounts/:id`, `PATCH /api/accounts/:id` (đổi `maxSlots`/`name`) chuyển sang `requireSuperAdmin`; `GET /api/accounts`, bật/tắt và health check giữ cho mọi admin. (Có thể gọi lại cùng hàm xử lý với router admin để khỏi lặp code.)
> 6. **Thống kê** bằng SQL gộp theo mục 3. Khoảng ngày quá 365 hoặc sai định dạng thì 400. Ngày tính theo múi giờ `Asia/Ho_Chi_Minh`.
> 7. **Kiểm thử** (`node --test`, thêm `npm test`): (a) người không phải superadmin gọi **từng** route admin đều nhận 404, kể cả khi đã đăng nhập hợp lệ (duyệt danh sách route để không sót); (b) không đặt `SUPERADMIN_VAIDS` thì 404 cho tất cả; (c) **không phản hồi nào chứa chuỗi khóa vừa nhập** (gửi khóa chứa một chuỗi đánh dấu duy nhất rồi dò mọi phản hồi và `admin_audit_log`); (d) thống kê đúng trên bộ job mẫu có 3 provider, có job retry, có lỗi; (e) `provider_settings.enabled=false` làm provider không còn được chọn. Dùng provider giả, không gọi API thật. `npm run lint` và `npm run build` phải qua.
> 8. Cập nhật `docs/ARCHITECTURE.md`, `docs/PROGRESS.md`, `docs/STATUS.md`, `.env.example` (`SUPERADMIN_VAIDS`). Làm trên nhánh riêng `feature/admin-api`, commit nhỏ, không push `main`.

### ADM-B — Giao diện `/admin`

> Repo `conexavietnam/Creat_video-Auto`. Đọc `docs/plans/active/2026-10-21-admin-console.md` (mục 1 và 3). **Chỉ sửa:** thư mục mới `src/admin/` (trang và component), `src/App.tsx` (một nhánh định tuyến), `src/components/AccountPoolView.tsx` (chuyển thành chỉ xem), `src/api.ts` (hàm gọi API admin). Không đụng backend. Backend có thể chưa xong khi anh bắt đầu: viết một lớp `adminApi` có công tắc dữ liệu giả (`?mock=1`, chỉ bật khi `import.meta.env.DEV`) trả đúng hình dạng ở mục 3.
>
> 1. **Định tuyến:** đường dẫn thật `/admin` (không dùng `?view=`). `App.tsx` nhận ra `location.pathname === '/admin'` thì dựng `AdminApp`. Gọi `GET /api/admin/me`; 404 thì hiện trang "Không tìm thấy trang" (cùng kiểu giao diện, không gợi ý có khu admin). Header admin có liên kết về app chính và nút Đăng xuất dùng lại `logout()` có sẵn. Trên header app chính, **chỉ khi** `/api/admin/me` thành công mới hiện liên kết "Quản trị".
> 2. **Bốn tab:** `Nhà cung cấp` · `Thông số` · `Thống kê` · `Nhật ký`. URL giữ tab (`/admin?tab=stats`).
> 3. **Nhà cung cấp:** mỗi provider một thẻ: tên, trạng thái khả dụng + lý do, công tắc bật/tắt, ô model, base URL (chỉ `https://`), đơn giá USD/giây, ghi chú, nút Lưu. Bên dưới là danh sách khóa: tên, mã che, Online/Offline kèm chữ (không chỉ màu), lý do sức khỏe, số slot, nút Kiểm tra, Thay khóa, Xóa (có hộp xác nhận), và biểu mẫu "Thêm khóa" (ô credential là `type=password`, có gợi ý `credentialHint` của provider, sau khi lưu thì xóa sạch ô). Provider `available=false` vẫn hiện nhưng không cho thêm khóa. Không bao giờ hiển thị hay lưu khóa ở `localStorage`/state lâu hơn khi gửi.
> 4. **Thông số:** biểu mẫu cho `concurrencyLimit` (1–50), `maxRetries` (0–10), `timeoutMinutes` (1–240), thời lượng và tỉ lệ mặc định, provider mặc định (`auto` hoặc một provider), `autoEnqueueOnPaste`. Báo lỗi ngay trên ô sai.
> 5. **Thống kê:** chọn khoảng ngày (mặc định 30 ngày), các thẻ tổng (tổng job, hoàn thành, thất bại, tỉ lệ thành công, đang chạy/chờ, ước tính chi phí), biểu đồ cột theo ngày (SVG hoặc canvas tự vẽ, không thêm thư viện nặng), bảng theo provider, bảng theo khóa, bảng lỗi thường gặp. Dòng chú thích bắt buộc: "Chi phí là ước tính theo đơn giá anh khai báo, không phải hóa đơn của nền tảng, chưa gồm lần thử lại thất bại". Giá trị `null` hiện "Chưa khai báo đơn giá".
> 6. **Nhật ký:** bảng mới nhất trước, có nút "Tải thêm" (`before=<id>`).
> 7. **Tab Tài khoản ở app chính:** bỏ nút Thêm/Xóa/Sửa khóa, chỉ còn danh sách trạng thái, bật/tắt và liên kết "Quản lý khóa API tại Quản trị" (chỉ hiện với superadmin).
> 8. **Chất lượng:** 100% tiếng Việt, đúng phong cách hiện có (Oswald cho tiêu đề, Roboto cho nội dung, thẻ phẳng viền mảnh), dùng được ở màn hình 360px, thao tác chính dùng được bằng bàn phím. `npm run lint` và `npm run build` qua. Chụp ảnh màn hình từng tab (bản dữ liệu giả) đính vào mô tả nhánh. Cập nhật `docs/PROGRESS.md`, `docs/STATUS.md`. Nhánh riêng `feature/admin-ui`, không push `main`.

## 5. Thứ tự

1. **Sóng 1** (W1-A ∥ W1-B) trước. W1-A sửa `dispatcher.ts` và `providers/*`, W1-B sửa `server.ts`, kho ảnh, Studio. ADM-A và ADM-B cùng đụng `server.ts`, `App.tsx`, `providers/veo.ts`, `kling.ts` nên chạy sau để khỏi xung đột.
2. **Sóng 2** (ADM-A ∥ ADM-B). ADM-B dùng dữ liệu giả nên không phải đợi ADM-A.
3. Claude review ADM-A trước (checkpoint KHÓ: phân quyền và khóa), rồi ADM-B, merge, đặt `SUPERADMIN_VAIDS=1` vào `app.env` trên VPS .48, deploy, kiểm bằng trình duyệt: tài khoản `info@vaway.vn` vào được `/admin`; một admin khác (nếu có) nhận 404.

## 6. Nghiệm thu

- **AD-01** Người đăng nhập hợp lệ nhưng không thuộc `SUPERADMIN_VAIDS` gọi `/api/admin/me` và mọi route admin đều nhận 404.
- **AD-02** Không đặt `SUPERADMIN_VAIDS` thì không ai vào được `/admin`.
- **AD-03** Thêm khóa Veo ở `/admin`: khóa được che, health check chạy, dispatcher thấy tài khoản mới; không phản hồi hay nhật ký nào chứa khóa.
- **AD-04** Tắt provider ở `/admin` thì `POST /api/queue/enqueue` chọn provider đó bị từ chối kèm lý do; bật lại thì chạy được.
- **AD-05** Đổi model Veo ở `/admin` có hiệu lực cho job kế tiếp mà không cần restart.
- **AD-06** Thống kê khớp với đếm tay trên bộ job mẫu; tỉ lệ thành công là `null` khi chưa có mẫu.
- **AD-07** Mọi thao tác ghi xuất hiện ở tab Nhật ký với người thực hiện và giá trị trước/sau không chứa khóa.
- **AD-08** Tab Tài khoản ở app chính không còn thêm/xóa khóa được.
