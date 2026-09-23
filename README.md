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
