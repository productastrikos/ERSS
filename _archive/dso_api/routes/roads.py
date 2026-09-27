from fastapi import APIRouter
from database import get_cursor
import json

router = APIRouter()


@router.get("/roads")
def roads():
    """
    Returns all roads and highway features in Dubai Silicon Oasis as GeoJSON.
    Source: planet_osm_line WHERE highway IS NOT NULL
    Geometry is reprojected from EPSG:3857 → EPSG:4326 (WGS84 lon/lat).
    """
    cur = get_cursor()

    cur.execute("""
        SELECT
            ST_AsGeoJSON(ST_Transform(way, 4326)) AS geom,
            osm_id,
            name,
            highway,
            ref,
            surface,
            oneway,
            tags->'maxspeed'   AS maxspeed,
            tags->'lanes'      AS lanes,
            tags->'lit'        AS lit,
            tags->'bridge'     AS bridge_tag,
            tags->'tunnel'     AS tunnel
        FROM planet_osm_line
        WHERE highway IS NOT NULL
          AND way && ST_Transform(ST_MakeEnvelope(55.355, 25.085, 55.415, 25.155, 4326), 3857)
        ORDER BY osm_id
    """)

    rows = cur.fetchall()
    cur.close()

    features = []
    for row in rows:
        geom, osm_id, name, highway, ref, surface, oneway, maxspeed, lanes, lit, bridge_tag, tunnel = row
        features.append({
            "type": "Feature",
            "geometry": json.loads(geom),
            "properties": {
                "osm_id":    osm_id,
                "name":      name,
                "highway":   highway,
                "ref":       ref,
                "surface":   surface,
                "oneway":    oneway,
                "maxspeed":  maxspeed,
                "lanes":     lanes,
                "lit":       lit,
                "bridge":    bridge_tag,
                "tunnel":    tunnel,
            }
        })

    return {
        "type": "FeatureCollection",
        "features": features
    }
