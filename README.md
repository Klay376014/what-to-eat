# what-to-eat

提案午餐／晚餐要吃哪間餐廳，投票定案後寫進共用日曆。2~3 人共用。

## Stack

- Vite+ monorepo（`vp` 統一 dev / build / test / lint / format）
- `apps/web` — Vue 3 + TypeScript
- `packages/utils` — 共用邏輯

## Commands

```bash
vp install        # 安裝依賴
vp run dev        # 啟動 apps/web 開發伺服器
vp check --fix    # format + lint + type check
vp run -r test    # 跑全部測試
vp run -r build   # 建置全部
vp run ready      # check + test + build
```

## 登入（Google）

只用 Google 登入，而且只能要 `openid email profile` 這三個 scope（原因與驗證紀錄見 `docs/adr/0001-google-sign-in-scopes.md`）。

1. `apps/web/.env` 填 `VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`（見 `apps/web/.env.example`）。
2. Google Cloud → Google Auth Platform → Clients：建一個 **Web application** client 專給登入用（不要和日曆的 client 共用），Authorised redirect URI 填 `https://<project-ref>.supabase.co/auth/v1/callback`。Data Access 只留 `openid`、`userinfo.email`、`userinfo.profile`。
3. Supabase dashboard → Authentication → Sign In / Providers → Google：填 client ID / secret 並啟用；同一頁把 Email provider 關掉（Google 是唯一登入方式）。URL Configuration 的 Site URL / Redirect URLs 加上前端網址（本機是 `http://localhost:5173/**`；結尾的 `/**` 不能省，app 送出的網址帶斜線，少了它比對會失敗、登入後被導回 Site URL）。
4. `vp run auth:check-scopes`：確認 hosted 專案實際向 Google 要的 scope 沒有超出 `openid email profile`，結果補進 ADR 的驗證表。

## 日曆（Google Calendar，#12）

定案的餐會寫進一個以旅程命名的**次要日曆**，旅程成員是與會者，所以會直接出現在他們自己的日曆裡。連接日曆是和登入分開的授權，只用 `calendar.app.created` 這個 scope（原因見 `docs/adr/0001-google-sign-in-scopes.md`；寫入流程見 `docs/adr/0006-calendar-sync-queue.md`）。refresh token 只存在資料庫，只有 Edge Function `calendar` 讀得到。

1. Google Cloud（和登入同一個專案即可）→ APIs & Services → Library：啟用 **Google Calendar API**。
2. Google Auth Platform → Data Access：加上 `https://www.googleapis.com/auth/calendar.app.created`。不要加更寬的 Calendar scope：這個 scope 不是 sensitive，所以同意畫面沒有「未驗證的應用程式」警告（#2 實測）；換成更寬的會讓警告回來。
3. Clients → 另建一個 **Web application** client 專給日曆用（不要和登入的共用）。Authorised redirect URIs 填 app 的網址本身：`http://localhost:5173/` 和 `https://klay376014.github.io/what-to-eat/app/`（結尾斜線要有，app 送出的就是 `origin + pathname`）。
4. `apps/web/.env` 填 `VITE_GOOGLE_CALENDAR_CLIENT_ID`（client ID 是公開的）；GitHub → Settings → Secrets and variables → Actions → **Variables** 加 `GOOGLE_CALENDAR_CLIENT_ID`，部署時編進前端。沒設的話 app 照常運作，只是按「Connect Google Calendar」會說還沒設定。
5. Edge Function 的 secrets（client secret 只放這裡）：

   ```bash
   supabase secrets set GOOGLE_CALENDAR_CLIENT_ID=... GOOGLE_CALENDAR_CLIENT_SECRET=...
   ```

6. `vp run db:push` 套用 migration，`vp run functions:deploy` 部署全部 Edge Function（含 `calendar`；`supabase/config.toml` 設了 `verify_jwt = false`：平台的 JWT 檢查只認舊版 key，改由函式自己驗 session）。

## Google Maps 短網址（#9）

提案時貼上 `maps.app.goo.gl` 短網址，Edge Function `maps-link` 會問出它指向的地點，自動填入餐廳名稱，並把座標與 CID 存在提案的連結旁邊。這依賴 Google 沒有公開的網址格式，隨時可能失效；失效時只是不再自動填名稱，提案照常（設計見 `docs/adr/0007-maps-link-resolution.md`）。每個短網址只要 Google 有回答就只查一次，結果（包括「不是地點」和 404）永久存在 `public.maps_links`；逾時、連線失敗、429／5xx 不存，下次貼上會再查。提案和日曆事件的「Open in Google Maps」直接開原本貼上的連結（會到店家頁面）；沒有連結時才用官方 Maps URLs 搜尋名稱。

不需要任何 secret 或 API key：`vp run db:push` 套用 migration，`vp run functions:deploy` 部署 `maps-link`（`calendar` 也要重新部署，日曆事件的連結改用原本貼上的連結）。要整個關掉的話，刪掉這個函式（`supabase functions delete maps-link`）就好，app 會當成每個連結都查不到。

## Email（每日摘要與定案通知，#15）

每個旅程在**旅程時區的 08:00** 寄一封每日摘要給目前的成員（列出上一封之後的新提案、以及還在等你投票的餐；旅程的第一封只回看 24 小時；沒有新提案就不寄）；餐被定案、改掉或取消時，立刻寄信給其他成員。信由 Edge Function `notify` 透過 [Resend](https://resend.com) 寄出，寄件者 `What to eat <notify@mail.ivy-cudgel.com>`。資料庫每分鐘用 pg_cron + pg_net 叫一次 `notify`（有事要做才叫）；app 在定案後也會直接叫它，讓定案信馬上寄出。設計見 `docs/adr/0009-email-notifications.md`。

API key 只放在 Edge Function 的 secrets，不會到瀏覽器，也不會出現在 log。

1. **Resend**：註冊 → Domains → Add Domain：`mail.ivy-cudgel.com`。依畫面在 `ivy-cudgel.com` 的 DNS 加上它列出的紀錄（值以 Resend 畫面為準，通常是）：
   - `MX`　`send.mail`　→ `feedback-smtp.<region>.amazonses.com`（priority 10）
   - `TXT`　`send.mail`　→ `v=spf1 include:amazonses.com ~all`
   - `TXT`　`resend._domainkey.mail`　→ Resend 給的 DKIM 公鑰
   - （建議）`TXT`　`_dmarc.mail`　→ `v=DMARC1; p=none;`

   等 Resend 顯示 Verified。驗證完成前，Resend 只肯寄給你自己的帳號信箱。然後 API Keys → Create API Key（權限選 **Sending access**，限定這個 domain）。

2. **Edge Function 的 secrets**。`NOTIFY_SECRET` 是資料庫叫 `notify` 時帶的共用密碼，自己產生一個：

   ```bash
   openssl rand -hex 32   # 記下來，第 4 步還要用
   supabase secrets set RESEND_API_KEY=re_... NOTIFY_SECRET=<上面那串>
   ```

   `EMAIL_FROM`（預設 `What to eat <notify@mail.ivy-cudgel.com>`）和 `APP_URL`（預設 `https://klay376014.github.io/what-to-eat/app/`，信裡的連結都指向它）要改才設。不想讓 key 留在 shell history 的話，寫進一個暫存檔再用 `supabase secrets set --env-file <檔案>`，用完刪掉。

3. `vp run db:push` 套用 migration（會啟用 `pg_cron`、`pg_net`，並排好每分鐘的 `notify` 工作），`vp run functions:deploy` 部署 `notify`（`verify_jwt = false`：資料庫的呼叫沒有 JWT，由函式自己檢查密碼或 session）。

4. **一次性：把函式的網址和密碼放進 Vault**（Supabase dashboard → SQL Editor 執行；`<project-ref>` 換成專案 ref，密碼和第 2 步的 `NOTIFY_SECRET` 相同）：

   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/notify', 'notify_url');
   select vault.create_secret('<NOTIFY_SECRET 的值>', 'notify_secret');
   ```

   在這兩個 secret 存在之前，排程什麼都不做（本機和 CI 也是如此）。之後要換密碼：先 `supabase secrets set NOTIFY_SECRET=<新的>`，再

   ```sql
   select vault.update_secret((select id from vault.secrets where name = 'notify_secret'), '<新的>');
   ```

5. **試寄**：在 app 裡定案一個餐，其他成員（用另一個帳號，或先邀請自己的第二個信箱）幾秒內會收到信。也可以直接叫一次排程會做的事：

   ```bash
   curl -X POST https://<project-ref>.supabase.co/functions/v1/notify \
     -H "x-notify-secret: <NOTIFY_SECRET>" -H "Content-Type: application/json" -d '{}'
   ```

   回應是 `{"digests": 旅程數, "sent": 寄出封數}`。查寄送狀況（SQL Editor）：

   ```sql
   select kind, status, attempts, last_error, created_at from public.email_outbox order by created_at desc limit 20;
   select status, return_message, start_time from cron.job_run_details order by start_time desc limit 10;
   select status_code, error_msg, created from net._http_response order by created desc limit 10;
   ```

   每日摘要只在旅程時區過了 08:00、而且上一封之後有別人的新提案時才寄。

**保留期間**：寄出、放棄或取消的信（含內容）只保留 **30 天**，每天 03:00 UTC 由 pg_cron 的 `prune-emails` 工作刪掉；已寄出的定案紀錄和舊的摘要紀錄也一樣（每個旅程最新的一筆摘要紀錄一定留著，所以刪除不會讓任何信重寄）。還沒寄出的信不會被刪。要改天數：寫一個新 migration 重新定義 `private.email_retention()`（`supabase/migrations/20261001140000_email_cleanup.sql`）。不需要額外設定，`vp run db:push` 就會排好。

## CI

- `.github/workflows/ci.yml`：PR 與 push 到 `main` 時跑 `vp check`、`vp run -r test`，並在 runner 上啟動本機 Supabase、套用 migrations、跑 `supabase test db`（pgTAP，測試放在 `supabase/tests/database/*.test.sql`）。本機沒有 Docker，資料庫測試只在 CI 跑。
- `.github/workflows/keepalive.yml`：每 3 天（也可手動觸發）呼叫一次 hosted 專案的 `public.keepalive()`，避免免費方案閒置被暫停。結果寫在該次 run 的 Summary。
- `.github/workflows/deploy.yml`：push 到 `main` 的 CI 通過後（也可手動觸發），把 `docs/`（Jekyll）和 `apps/web` 建成同一個 GitHub Pages 網站並部署。

需要的 repository secrets（Settings → Secrets and variables → Actions）：

| Secret                     | 用途                                                                       |
| -------------------------- | -------------------------------------------------------------------------- |
| `SUPABASE_PROJECT_REF`     | hosted 專案的 ref（與 `.env` 相同），keepalive 與部署用                    |
| `SUPABASE_PUBLISHABLE_KEY` | publishable key（Project Settings → API Keys），keepalive 與部署時編進前端 |

## 部署（GitHub Pages）

| 網址                                                    | 內容                            |
| ------------------------------------------------------- | ------------------------------- |
| `https://klay376014.github.io/what-to-eat/`             | 首頁（`docs/index.md`）         |
| `https://klay376014.github.io/what-to-eat/privacy.html` | 隱私權政策（`docs/privacy.md`） |
| `https://klay376014.github.io/what-to-eat/app/`         | app（`apps/web`）               |

首頁與隱私權政策是 Google OAuth 同意畫面登記的網址，不能搬。`deploy.yml` 先用 `vp build --base=<Pages 的 base path>/app/`（base path 由 `actions/configure-pages` 取得，目前是 `/what-to-eat`）把 app 建到 `docs/app/`（已 gitignore），再讓 Jekyll 建整個 `docs/`，一起上傳。只部署 `main` 最新且 CI 通過的 commit：CI 跑完順序顛倒時，舊 commit 會跳過、由新 commit 的那次部署；手動觸發也做同樣檢查。app 沒有前端路由，狀態都在 query 參數裡，所以子路徑不需要 404 fallback；本機 `vp run dev` 仍然在 `/`。

第一次部署前要手動做一次：

1. Settings → Pages → Build and deployment → Source 改成 **GitHub Actions**（原本是 Deploy from a branch `main:/docs`）。
2. Supabase dashboard → Authentication → URL Configuration → Redirect URLs 加上 `https://klay376014.github.io/what-to-eat/app/**`（結尾 `/**` 不能省，原因見上面「登入」第 3 點）。要讓正式網址當預設的話，Site URL 也改成 `https://klay376014.github.io/what-to-eat/app/`。
3. 部署後實測：Google 登入後回到 app、建立旅程、用無痕視窗開邀請連結會看到邀請畫面。
