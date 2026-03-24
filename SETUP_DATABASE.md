# Database Setup (24/7 Free Hosting)

This app now supports direct browser sync to Supabase (no local backend required for production hosting).

## 1) Configure Supabase table and policies

In Supabase SQL editor, run the SQL in:

- `supabase_setup.sql`

## 2) Configure frontend keys

Edit:

- `config.js`

Set:

```js
window.SUPABASE_CONFIG = {
  url: "https://mdkgcbhmqhknbltjlrzc.supabase.co",
  anonKey: "YOUR_SUPABASE_ANON_KEY"
};
```

## 3) Deploy static site (Cloudflare Pages / Netlify / Vercel)

Upload all files in project root.

No Node server is required for deployed mode.

## 4) Local fallback mode

If Supabase is unavailable:

- app still saves in `localStorage`
- sync resumes when remote is reachable

This setup gives persistent progress and lets the app stay accessible 24/7 from any network.
