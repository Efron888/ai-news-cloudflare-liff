# 📰 AI 產業情報專刊 — Cloudflare + LINE LIFF + Messaging API 全棧作品

本專案為整合 **LINE@ 官方帳號 + LINE LIFF + Cloudflare Pages / Workers AI + Canva + Notion MCP** 的全自動 AI 新聞專刊與互動問答系統。

---

## 🎯 核心功能架構（對應專案需求）

1. **LINE@ 結合 LINE LIFF 的作品 (`index.html`)**
   - **自動身分識別**：支援 LINE LIFF 自動帶入用戶名稱與頭像；網頁直接開啟時預設為「訪客 (預覽模式)」。
   - **自訂主題與排程時間**：可自由增刪追蹤關鍵字（如：`北海道楓葉`、`具身機器人`）並設定每日推播時間（07:00 / 08:00 / 09:00 / 12:30 / 18:00）。
   - **⚡ 立即更新 & 24 小時最新去重**：強制限定 Google News 過去 24 小時內 (`when:1d`) 最新新聞，並自動比對歷史紀錄與 Notion 資料庫，確保每日新聞絕不重複。

2. **Canva + HTML 互動式簡報 (`presentation.html`)**
   - **支援滑鼠點擊切換、鍵盤方向鍵、底部圓點導覽與全螢幕播放**。
   - **內建「HTML 互動簡報模式」與「Canva 原生設計模式」一鍵切換**。
   - **支援一鍵下載 3 種格式**：
     - 📥 [下載 Canva 簡報 (.pptx)](./downloads/AI_News_LIFF_Canva_Slides.pptx)
     - 📄 [下載 PDF 簡報 (.pdf)](./downloads/AI_News_LIFF_Canva_Slides.pdf)
     - 🌐 下載單一完整互動 HTML (`presentation.html`)
   - **完整涵蓋兩大核心問題**：
     - **a. 這個產品怎麼用它？**（第 3 頁：三步驟操作指南）
     - **b. 如果有一些問題，我要怎麼回報？**（第 4 頁：三種問題回報管道與 Notion 自動建單追蹤）

3. **LINE Messaging API + Cloudflare 每日免費 AI 額度問答 (`functions/api/webhook.js` & `src/worker.js`)**
   - 綁定 Cloudflare Workers AI (`env.AI` 免費每日 10,000 Neurons 額度，採用 `@cf/meta/llama-3.1-8b-instruct` 並支援 Gemini API 雙重備援)。
   - **LINE 聊天室直接問答**：用戶在 LINE 官方帳號輸入任何問題，Webhook 即時呼叫 Cloudflare 免費 AI 生成繁體中文專業解答並透過 `replyToken` 回覆。
   - **LINE 聊天室指令連動**：
     - 輸入 `設定關鍵字：北海道楓葉, 具身機器人` → 自動同步設定。
     - 輸入 `回報問題：新聞圖片載入較慢` → 自動寫入 Notion【AI新聞_問題回報】資料表並回傳工單編號。
   - **LIFF 內建「🤖 問答」與「🛠️ 回報」視窗**：在網頁或 LIFF 內也可直接體驗 Cloudflare 免費 AI 即時問答與問題回報。

---

## 🔗 雲端資源與連結總覽

- **Canva 線上簡報設計稿**：[點此開啟 Canva 簡報](https://canva.link/j76h9iswyqp364j)
- **Notion 每日 AI 新聞專刊中心**：[點此開啟 Notion 總覽頁](https://app.notion.com/p/4163f97cc18d8173821bc27e5df9957a)
  - 🗄️ [AI新聞_用戶設定 資料庫](https://app.notion.com/p/44b5e6a12dbe47208b531b20ebd75a9e)
  - 📰 [AI新聞_今日產出 資料庫](https://app.notion.com/p/0fd40ae9c5d04dcfa84bde7037cd7e29)
  - 🛠️ [AI新聞_問題回報 資料庫](https://app.notion.com/p/68392eb296534921800508b391541701)

---

## ☁️ Cloudflare Pages / Workers 部署步驟

1. 登入 [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**。
2. 選擇本儲存庫 `Efron888/ai-news-cloudflare-liff`。
3. **Build settings**：
   - Framework preset: `None`
   - Build output directory: `public`
4. 點擊 **Save and Deploy**，即可獲得 `https://ai-news-cloudflare-liff.pages.dev` 專屬網域！
5. **啟用 Cloudflare 免費 AI 與環境變數**：
   - 在專案 **Settings** → **Functions** → **Workers AI bindings** 新增變數名稱 `AI`。
   - 在 **Settings** → **Environment variables** 設定：
     - `LINE_CHANNEL_ACCESS_TOKEN`（LINE Messaging API Token）
     - `GEMINI_API_KEY`（選填，AI 備援金鑰）
     - `NOTION_API_KEY`（Notion 整合權杖）
6. **綁定 LINE Developers**：
   - **LIFF Endpoint URL**：填入 `https://您的網域.pages.dev/`
   - **Messaging API Webhook URL**：填入 `https://您的網域.pages.dev/api/webhook`
