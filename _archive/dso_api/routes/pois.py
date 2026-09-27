from fastapi import APIRouter
from database import get_cursor
import json

router = APIRouter()


@router.get("/pois")
def pois():
    """
    Returns all Points of Interest (amenities) in Dubai Silicon Oasis as GeoJSON.
    Source: planet_osm_point WHERE amenity IS NOT NULL
    Geometry is reprojected from EPSG:3857 → EPSG:4326 (WGS84 lon/lat).
    """
    cur = get_cursor()

    cur.execute("""
        SELECT
            ST_AsGeoJSON(ST_Transform(way, 4326)) AS geom,
            osm_id,
            name,
            amenity,
            shop,
            tourism,
            tags->'cuisine'        AS cuisine,
            tags->'opening_hours'  AS opening_hours,
            tags->'website'        AS website,
            tags->'phone'          AS phone,
            tags->'wheelchair'     AS wheelchair,
            tags->'operator'       AS operator
        FROM planet_osm_point
        WHERE amenity IS NOT NULL
          AND way && ST_Transform(ST_MakeEnvelope(55.355, 25.085, 55.415, 25.155, 4326), 3857)
        ORDER BY osm_id
    """)

    rows = cur.fetchall()
    cur.close()

    features = []
    for row in rows:
        geom, osm_id, name, amenity, shop, tourism, cuisine, opening_hours, website, phone, wheelchair, operator = row
        features.append({
            "type": "Feature",
            "geometry": json.loads(geom),
            "properties": {
                "osm_id":        osm_id,
                "name":          name,
                "amenity":       amenity,
                "shop":          shop,
                "tourism":       tourism,
                "cuisine":       cuisine,
                "opening_hours": opening_hours,
                "website":       website,
                "phone":         phone,
                "wheelchair":    wheelchair,
                "operator":      operator,
            }
        })

    return {
        "type": "FeatureCollection",
        "features": features
    }
