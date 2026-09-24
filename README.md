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
3. Supabase dashboard → Authentication → Sign In / Providers → Google：填 client ID / secret 並啟用。URL Configuration 的 Site URL / Redirect URLs 加上前端網址（本機是 `http://localhost:5173`）。
4. `vp run auth:check-scopes`：確認 hosted 專案實際向 Google 要的 scope 沒有超出 `openid email profile`，結果補進 ADR 的驗證表。

## CI

- `.github/workflows/ci.yml`：PR 與 push 到 `main` 時跑 `vp check`、`vp run -r test`，並在 runner 上啟動本機 Supabase、套用 migrations、跑 `supabase test db`（pgTAP，測試放在 `supabase/tests/database/*.test.sql`）。本機沒有 Docker，資料庫測試只在 CI 跑。
- `.github/workflows/keepalive.yml`：每 3 天（也可手動觸發）呼叫一次 hosted 專案的 `public.keepalive()`，避免免費方案閒置被暫停。結果寫在該次 run 的 Summary。

需要的 repository secrets（Settings → Secrets and variables → Actions）：

| Secret                     | 用途                                                            |
| -------------------------- | --------------------------------------------------------------- |
| `SUPABASE_PROJECT_REF`     | hosted 專案的 ref（與 `.env` 相同）                             |
| `SUPABASE_PUBLISHABLE_KEY` | publishable key（Project Settings → API Keys），給 keepalive 用 |
