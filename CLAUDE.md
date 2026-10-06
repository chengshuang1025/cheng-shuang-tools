# cheng-shuang-tools — 我的工具總專案

## 對話開始時請先讀
進度與最近更動都在 Obsidian：`cheng-shuang-tools/工作筆記.md`（Obsidian MCP 的路徑，不含 vault 名稱）

## 工作模式
- **加新工具**：對 Claude 說「我想做一個 XXX 工具」→ Claude 會建 `tools/<工具名>/` 子資料夾
- **結束工作**：對 Claude 說「**收工**」→ 自動 commit + push + 更新 Obsidian 工作筆記
- **每個工具都要收工紀錄**：不論做的是哪個工具，每次工作告一段落，Claude 都要主動收工（commit、push、更新 Obsidian 工作筆記的「上次做到哪」「工具清單」「最近更動紀錄」「踩坑筆記」），不用等她開口
- Obsidian 的 patch 功能目前會出錯，更新工作筆記請先讀整份再用整份覆寫
- **接續工作**：對 Claude 說「**開工**」或「讀工作筆記、告訴我上次做到哪」

## 工作桌 + 三個家
- 📋 GDrive 工作桌：`G:\我的雲端硬碟\cheng-shuang-tools\`（自動跨電腦同步）
- 🐙 GitHub repo：chengshuang1025/cheng-shuang-tools（公開，網頁的家）
- 📘 Obsidian 駕駛艙：`secondbrain/cheng-shuang-tools/工作筆記.md`（想法的家）
- 🐘 Supabase 專案：ig-reels-kb（資料的家，用 Supabase MCP 直接查/寫）；喊單系統另用 group-buy 專案（MCP 沒有權限，要透過瀏覽器的 SQL Editor）

## 工具清單
（之後加新工具時會自動更新）
- `tools/團購連結頁`：正式團購網站（自我介紹＋團購清單），網址 https://chengshuang1025.github.io/cheng-shuang-tools/ 。**團購資料在總後台「🧺 團購」分頁管理（Supabase group-buy 的 `campaigns` 表），網站直接讀資料庫**；data.js 只是讀不到時的備份。改 `profile.js` 改自我介紹；截止日到會自動移到「已結束」。只放團購，跟品牌教材 Link-in-bio（cheng-shuang repo）分開
- `tools/喊單系統`（後台已升級成「好事丞雙總後台」：🧺 團購、💬 IG＋FB 留言自動回覆、+1 喊單）：伺服器程式在 `functions/`（Supabase Edge Functions，改完要到 Supabase 網頁版重新部署）；FB 社團團購的 +1 喊單／到貨／出貨查詢系統，網址 https://chengshuang1025.github.io/cheng-shuang-tools/order/ （後台 admin.html）。資料在 Supabase 專案 group-buy（不是 ig-reels-kb），FB 登入用 Meta App「好事丞雙團購」。跟團購網站同一個 Actions 發布，每日排程順便喚醒資料庫。細節見該資料夾 README
- `tools/腳本產生器`：輸入主題一次拿到 3 支不同開頭/結構的腳本骨架，規則依據 `RULES.md`（IG Reels 知識庫數據）。有 Windows 排程「cheng-shuang-tools-腳本產生器-每日推薦」每天 7:00 自動讀取進行中團購、產生 2 支腳本寫進當天 Obsidian 每日筆記

## 工作注意事項
- commit 訊息要寫清楚做了什麼 + 為什麼
- 收工時同步三方（GitHub、Obsidian；GDrive 工作桌在舊 Windows 電腦上，換到 Mac 後先標「—」）
- 敏感資料（API key、密碼）一律放 `.env`，不寫進程式碼或 commit
