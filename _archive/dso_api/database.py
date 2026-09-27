import os
from pathlib import Path

import psycopg2
import psycopg2.extras

_connection = None


def _load_env_file():
    """Read KEY=VALUE pairs from a .env beside this file into os.environ.

    Stdlib-only (no python-dotenv) so the app picks up its config the same way
    whether it is launched by gunicorn, uvicorn, pm2 or systemd. Real
    environment variables always win over the file.
    """
    env_path = Path(__file__).with_name(".env")
    if not env_path.is_file():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


_load_env_file()

DB_HOST = os.environ.get("DB_HOST", "127.0.0.1")
DB_NAME = os.environ.get("DB_NAME", "DSO_db_2")
DB_USER = os.environ.get("DB_USER", "postgres")
DB_PASSWORD = os.environ.get("DB_PASSWORD")
DB_PORT = int(os.environ.get("DB_PORT", 5432))


def get_cursor():
    """Lazy-connect on first call; reconnect if connection was lost."""
    global _connection
    try:
        if _connection is None:
            raise Exception("not connected")
        _connection.cursor().execute("SELECT 1")
    except Exception:
        print(f"[DB] Connecting to {DB_HOST}:{DB_PORT}/{DB_NAME} as {DB_USER} ...")
        _connection = psycopg2.connect(
            host=DB_HOST,
            database=DB_NAME,
            user=DB_USER,
            password=DB_PASSWORD,
            port=DB_PORT,
            connect_timeout=10,
        )
        psycopg2.extras.register_hstore(_connection)
        _connection.autocommit = True
        print("[DB] Connected.")
    return _connection.cursor()
