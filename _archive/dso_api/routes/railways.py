from fastapi import APIRouter
from database import get_cursor
import json

router = APIRouter()


@router.get("/railways")
def railways():
    """
    Returns all railway lines in Dubai Silicon Oasis as GeoJSON.
    Source: planet_osm_line WHERE railway IS NOT NULL
    Geometry is reprojected from EPSG:3857 → EPSG:4326 (WGS84 lon/lat).
    Includes: metro/rail lines, tram, light rail, platforms, etc.
    """
    cur = get_cursor()

    cur.execute("""
        SELECT
            ST_AsGeoJSON(ST_Transform(way, 4326)) AS geom,
            osm_id,
            name,
            railway,
            ref,
            tags->'service'       AS service,
            tags->'operator'      AS operator,
            tags->'gauge'         AS gauge,
            tags->'electrified'   AS electrified,
            tags->'maxspeed'      AS maxspeed,
            tags->'network'       AS network
        FROM planet_osm_line
        WHERE railway IS NOT NULL
          AND way && ST_Transform(ST_MakeEnvelope(55.355, 25.085, 55.415, 25.155, 4326), 3857)
        ORDER BY osm_id
    """)

    rows = cur.fetchall()
    cur.close()

    features = []
    for row in rows:
        geom, osm_id, name, railway, ref, service, operator, gauge, electrified, maxspeed, network = row
        features.append({
            "type": "Feature",
            "geometry": json.loads(geom),
            "properties": {
                "osm_id":       osm_id,
                "name":         name,
                "railway":      railway,
                "ref":          ref,
                "service":      service,
                "operator":     operator,
                "gauge":        gauge,
                "electrified":  electrified,
                "maxspeed":     maxspeed,
                "network":      network,
            }
        })

    return {
        "type": "FeatureCollection",
        "features": features
    }
