import { HTMLRewriter } from 'cloudflare-html-rewriter';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import fetch from 'node-fetch';
import * as fs from 'fs/promises';
import * as dotenv from 'dotenv';

dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const EventPinSchema = z.object({
  title: z.string(),
  venue: z.string().optional(),
  time_label: z.string().optional(),
  photo_url: z.string().optional(),
  location: z.string().optional(),
  category: z.string().optional(),
  spontaneity_score: z.number().optional(),
  crowd_label: z.string().optional(),
  tags: z.array(z.string()).optional(),
  description: z.string().optional(),
  source_url: z.string(),
  created_at: z.string().optional(),
});

const GeminiResponseSchema = z.object({
  events: z.array(EventPinSchema),
  links: z.array(z.string()).optional(),
});

async function sanitizeHTML(html: string): Promise<string> {
  let cleaned = '';
  const rewriter = new HTMLRewriter()
    .on('script', { element: el => el.remove() })
    .on('style', { element: el => el.remove() })
    .on('nav', { element: el => el.remove() })
    .on('footer', { element: el => el.remove() })
    .on('aside', { element: el => el.remove() })
    .on('head', { element: el => el.remove() })
    .on('main', { element: el => el.setInnerContent(el.innerHTML()) }); // Optionally keep only main

  cleaned = await rewriter.transform(html);
  return cleaned;
}

async function callGemini(html: string): Promise<any> {
  const prompt = `
    Extract events and venues from the following HTML. Output JSON matching:
    { events: [EventPin], links: [string] }
    EventPin fields: title, venue, time_label, photo_url, location, category, spontaneity_score, crowd_label, tags, description, source_url, created_at.
    Only output valid JSON.
    HTML: ${html}
  `;
  const res = await fetch('https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent?key=' + GEMINI_API_KEY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
  });
  const data = await res.json();
  // Extract JSON from Gemini response (depends on API format)
  return JSON.parse(data.candidates[0].content.parts[0].text);
}

async function main() {
  const urls = JSON.parse(await fs.readFile('./urls.json', 'utf-8'));
  await Promise.all(urls.map(async (url: string) => {
    try {
      const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const html = await resp.text();
      const cleanedHTML = await sanitizeHTML(html);
      let geminiData;
      let tries = 0;
      while (tries < 2) {
        try {
          geminiData = await callGemini(cleanedHTML);
          GeminiResponseSchema.parse(geminiData);
          break;
        } catch (e) {
          tries++;
        }
      }
      if (!geminiData) return;
      for (const event of geminiData.events) {
        await supabase.from('events').insert([{ ...event, source_url: url }]);
      }
      // Optionally: push links to crawl_queue
    } catch (err) {
      console.error('Error processing', url, err);
    }
  }));
}

main();

