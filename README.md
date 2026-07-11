# CVF PT

Internal personal training management app for Core Value Fitness (Albuquerque) — session scheduling, client management, packages, and waivers.

## Frontend (React 19 + Vite)

```sh
cd frontend
npm install
npm run dev     # dev server on :3000
npm run build   # production build to dist/
```

## Backend (Node/Express + Supabase)

```sh
cd backend
npm install
npm start
```

See [DEPLOYMENT.md](DEPLOYMENT.md) for deployment details.

## Verification

Backend unit/regression checks, the frontend production build, and preview-mode
browser checks are secret-free:

```sh
cd backend && npm test
cd frontend && npm run build
cd frontend && npm run test:e2e:preview
```

The mutating API integration harness is opt-in and accepts only an explicitly
allowlisted development or preview target. Copy `backend/integration/.env.example`
to a local ignored environment file, export its values, then run
`cd backend && npm run test:integration`. It uses dedicated fake-data accounts,
forbids hard-delete requests, and soft-archives the records it creates.
