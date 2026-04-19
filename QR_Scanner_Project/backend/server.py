import json
import os
import sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock
from urllib.parse import urlparse

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(BASE_DIR)
FRONTEND_DIR = os.path.join(PROJECT_ROOT, "frontend")
DATA_DIR = os.path.join(BASE_DIR, "data")
os.makedirs(DATA_DIR, exist_ok=True)

USER_FILE = os.path.join(DATA_DIR, "users.txt")
SQLITE_DB_FILE = os.path.join(DATA_DIR, "users.db")
HOST = "0.0.0.0"
PORT = int(os.environ.get("PORT", "5000"))
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()

file_lock = Lock()


def using_postgres():
    return DATABASE_URL.startswith("postgres://") or DATABASE_URL.startswith("postgresql://")


def get_connection():
    if using_postgres():
        try:
            psycopg2 = __import__("psycopg2")
        except ImportError as exc:
            raise RuntimeError("DATABASE_URL is set but psycopg2 is not installed") from exc
        return psycopg2.connect(DATABASE_URL)

    return sqlite3.connect(SQLITE_DB_FILE)


def init_db():
    conn = get_connection()
    try:
        cursor = conn.cursor()
        if using_postgres():
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    email TEXT NOT NULL UNIQUE,
                    password TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
        else:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    email TEXT NOT NULL UNIQUE,
                    password TEXT NOT NULL,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
        conn.commit()
    finally:
        conn.close()


def get_user_count():
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM users")
        row = cursor.fetchone()
        return int(row[0]) if row else 0
    finally:
        conn.close()


def find_user(email):
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT email, password FROM users WHERE email = %s" if using_postgres() else "SELECT email, password FROM users WHERE email = ?",
            (email,)
        )
        row = cursor.fetchone()
        if not row:
            return None
        return row[0], row[1]
    finally:
        conn.close()


def append_user_to_legacy_file(email, password):
    with file_lock:
        known_users = set()
        if os.path.exists(USER_FILE):
            with open(USER_FILE, "r", encoding="utf-8") as file:
                for line in file:
                    line = line.strip()
                    if not line or "," not in line:
                        continue
                    existing_email, _ = line.split(",", 1)
                    existing_email = existing_email.strip().lower()
                    if existing_email:
                        known_users.add(existing_email)

        if email in known_users:
            return

        with open(USER_FILE, "a", encoding="utf-8") as file:
            file.write(f"{email},{password}\n")


def create_user(email, password):
    conn = get_connection()
    try:
        cursor = conn.cursor()
        if using_postgres():
            cursor.execute("INSERT INTO users (email, password) VALUES (%s, %s)", (email, password))
        else:
            cursor.execute("INSERT INTO users (email, password) VALUES (?, ?)", (email, password))
        conn.commit()
        try:
            append_user_to_legacy_file(email, password)
        except Exception as exc:
            print(f"[WARN] Could not update legacy users file: {exc}")
        return True
    except Exception:
        return False
    finally:
        conn.close()


def parse_legacy_users_file():
    users = []
    if not os.path.exists(USER_FILE):
        return users

    with file_lock:
        with open(USER_FILE, "r", encoding="utf-8") as file:
            for line in file:
                line = line.strip()
                if not line or "," not in line:
                    continue

                username, password = line.split(",", 1)
                username = username.strip().lower()
                password = password.strip()
                if not username or not password:
                    continue
                users.append((username, password))

    return users


def migrate_legacy_users_if_needed():
    if get_user_count() > 0:
        return

    legacy_users = parse_legacy_users_file()
    if not legacy_users:
        return

    conn = get_connection()
    try:
        cursor = conn.cursor()
        for email, password in legacy_users:
            try:
                if using_postgres():
                    cursor.execute(
                        "INSERT INTO users (email, password) VALUES (%s, %s) ON CONFLICT (email) DO NOTHING",
                        (email, password)
                    )
                else:
                    cursor.execute("INSERT OR IGNORE INTO users (email, password) VALUES (?, ?)", (email, password))
            except Exception:
                continue
        conn.commit()
    finally:
        conn.close()


class ApiHandler(BaseHTTPRequestHandler):
    def _send_json(self, status_code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def _send_text_file(self, file_path, content_type):
        if not os.path.exists(file_path):
            self._send_json(404, {"error": "Not found"})
            return

        with open(file_path, "rb") as file:
            data = file.read()

        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _read_json_body(self):
        content_length = int(self.headers.get("Content-Length", "0"))
        if content_length <= 0:
            return {}

        raw = self.rfile.read(content_length)
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return {}

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed_path = urlparse(self.path)
        path = parsed_path.path

        if path == "/" or path == "/index.html":
            self._send_text_file(os.path.join(FRONTEND_DIR, "index.html"), "text/html; charset=utf-8")
            return

        if path == "/scan.html":
            self._send_text_file(os.path.join(FRONTEND_DIR, "scan.html"), "text/html; charset=utf-8")
            return

        if path == "/upload.html":
            self._send_text_file(os.path.join(FRONTEND_DIR, "upload.html"), "text/html; charset=utf-8")
            return

        if path == "/js/app.js":
            self._send_text_file(os.path.join(FRONTEND_DIR, "js", "app.js"), "application/javascript; charset=utf-8")
            return

        if path == "/js/config.js":
            self._send_text_file(os.path.join(FRONTEND_DIR, "js", "config.js"), "application/javascript; charset=utf-8")
            return

        if path == "/css/styles.css":
            self._send_text_file(os.path.join(FRONTEND_DIR, "css", "styles.css"), "text/css; charset=utf-8")
            return

        if path == "/api/health":
            self._send_json(200, {"status": "ok"})
            return

        if path == "/api/account-stats":
            total_users = get_user_count()
            self._send_json(200, {"totalUsers": total_users})
            return

        self._send_json(404, {"error": "Not found"})

    def do_POST(self):
        parsed_path = urlparse(self.path)
        path = parsed_path.path

        if path == "/api/register":
            payload = self._read_json_body()
            email = str(payload.get("email", "")).strip().lower()
            password = str(payload.get("password", "")).strip()

            if not email or not password:
                self._send_json(400, {"error": "Email and password required"})
                return

            existing_user = find_user(email)
            if existing_user:
                self._send_json(409, {"error": "Account already exists"})
                return

            if create_user(email, password):
                self._send_json(201, {"message": "Registered"})
            else:
                self._send_json(500, {"error": "Could not create account"})
            return

        if path == "/api/login":
            payload = self._read_json_body()
            email = str(payload.get("email", "")).strip().lower()
            password = str(payload.get("password", "")).strip()

            if not email or not password:
                self._send_json(400, {"error": "Email and password required"})
                return

            user = find_user(email)
            if user:
                _, user_password = user
                if user_password == password:
                    self._send_json(200, {"message": "Login successful"})
                    return

                self._send_json(401, {"error": "Wrong password"})
                return

            self._send_json(404, {"error": "Account not found"})
            return

        if path == "/api/scan-result":
            payload = self._read_json_body()
            result = str(payload.get("result", "")).strip()
            timestamp = str(payload.get("timestamp", "")).strip()
            print(f"[SCAN] {timestamp} -> {result}")
            self._send_json(200, {"message": "Result received"})
            return

        self._send_json(404, {"error": "Not found"})


def main():
    init_db()
    migrate_legacy_users_if_needed()

    server = ThreadingHTTPServer((HOST, PORT), ApiHandler)

    print(f"HTTP Server running at http://127.0.0.1:{PORT}")
    print(f"Open from another device using: http://<YOUR-PC-IP>:{PORT}")
    print("Note: Camera on mobile will be blocked. Use HTTPS for camera access.")

    if using_postgres():
        print("Using database: PostgreSQL (DATABASE_URL)")
    else:
        print(f"Using database: SQLite ({SQLITE_DB_FILE})")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
