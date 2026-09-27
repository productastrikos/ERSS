import psycopg2
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

import database
from database import get_cursor
from routes import roads
from routes import buildings
from routes import pois
from routes import parks
from routes import water
from routes import railways
from routes import all_data
from routes import infrastructure

app = FastAPI(
    title="Dubai Silicon Oasis Map API",
    description=(
        "GeoJSON API serving OpenStreetMap data for Dubai Silicon Oasis (DSO). "
        "All geometry is returned in WGS84 (EPSG:4326 — lon/lat), "
        "ready for use with MapLibre GL JS."
    ),
    version="1.0.0",
)

# Allow all origins (needed when consuming from a browser / MapLibre)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.exception_handler(psycopg2.Error)
def database_error_handler(request: Request, exc: psycopg2.Error):
    """Turn an unreachable/erroring database into a clear 503 instead of an
    opaque 500, so a DB outage is distinguishable from an app bug."""
    print(f"[DB] {type(exc).__name__} on {request.url.path}: {exc}")
    return JSONResponse(
        status_code=503,
        content={
            "error":  "database_unavailable",
            "detail": str(exc).strip(),
            "target": f"{database.DB_HOST}:{database.DB_PORT}/{database.DB_NAME}",
            "hint":   "Check the database is running: pg_lsclusters / ss -tlnp | grep 5432",
        },
    )


# ---- Register routers ----
app.include_router(roads.router,          tags=["Roads"])
app.include_router(buildings.router,      tags=["Buildings"])
app.include_router(pois.router,           tags=["Points of Interest"])
app.include_router(parks.router,          tags=["Parks & Landuse"])
app.include_router(water.router,          tags=["Water"])
app.include_router(railways.router,       tags=["Railways"])
app.include_router(all_data.router,       tags=["All Layers"])
app.include_router(infrastructure.router, tags=["Infrastructure"])


@app.get("/", tags=["Info"])
def root():
    """API status and endpoint listing."""
    return {
        "status":  "running",
        "title":   "Dubai Silicon Oasis Map API",
        "docs":    "/docs",
        "endpoints": {
            "health":    "/health",
            "roads":     "/roads",
            "buildings": "/buildings",
            "pois":      "/pois",
            "parks":     "/parks",
            "water":     "/water",
            "railways":      "/railways",
            "all":           "/all",
            "infrastructure":"/infrastructure",
        }
    }


@app.get("/health", tags=["Info"])
def health():
    """Liveness + database reachability. Returns 503 when the DB is down."""
    target = f"{database.DB_HOST}:{database.DB_PORT}/{database.DB_NAME}"
    try:
        cur = get_cursor()
        cur.execute("SELECT 1")
        cur.close()
    except Exception as exc:
        return JSONResponse(
            status_code=503,
            content={
                "status":   "degraded",
                "api":      "up",
                "database": "down",
                "target":   target,
                "user":     database.DB_USER,
                "detail":   str(exc).strip(),
            },
        )
    return {
        "status":   "ok",
        "api":      "up",
        "database": "up",
        "target":   target,
        "user":     database.DB_USER,
    }
