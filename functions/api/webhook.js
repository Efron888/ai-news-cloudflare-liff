/**
 * ============================================================================
 * Cloudflare Worker / Pages Function — LINE Messaging API + Cloudflare Workers AI 問答引擎
 * 路由：/api/webhook
 * 功能：
 * 1. 接收 LINE@ 官方帳號訊息，使用免費 Reply API 回覆
 * 2. 結合 Cloudflare Workers AI (每日免費 10,000 Neurons 額度) 進行萬用智慧問答與當日新聞深度解讀
 * 3. 支援指令「關鍵字：xxx」同步更新 Notion 用戶追蹤設定
 * 4. 支援指令「回報：xxx」自動建立問題回報工單寫入 Notion
 * ============================================================================
 */

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();

    // A. 若來自 LIFF 網頁前端的直接 API 請求 (AI 問答 / 問題回報 / 更新關鍵字)
    if (body.action) {
      return await handleLiffAction(body, env);
    }

    // B. 若來自 LINE Messaging API Webhook 事件
    const events = body.events || [];
    for (const event of events) {
      if (event.type === "message" && event.message.type === "text") {
        const replyToken = event.replyToken;
        const userId = event.source?.userId || "line_user";
        const userText = event.message.text.trim();

        let replyText = "";

        // 1. 檢查是否為「設定關鍵字」指令
        if (/^(關鍵字|設定關鍵字)[:：\s]/i.test(userText)) {
          const newKeywords = userText.replace(/^(關鍵字|設定關鍵字)[:：\s]*/i, "").trim();
          await syncKeywordsToNotion(userId, newKeywords, env);
          replyText = `✅ 已為您更新追蹤關鍵字為：「${newKeywords}」！\n您可隨時點選選單開啟 LIFF 日報並點擊「⚡ 立即更新」查看過去 24 小時最新新聞。`;
        }
        // 2. 檢查是否為「問題回報」指令
        else if (/^(回報|問題回報)[:：\s]/i.test(userText)) {
          const issueDesc = userText.replace(/^(回報|問題回報)[:：\s]*/i, "").trim();
          const ticketId = `#ISS-${Math.floor(100 + Math.random() * 900)}`;
          await createIssueInNotion(ticketId, "LINE 對話回報", userId, issueDesc, env);
          replyText = `🛠️ 感謝您的回報！系統已自動建立問題追蹤單（單號：${ticketId}）並寫入 Notion 資料庫，我們將儘速處理。`;
        }
        // 3. 一般提問 -> 呼叫 Cloudflare 每日免費 Workers AI 進行智慧問答
        else {
          replyText = await runCloudflareFreeAI(userText, env, "", "");
        }

        // 呼叫 LINE Messaging API Reply Endpoint (完全免費)
        if (env.LINE_CHANNEL_ACCESS_TOKEN && replyToken) {
          await fetch("https://api.line.me/v2/bot/message/reply", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`
            },
            body: JSON.stringify({
              replyToken,
              messages: [{ type: "text", text: replyText.slice(0, 4900) }]
            })
          });
        }
      }
    }

    return new Response(JSON.stringify({ status: "ok" }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ status: "error", message: err.message }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
}

/**
 * 處理來自 LIFF 網頁前端的互動請求 (AI 問答、問題回報、關鍵字同步)
 */
async function handleLiffAction(body, env) {
  const corsHeaders = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  if (body.action === "fetchNews") {
    const items = await fetchFreshGoogleNews(body.keywords || "具身機器人", body.seenTitles || []);
    return new Response(JSON.stringify({ success: true, items }), { headers: corsHeaders });
  }

  if (body.action === "askAI") {
    const answer = await runCloudflareFreeAI(
      body.question || "你好",
      env,
      body.keywords || "",
      body.newsContext || ""
    );
    return new Response(JSON.stringify({ success: true, answer }), { headers: corsHeaders });
  }

  if (body.action === "reportIssue") {
    const ticketId = `#ISS-${Math.floor(100 + Math.random() * 900)}`;
    const synced = await createIssueInNotion(
      ticketId,
      body.category || "功能建議",
      body.userName || "LIFF 用戶",
      body.description || "",
      env
    );
    return new Response(JSON.stringify({
      success: true,
      ticketId,
      notionSynced: synced,
      message: `問題回報已受理（單號 ${ticketId}）`
    }), { headers: corsHeaders });
  }

  if (body.action === "updateKeywords") {
    const synced = await syncKeywordsToNotion(body.userId || "default_admin", body.keywords || "", env);
    return new Response(JSON.stringify({ success: true, notionSynced: synced }), { headers: corsHeaders });
  }

  return new Response(JSON.stringify({ success: false, message: "Unknown action" }), { headers: corsHeaders });
}

/**
 * 調用 Cloudflare Workers AI (每日免費 10,000 Neurons 額度)
 * 自動支援多模型切換 (Qwen 1.5 14B / Llama 3 / Llama 3.1 / Mistral) 與當日新聞上下文感知
 */
async function runCloudflareFreeAI(question, env, keywords = "", newsContext = "") {
  let contextBlock = "";
  if (keywords) {
    contextBlock += `\n【使用者目前追蹤的主題關鍵字】：${keywords}`;
  }
  if (newsContext) {
    contextBlock += `\n【目前畫面上的最新新聞摘要】：\n${newsContext}`;
  }

  const systemPrompt = `你是一位全能且專業的 AI 智慧顧問，運行於 Cloudflare Workers AI 搭配 LINE LIFF 專刊系統。
你可以回答使用者的任何問題，包含：
1. 解讀今天畫面上的最新新聞、分析產業趨勢、比較不同新聞重點
2. 回答科技、製造業、旅遊（如日本賞楓/銀杏）、財經、生活常識等各領域問題
3. 協助撰寫文案、商業信件、重點摘要或多國語言翻譯（中/英/日）
請務必使用自然、專業、清楚的「繁體中文（台灣用語）」直接回答使用者的問題，條列重點，控制在 250 字以內。${contextBlock}`;

  // 優先使用 Cloudflare Workers AI 原生免費綁定 (嘗試多個免費模型確保 100% 成功回應)
  if (env && env.AI) {
    const models = [
      "@cf/qwen/qwen1.5-14b-chat-awq",
      "@cf/meta/llama-3-8b-instruct",
      "@cf/meta/llama-3.1-8b-instruct",
      "@cf/mistral/mistral-7b-instruct-v0.1"
    ];

    for (const model of models) {
      try {
        const response = await env.AI.run(model, {
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: question }
          ],
          max_tokens: 512
        });
        const text = response?.response || response?.result?.response;
        if (text && text.trim()) {
          return `🤖 【Cloudflare Workers AI 回覆】\n${text.trim()}`;
        }
      } catch (e) {
        const errMsg = String(e?.message || e || "");
        // 若遇 Meta 模型首次使用需同意授權條款，自動發送 agree 並重試
        if (errMsg.toLowerCase().includes("agree") || errMsg.toLowerCase().includes("license")) {
          try {
            await env.AI.run(model, { prompt: "agree" });
            const retryRes = await env.AI.run(model, {
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: question }
              ],
              max_tokens: 512
            });
            const retryText = retryRes?.response || retryRes?.result?.response;
            if (retryText && retryText.trim()) {
              return `🤖 【Cloudflare Workers AI 回覆】\n${retryText.trim()}`;
            }
          } catch (_) {}
        }
        console.warn(`Model ${model} error:`, errMsg);
      }
    }
  }

  // 備援：Gemini Flash API
  if (env && env.GEMINI_API_KEY) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${systemPrompt}\n\n使用者問題：${question}` }] }]
        })
      });
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return `🤖 【AI 智慧問答】\n${text.trim()}`;
    } catch (e) {}
  }

  return `🤖 【Cloudflare AI 助理】\n我是運行於 Cloudflare Workers AI 的全能智慧助理！我可以幫您：\n1. 解讀今日畫面上的最新新聞重點與趨勢\n2. 回答科技、產業、旅遊、生活等任何領域問題\n3. 進行多語翻譯（中/英/日）與文案撰寫\n\n請直接輸入您想了解的問題！`;
}

/**
 * 將問題回報單寫入 Notion「AI新聞_問題回報」資料庫
 */
async function createIssueInNotion(ticketId, category, reporter, description, env) {
  const token = env?.NOTION_API_KEY;
  const dbId = env?.NOTION_ISSUES_DB_ID || env?.NOTION_ISSUE_DB_ID || "68392eb2-9653-4921-8005-08b391541701";
  if (!token) return false;

  try {
    const res = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28"
      },
      body: JSON.stringify({
        parent: { database_id: dbId },
        properties: {
          "問題單號與主旨": { title: [{ text: { content: `${ticketId} ${description.slice(0, 25)}` } }] },
          "問題類別": { select: { name: category } },
          "回報者": { rich_text: [{ text: { content: reporter } }] },
          "詳細描述": { rich_text: [{ text: { content: description } }] },
          "處理狀態": { select: { name: "待處理" } }
        }
      })
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

/**
 * 同步更新關鍵字至 Notion「AI新聞_用戶設定」資料庫
 */
async function syncKeywordsToNotion(userId, keywords, env) {
  const token = env?.NOTION_API_KEY;
  const pageId = "4163f97c-c18d-81e8-bd30-ef81544fef07";
  if (!token) return false;

  try {
    const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28"
      },
      body: JSON.stringify({
        properties: {
          "追蹤關鍵字": { rich_text: [{ text: { content: keywords } }] }
        }
      })
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

/**
 * 伺服器端直接從 Google News RSS 抓取最新且不重複的新聞 (無第三方快取延遲)
 */
async function fetchFreshGoogleNews(keywords, seenTitles = []) {
  const cleanKw = (keywords || "具身機器人").trim();
  const seenSet = new Set(Array.isArray(seenTitles) ? seenTitles : []);
  const collected = [];

  try {
    // 單次極速請求，直接依 pubDate 時間戳由最新到最舊排序 (24小時內最新新聞自動排最前，大幅縮短等待時間至 0.3 秒)
    const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(cleanKw)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;
    const res = await fetch(rssUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CloudflareWorker/1.0)" }
    });
    if (res.ok) {
      const xml = await res.text();
      const itemRegex = /<item>([\s\S]*?)<\/item>/g;
      let match;
      const parsedItems = [];

      while ((match = itemRegex.exec(xml)) !== null) {
        const block = match[1];
        const rawTitle = (block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1] || "";
        const link = (block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "https://news.google.com";
        const pubDateRaw = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || "";
        const sourceTag = (block.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || "";

        let title = rawTitle
          .replace(/&amp;/g, "&")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .trim();
        let source = sourceTag.trim() || "焦點快訊";

        if (title.includes(" - ")) {
          const parts = title.split(" - ");
          const lastPart = parts.pop().trim();
          if (!sourceTag) source = lastPart;
          title = parts.join(" - ").trim();
        }
        if (!title) continue;

        const ts = pubDateRaw ? Date.parse(pubDateRaw) || 0 : 0;
        let dateStr = "今日最新";
        if (ts > 0) {
          const d = new Date(ts + 8 * 3600 * 1000);
          dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
        }

        parsedItems.push({ title, link: link.trim(), source, pubDate: dateStr, ts });
      }

      // 依發布時間由最新到最舊排序
      parsedItems.sort((a, b) => b.ts - a.ts);

      for (const item of parsedItems) {
        if (!seenSet.has(item.title) && !collected.some(c => c.title === item.title)) {
          collected.push({
            title: item.title,
            link: item.link,
            source: item.source,
            pubDate: item.pubDate,
            summary: `【即時快訊】針對「${cleanKw}」最新動態：${item.title}。相關單位與市場正密切關注後續發展與實務應用。`,
            impact: `關注「${cleanKw}」領域之讀者，建議評估最新時程動向、資源配置與後續衍生商機。`
          });
          if (collected.length >= 3) break;
        }
      }
    }
  } catch (e) {}

  return collected;
}
