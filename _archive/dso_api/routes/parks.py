from fastapi import APIRouter
from database import get_cursor
import json

router = APIRouter()


@router.get("/parks")
def parks():
    """
    Returns all parks, green spaces, and landuse polygons in Dubai Silicon Oasis as GeoJSON.
    Source: planet_osm_polygon WHERE landuse IS NOT NULL
    Geometry is reprojected from EPSG:3857 → EPSG:4326 (WGS84 lon/lat).
    """
    cur = get_cursor()

    cur.execute("""
        SELECT
            ST_AsGeoJSON(ST_Transform(way, 4326)) AS geom,
            osm_id,
            name,
            landuse,
            tags->'leisure'      AS leisure,
            tags->'access'       AS access,
            tags->'surface'      AS surface,
            tags->'operator'     AS operator,
            tags->'description'  AS description
        FROM planet_osm_polygon
        WHERE landuse IS NOT NULL
          AND way && ST_Transform(ST_MakeEnvelope(55.355, 25.085, 55.415, 25.155, 4326), 3857)
        ORDER BY osm_id
    """)

    rows = cur.fetchall()
    cur.close()

    features = []
    for row in rows:
        geom, osm_id, name, landuse, leisure, access, surface, operator, description = row
        features.append({
            "type": "Feature",
            "geometry": json.loads(geom),
            "properties": {
                "osm_id":      osm_id,
                "name":        name,
                "landuse":     landuse,
                "leisure":     leisure,
                "access":      access,
                "surface":     surface,
                "operator":    operator,
                "description": description,
            }
        })

    return {
        "type": "FeatureCollection",
        "features": features
    }
