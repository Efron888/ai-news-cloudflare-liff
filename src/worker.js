import { onRequestPost } from '../functions/api/webhook.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. 專供 iPhone / iOS 與全平台強制下載獨立 HTML 簡報檔 (回傳 attachment 標頭，與 PPTX/PDF 機制一致)
    if (url.pathname === '/api/download-html' || url.pathname === '/downloads/AI_News_Interactive_Slides.html') {
      if (env.ASSETS) {
        const assetUrl = new URL('/presentation.html', request.url);
        const assetRes = await env.ASSETS.fetch(new Request(assetUrl.toString()));
        const htmlBytes = await assetRes.arrayBuffer();
        return new Response(htmlBytes, {
          status: 200,
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': "attachment; filename=\"AI_News_Interactive_Slides.html\"; filename*=UTF-8''AI_%E7%94%A2%E6%A5%AD%E6%83%85%E5%A0%B1%E5%B0%88%E5%88%8A_%E4%BA%92%E5%8B%95%E5%BC%8F%E7%B0%A1%E5%A0%B1.html",
            'Cache-Control': 'no-cache'
          }
        });
      }
    }

    // 2. LINE Messaging API Webhook 與 Cloudflare 免費 AI 問答 API
    if (url.pathname === '/api/webhook' || url.pathname === '/webhook') {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
      }
      if (request.method === 'POST') {
        const context = {
          request,
          env,
          waitUntil: ctx && ctx.waitUntil ? ctx.waitUntil.bind(ctx) : () => {}
        };
        return onRequestPost(context);
      }
      if (request.method === 'GET') {
        return new Response(
          JSON.stringify({ status: 'ok', service: 'AI News Cloudflare Workers AI + LINE Webhook' }),
          { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
        );
      }
    }

    // 3. 靜態資源服務
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response('AI News Cloudflare LIFF Worker Running', { status: 200 });
  }
};
