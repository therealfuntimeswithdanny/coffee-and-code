import { Hono } from 'hono';
import { Env } from '../types';
import { renderLayout } from '../templates/layout';

const pages = new Hono<{ Bindings: Env }>();

pages.get('/about', (c) => {
  const body = `
    <article class="max-w-2xl mx-auto py-8">
      <h1 class="text-3xl font-bold text-white mb-4">About ${c.env.PUB_NAME}</h1>
      <p class="text-gray-300 leading-relaxed mb-4">
        ${c.env.PUB_NAME} is an independent, decentralized technology publication built on top of Cloudflare Workers and the standard.site protocol.
      </p>
      <p class="text-gray-400 leading-relaxed">
        All articles are sourced directly from an ATProtocol Personal Data Server (PDS), ensuring full data ownership and portability across the open web.
      </p>
    </article>
  `;
  return c.html(renderLayout(c, 'About', body));
});

export default pages;
