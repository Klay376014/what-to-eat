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

首頁與隱私權政策是 Google OAuth 同意畫面登記的網址，不能搬。`deploy.yml` 先用 `vp build --base=/what-to-eat/app/` 把 app 建到 `docs/app/`（已 gitignore），再讓 Jekyll 建整個 `docs/`，一起上傳。app 沒有前端路由，狀態都在 query 參數裡，所以子路徑不需要 404 fallback；本機 `vp run dev` 仍然在 `/`。

第一次部署前要手動做一次：

1. Settings → Pages → Build and deployment → Source 改成 **GitHub Actions**（原本是 Deploy from a branch `main:/docs`）。
2. Supabase dashboard → Authentication → URL Configuration → Redirect URLs 加上 `https://klay376014.github.io/what-to-eat/app/**`（結尾 `/**` 不能省，原因見上面「登入」第 3 點）。要讓正式網址當預設的話，Site URL 也改成 `https://klay376014.github.io/what-to-eat/app/`。
3. 部署後實測：Google 登入後回到 app、建立旅程、用無痕視窗開邀請連結會看到邀請畫面。
