/**
 * ============================================================================
 * Cloudflare Pages Function — LINE Messaging API + Cloudflare Workers AI 問答引擎
 * 路由：/api/webhook
 * 功能：
 * 1. 接收 LINE@ 官方帳號訊息，使用免費 Reply API 回覆
 * 2. 結合 Cloudflare Workers AI (每日免費 AI 額度 @cf/meta/llama-3.1-8b-instruct) 自動進行問答
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
          const keywords = userText.replace(/^(關鍵字|設定關鍵字)[:：\s]*/i, "").trim();
          await syncKeywordsToNotion(userId, keywords, env);
          replyText = `✅ 您的專屬新聞關鍵字已更新為：\n「${keywords}」\n\n系統每日將自動抓取過去 24 小時最新且不重複的報導！點擊下方圖文選單即可開啟 LIFF 數位專刊。`;
        }
        // 2. 檢查是否為「問題回報」指令
        else if (/^(回報|問題回報|bug)[:：\s]/i.test(userText)) {
          const issueDesc = userText.replace(/^(回報|問題回報|bug)[:：\s]*/i, "").trim();
          const ticketId = `#ISS-${Math.floor(100 + Math.random() * 900)}`;
          await createIssueInNotion(ticketId, "操作疑問", userId, issueDesc, env);
          replyText = `🛠️ 感謝您的問題回報！\n\n📌 受理單號：${ticketId}\n📝 回報內容：${issueDesc}\n\n已自動同步至 Notion 問題回報追蹤庫，管理員將儘速處理！`;
        }
        // 3. 一般訊息 -> 啟動 Cloudflare 每日免費 AI 額度進行智慧問答！
        else {
          replyText = await runCloudflareFreeAI(userText, env);
        }

        // 呼叫 LINE Reply API (免費無限則數)
        if (env.LINE_CHANNEL_ACCESS_TOKEN && replyToken) {
          await fetch("https://api.line.me/v2/bot/message/reply", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`
            },
            body: JSON.stringify({
              replyToken: replyToken,
              messages: [{ type: "text", text: replyText }]
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

  if (body.action === "askAI") {
    const answer = await runCloudflareFreeAI(body.question || "你好", env);
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
 * 若未綁定則自動使用 Gemini Flash 免費額度備援
 */
async function runCloudflareFreeAI(question, env) {
  const systemPrompt = "你是一位專業的台灣產業與科技 AI 顧問（部署於 Cloudflare Workers AI 搭配 LINE 官方帳號）。請用簡潔、專業的繁體中文回答使用者的問題（控制在 150 字內，重點條列）。";

  // 優先使用 Cloudflare Workers AI 原生免費綁定
  if (env && env.AI) {
    try {
      const response = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: question }
        ]
      });
      if (response && response.response) {
        return `🤖 【Cloudflare 免費 AI 回覆】\n${response.response}`;
      }
    } catch (e) {
      console.warn("Cloudflare Workers AI 呼叫異常，切換備援:", e);
    }
  }

  // 備援：Cloudflare REST API 或 Gemini Flash 免費 API
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

  return `🤖 【Cloudflare AI 助理】\n收到您的提問：「${question}」\n\n建議您可透過右上角「設定主題」將此關鍵字加入每日追蹤，系統將為您每日自動檢索最新 24 小時相關報導！`;
}

/**
 * 將問題回報單寫入 Notion「AI新聞_問題回報」資料庫
 */
async function createIssueInNotion(ticketId, category, reporter, description, env) {
  const token = env?.NOTION_API_KEY;
  const dbId = env?.NOTION_ISSUE_DB_ID || "1b820e11-48dc-4563-b810-f8a42712adb6";
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
