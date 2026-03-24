# Deploy to your official server

The app code is already updated **on your PC** in this folder. Cursor cannot log in to your hosting — you copy these files to the server (FTP, SFTP, Git push, or your host’s deploy panel).

## Cloudflare Workers (your site: [steep-bar-d690.blonki1234.workers.dev](https://steep-bar-d690.blonki1234.workers.dev/))

This repo includes `wrangler.toml` pointed at your worker name `steep-bar-d690` and static files in `deploy-static/` (synced from root before deploy).

1. Install dependencies (once): `npm install`
2. Log in to Cloudflare (once): `npx wrangler login`
3. Deploy: `npm run deploy:cf`

That runs `sync:static` (copies `app.js`, HTML, `styles.css`, `config.js` into `deploy-static/`) then `wrangler deploy`.

If Cloudflare says the worker name doesn’t match your account, either:

- Change `name` in `wrangler.toml` to match the worker you created in the dashboard, or  
- Create a new worker with name `steep-bar-d690` and deploy again.

See Cloudflare’s [Workers static assets](https://developers.cloudflare.com/workers/static-assets/) docs for details.

## What to upload

Upload **everything the site needs**, from the same folder you use locally (usually the **project root**, not only `deploy-static`):

| Must upload / update |
|----------------------|
| `app.js` |
| `index.html`, `workout.html`, `progress.html`, `nutrition.html`, `settings.html` |
| `styles.css` |
| `config.js` (keep your real Supabase keys on the server) |
| `server.js`, `package.json`, `package-lock.json` (if you run Node on the server) |

**Do not** upload `node_modules` — on the server run:

```bash
npm ci
# or
npm install
```

Then restart your process (PM2, systemd, Railway “Redeploy”, etc.).

## If you use static hosting only (Netlify / Vercel / Cloudflare Pages)

Upload the **root** HTML/CSS/JS files (same list as above, no `server.js` needed if you use Supabase only).

You can use the `deploy-static` folder **only** if that is what your host is configured to publish — but then it must contain the **latest** `app.js`, HTML, and `styles.css` (we keep `deploy-static` in sync with root for Live Server).

## After deploy: still seeing “Upper A / Upper B”?

1. Hard refresh: **Ctrl + F5**.
2. The app migrates old day names when it loads saved state. If your host uses **Postgres** (`/api/state`) or **Supabase**, the saved JSON may still be old until the next load triggers migration — opening the site once after the new `app.js` is live is enough.
3. Or use **Settings → Reset all data** once (only if you’re OK losing local progress).

## Quick check that the new code is live

Open `https://YOUR-DOMAIN/app.js` in the browser and search the page for:

- `name: "Push"`
- `migrateWorkoutDays`

If those strings are missing, the server is still serving an old `app.js` — re-upload it and clear CDN cache if you use one.

## Windows → server with SCP (optional)

Replace `user`, `host`, and path:

```powershell
scp app.js user@host:/path/to/gym/
scp workout.html progress.html user@host:/path/to/gym/
```

Repeat for any other changed files, then restart the app on the server.
