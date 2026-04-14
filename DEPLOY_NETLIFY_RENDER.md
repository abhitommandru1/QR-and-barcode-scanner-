# Deploy Guide (Netlify + Render)

## 1) Deploy Python API to Render

1. Push this project to GitHub.
2. In Render: New + -> Blueprint -> select your repo.
3. Render will read `render.yaml` and create:
  - Web service: `qr-scanner-api`
  - Postgres database: `qr-scanner-db`
4. After deploy, copy web service URL (example: `https://qr-scanner-api.onrender.com`).

## 2) Set API URL in frontend config

1. Open `frontend/js/config.js`.
2. Set:

```js
window.SCANPRO_CONFIG = {
  API_BASE_URL: "https://your-render-service.onrender.com"
};
```

## 3) Deploy frontend to Netlify

1. In Netlify: Add new site -> Import from Git.
2. Choose this same repository.
3. Build settings:
   - Build command: (leave empty)
   - Publish directory: `frontend`
4. Deploy.

## 4) Verify from mobile

1. Open your Netlify URL on phone.
2. Login/Register should call your Render backend.
3. Camera should work because Netlify is HTTPS.

## Notes

- Login data now uses a database table (`users`) instead of `users.txt`.
- Local development without `DATABASE_URL` uses `backend/data/users.db` (SQLite).
- Production on Render uses managed Postgres through `DATABASE_URL` from `render.yaml`.
- Render uses `backend/server.py` as the start command.
