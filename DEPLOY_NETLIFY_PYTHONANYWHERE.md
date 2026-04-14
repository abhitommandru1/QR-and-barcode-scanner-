# Deploy Guide: Netlify Frontend + PythonAnywhere Backend

This setup avoids the Render billing gate by using:
- Netlify for the frontend
- PythonAnywhere free web app for the backend

## 1) Push this repo to GitHub

Make sure the repo is already pushed. You already completed that step.

## 2) Deploy the backend on PythonAnywhere

1. Sign up or log in to PythonAnywhere.
2. Open the **Web** tab.
3. Click **Add a new web app**.
4. Choose **Manual configuration**.
5. Choose **Python 3.11** or the newest available Python version.
6. Set the source code folder to your project folder on PythonAnywhere.
7. Edit the WSGI file and use this import:

```python
from backend.server import app as application
```

8. Open a Bash console on PythonAnywhere and install dependencies:

```bash
pip3.11 install --user -r /home/yourusername/yourproject/backend/requirements.txt
```

9. In the Web tab, reload the app.
10. Test the backend URL with:

```text
https://yourusername.pythonanywhere.com/api/health
```

## 3) Update the frontend API URL

1. Open `frontend/js/config.js`.
2. Set `API_BASE_URL` to your PythonAnywhere backend URL, for example:

```js
window.SCANPRO_CONFIG = {
  API_BASE_URL: "https://yourusername.pythonanywhere.com"
};
```

3. Commit and push that change to GitHub.

## 4) Deploy frontend on Netlify

1. In Netlify, create a new site from Git.
2. Select the same repository.
3. Use these build settings:
   - Build command: leave empty
   - Publish directory: `frontend`
4. Deploy.

## 5) Verify on any device

1. Open the Netlify link on phone or laptop.
2. Register/Login should use the PythonAnywhere backend.
3. Camera scanning should work because Netlify is HTTPS.

## Notes

- The backend uses SQLite locally inside `backend/data/users.db`.
- The backend still supports PostgreSQL if you later set `DATABASE_URL`.
- `backend/wsgi.py` exists for PythonAnywhere-style WSGI hosting.
