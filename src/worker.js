import { onRequestPost } from '../functions/api/webhook.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
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
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response('AI News Cloudflare LIFF Worker Running', { status: 200 });
  }
};
