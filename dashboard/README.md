# steerable-agents dashboard

Spec: `../dashboard.md`. Handoff/state: `../app.md`.

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22
npm install
DATABASE_URL=... DASHBOARD_TOKEN=... npm run dev
```

Env: `DATABASE_URL` (Neon), `DASHBOARD_TOKEN` (shared secret for hooks and browser login).
Tables are created on first request. Deploy on Vercel with root directory `dashboard`.
