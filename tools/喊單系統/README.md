# 喊單系統（團購 +1）

FB 社團團購的喊單、到貨、出貨查詢系統。網址：

- 客人頁：https://chengshuang1025.github.io/cheng-shuang-tools/order/
- 後台：https://chengshuang1025.github.io/cheng-shuang-tools/order/admin.html
- 隱私權政策：…/order/privacy.html
- 刪除資料說明：…/order/delete-data.html

## 架構
- 網頁：純 HTML + JS，跟團購網站一起由 GitHub Actions 發布到 GitHub Pages 的 `/order/`
- 資料庫與登入：Supabase 專案 `group-buy`（東京機房，免費方案）
- 登入方式：客人頁只有手機號碼＋密碼；後台頁（admin.html）有自己的登入畫面：團主用 Facebook、夥伴用手機。Facebook 登入（Meta App「好事丞雙團購」，ID 1618683120034433，未發佈：Meta 要求先完成商家驗證＋App 審查）
- 每天的 GitHub Actions 排程會讀一次 `heartbeat` 表，避免 Supabase 免費方案閒置 7 天被暫停

## 三種身分
- 管理者（好事丞雙）：全部功能
- 夥伴：只看「商品」「訂貨」，可改已訂數量與備註，看不到客人資料
- 客人：只看自己的喊單，可以對「收單中」的商品 +1

## 客人帳號怎麼對到喊單
- FB 登入：FB 名字跟匯入時的名字一樣，就會問客人「這些喊單是你的嗎？」，確認後綁定
- 手機登入：客人註冊時填社團 FB 名字，後台「帳號」分頁會出現在「等你確認綁定的客人」，團主按「確認綁定」；也可以在客人總覽的「手機」欄先填好手機，客人登入時自己確認
- 客人忘記密碼：後台「帳號」分頁按「重設密碼」

## 資料庫
`sql/` 底下是建資料表與權限的 SQL，依編號順序執行過（在 Supabase SQL Editor）。
