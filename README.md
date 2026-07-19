# Nourish — Meal & Fitness Tracker

A standalone Vite + React + Tailwind version of the meal/exercise tracker.

## 1. Install

```bash
npm install
```

## 2. Run the app (UI only, no AI features)

```bash
npm run dev
```

Opens on http://localhost:5173. All logging, charts, goals, and weight
tracking work immediately — data is saved to your browser's `localStorage`.

## 3. Enable AI meal/exercise analysis (optional)

The "Analyze meal" (photo/text), "Get AI portion guidance", and "Get AI
feedback" (exercise) buttons call Claude. The Anthropic API can't be called
directly from a browser — it doesn't support CORS, and putting your API key
in frontend code would expose it to anyone who opens dev tools. So this
project ships a tiny same-origin proxy in `/server` that holds the key
instead.

```bash
cp .env.example .env
# edit .env and set ANTHROPIC_API_KEY=sk-ant-...

npm run server   # starts the proxy on http://localhost:3001
npm run dev      # in a second terminal — Vite proxies /api to the server above
```

`vite.config.js` already forwards `/api/*` requests to `localhost:3001` in
dev. If you deploy this, deploy `/server` (or equivalent) alongside the
built frontend and point `VITE_CLAUDE_API_URL` at it, or keep them on the
same domain so the default `/api/messages` path still resolves.

## Project structure

```
├── index.html
├── vite.config.js          # dev-server proxy → local Express proxy
├── tailwind.config.js
├── postcss.config.js
├── .env.example             # ANTHROPIC_API_KEY for the proxy server
├── server/
│   └── index.js             # minimal Express proxy to api.anthropic.com
└── src/
    ├── main.jsx              # React entry point
    ├── index.css             # Tailwind + Google Fonts + custom font classes
    └── App.jsx                # the full app (all components in one file)
```

## Notes

- Data persistence uses `localStorage` (the `window.storage` API used in
  Claude.ai Artifacts isn't available outside that environment).
- The photo-upload button uses a `<label htmlFor>` wired to a hidden file
  input rather than a JS-triggered `.click()` — more reliable across
  browsers/webviews for opening the camera or photo picker.
