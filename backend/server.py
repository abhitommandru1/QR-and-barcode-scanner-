import os
import sqlite3
from threading import Lock

from flask import Flask, jsonify, request

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(BASE_DIR)
DATA_DIR = os.path.join(BASE_DIR, "data")
os.makedirs(DATA_DIR, exist_ok=True)

USER_FILE = os.path.join(DATA_DIR, "users.txt")
SQLITE_DB_FILE = os.path.join(DATA_DIR, "users.db")
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()

app = Flask(__name__)

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


@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


@app.route("/", methods=["GET"])
def home():
    return jsonify({"status": "ok", "service": "qr-scanner-api"})


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


@app.route("/api/account-stats", methods=["GET"])
def account_stats():
    total_users = get_user_count()
    return jsonify({"totalUsers": total_users})


@app.route("/api/register", methods=["POST", "OPTIONS"])
def register():
    if request.method == "OPTIONS":
        return ("", 204)

    payload = request.get_json(silent=True) or {}
    email = str(payload.get("email", "")).strip().lower()
    password = str(payload.get("password", "")).strip()

    if not email or not password:
        return jsonify({"error": "Email and password required"}), 400

    existing_user = find_user(email)
    if existing_user:
        return jsonify({"error": "Account already exists"}), 409

    if create_user(email, password):
        return jsonify({"message": "Registered"}), 201

    return jsonify({"error": "Could not create account"}), 500


@app.route("/api/login", methods=["POST", "OPTIONS"])
def login():
    if request.method == "OPTIONS":
        return ("", 204)

    payload = request.get_json(silent=True) or {}
    email = str(payload.get("email", "")).strip().lower()
    password = str(payload.get("password", "")).strip()

    if not email or not password:
        return jsonify({"error": "Email and password required"}), 400

    user = find_user(email)
    if user:
        _, user_password = user
        if user_password == password:
            return jsonify({"message": "Login successful"}), 200

        return jsonify({"error": "Wrong password"}), 401

    return jsonify({"error": "Account not found"}), 404


@app.route("/api/scan-result", methods=["POST", "OPTIONS"])
def scan_result():
    if request.method == "OPTIONS":
        return ("", 204)

    payload = request.get_json(silent=True) or {}
    result = str(payload.get("result", "")).strip()
    timestamp = str(payload.get("timestamp", "")).strip()
    print(f"[SCAN] {timestamp} -> {result}")
    return jsonify({"message": "Result received"})


def main():
    init_db()
    migrate_legacy_users_if_needed()

    port = int(os.environ.get("PORT", "5000"))
    debug_mode = os.environ.get("FLASK_DEBUG", "0") == "1"

    if using_postgres():
        print("Using database: PostgreSQL (DATABASE_URL)")
    else:
        print(f"Using database: SQLite ({SQLITE_DB_FILE})")

    print(f"Flask API running on http://127.0.0.1:{port}")
    app.run(host="0.0.0.0", port=port, debug=debug_mode)


if __name__ == "__main__":
    main()
