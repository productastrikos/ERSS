from fastapi import APIRouter
from database import get_cursor
import json

router = APIRouter()


@router.get("/water")
def water():
    """
    Returns all water bodies and waterways in Dubai Silicon Oasis as GeoJSON.
    Combines:
      - planet_osm_polygon WHERE water IS NOT NULL OR waterway IS NOT NULL  (lakes, ponds, canals)
      - planet_osm_line    WHERE waterway IS NOT NULL                       (rivers, streams)
    Geometry is reprojected from EPSG:3857 → EPSG:4326 (WGS84 lon/lat).
    """
    cur = get_cursor()

    # Water polygons (lakes, ponds, reservoirs, canals)
    cur.execute("""
        SELECT
            ST_AsGeoJSON(ST_Transform(way, 4326)) AS geom,
            osm_id,
            name,
            water,
            waterway,
            tags->'depth'        AS depth,
            tags->'description'  AS description
        FROM planet_osm_polygon
        WHERE (water IS NOT NULL OR waterway IS NOT NULL)
          AND way && ST_Transform(ST_MakeEnvelope(55.355, 25.085, 55.415, 25.155, 4326), 3857)
        ORDER BY osm_id
    """)
    poly_rows = cur.fetchall()

    # Waterway lines (rivers, streams, canals as lines)
    cur.execute("""
        SELECT
            ST_AsGeoJSON(ST_Transform(way, 4326)) AS geom,
            osm_id,
            name,
            waterway,
            tags->'width'        AS width,
            tags->'intermittent' AS intermittent
        FROM planet_osm_line
        WHERE waterway IS NOT NULL
          AND way && ST_Transform(ST_MakeEnvelope(55.355, 25.085, 55.415, 25.155, 4326), 3857)
        ORDER BY osm_id
    """)
    line_rows = cur.fetchall()
    cur.close()

    features = []

    for row in poly_rows:
        geom, osm_id, name, water, waterway, depth, description = row
        features.append({
            "type": "Feature",
            "geometry": json.loads(geom),
            "properties": {
                "osm_id":      osm_id,
                "name":        name,
                "water":       water,
                "waterway":    waterway,
                "depth":       depth,
                "description": description,
                "source":      "polygon",
            }
        })

    for row in line_rows:
        geom, osm_id, name, waterway, width, intermittent = row
        features.append({
            "type": "Feature",
            "geometry": json.loads(geom),
            "properties": {
                "osm_id":       osm_id,
                "name":         name,
                "waterway":     waterway,
                "width":        width,
                "intermittent": intermittent,
                "source":       "line",
            }
        })

    return {
        "type": "FeatureCollection",
        "features": features
    }
