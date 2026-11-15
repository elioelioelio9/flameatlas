# Fire Lab AI relay (Cloudflare Worker)

The public website is static, so it cannot hold the Claude API key. This Worker holds it as a secret and
answers only one kind of request: "here is a question and the NASA passages the site retrieved — answer from them".
The system prompt, size limits, allowed origins and a per-visitor rate limit live here, so it is not a general proxy.

Deploy (free plan is enough):
1. dash.cloudflare.com → Workers & Pages → Create → Worker → name it `fire-lab-ai` → Deploy.
2. Edit code → replace everything with `worker.js` → Deploy.
3. Settings → Variables and secrets → Add → type **Secret**, name `ANTHROPIC_API_KEY`, value = your key → Deploy.
4. Worker URL (already set in `frontend/public/ai.json`): https://fire-lab-ai.elioaparicio9.workers.dev/ — and run `publish_site.command`.

Also set a monthly spend limit in the Anthropic console: the site is public.
