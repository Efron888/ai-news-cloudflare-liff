import { onRequestPost, onRequestGet, onRequestOptions } from '../functions/api/webhook.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/webhook' || url.pathname === '/webhook') {
      const context = { request, env, waitUntil: ctx.waitUntil.bind(ctx) };
      if (request.method === 'OPTIONS') return onRequestOptions();
      if (request.method === 'POST') return onRequestPost(context);
      if (request.method === 'GET') return onRequestGet();
    }
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response('AI News Cloudflare LIFF Worker Running', { status: 200 });
  }
};
