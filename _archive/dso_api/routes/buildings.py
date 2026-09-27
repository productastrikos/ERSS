from fastapi import APIRouter
from database import get_cursor
import json

router = APIRouter()


@router.get("/buildings")
def buildings():
    """
    Returns all buildings in Dubai Silicon Oasis as GeoJSON polygons.
    Source: planet_osm_polygon WHERE building IS NOT NULL
    Geometry is reprojected from EPSG:3857 → EPSG:4326 (WGS84 lon/lat).
    """
    cur = get_cursor()

    cur.execute("""
        SELECT
            ST_AsGeoJSON(ST_Transform(way, 4326)) AS geom,
            osm_id,
            name,
            building,
            amenity,
            shop,
            tourism,
            tags->'height'           AS height,
            tags->'building:levels'  AS levels,
            tags->'building:use'     AS building_use,
            tags->'addr:street'      AS street,
            tags->'addr:housenumber' AS housenumber,
            tags->'operator'         AS operator,
            tags->'website'          AS website
        FROM planet_osm_polygon
        WHERE building IS NOT NULL
          AND way && ST_Transform(ST_MakeEnvelope(55.355, 25.085, 55.415, 25.155, 4326), 3857)
        ORDER BY osm_id
    """)

    rows = cur.fetchall()
    cur.close()

    features = []
    for row in rows:
        geom, osm_id, name, building, amenity, shop, tourism, height, levels, building_use, street, housenumber, operator, website = row
        features.append({
            "type": "Feature",
            "geometry": json.loads(geom),
            "properties": {
                "osm_id":        osm_id,
                "name":          name,
                "building":      building,
                "amenity":       amenity,
                "shop":          shop,
                "tourism":       tourism,
                "height":        height,
                "levels":        levels,
                "building_use":  building_use,
                "street":        street,
                "housenumber":   housenumber,
                "operator":      operator,
                "website":       website,
            }
        })

    # ── Custom buildings not yet in OpenStreetMap (override any DB record) ───
    # The NEST — traced polygon (lat/lng swapped to GeoJSON [lng, lat])
    CUSTOM_BUILDINGS = [
        {
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [55.37529491624901, 25.11959399342008],
                    [55.374500702830176, 25.11962396710278],
                    [55.37454610060958, 25.119868806645762],
                    [55.3747462559295,  25.120229677627563],
                    [55.374931253967674, 25.120363011655833],
                    [55.37527268825716, 25.1199846785036],
                    [55.375277789664324, 25.119957480553836],
                    [55.37526450832338, 25.119945381892894],
                    [55.37518124220782, 25.119906061198748],
                    [55.37512287405335, 25.11991059106487],
                    [55.37506118778259, 25.119928656621916],
                    [55.37495110073453, 25.12006158353702],
                    [55.37487439227231, 25.12008876354213],
                    [55.374859305891356, 25.120079703909315],
                    [55.37489104868011, 25.120060071499278],
                    [55.37477907389406, 25.1198529592062],
                    [55.3747857836267,  25.119831830851183],
                    [55.3753127193624,  25.119796088920015],
                    [55.37529491624901, 25.11959399342008],
                ]]
            },
            "properties": {
                "osm_id":       -999001,
                "name":         "The NEST",
                "building":     "office",
                "amenity":      None,
                "shop":         None,
                "tourism":      None,
                "height":       "17",
                "levels":       "4",
                "building_use": "office",
                "street":       "Dubai Digital Park",
                "housenumber":  None,
                "operator":     "Dubai Silicon Oasis",
                "website":      "https://www.dsoa.ae",
            }
        },
    ]

    # Remove any DB features whose osm_id is overridden by CUSTOM_BUILDINGS
    custom_ids = {f["properties"]["osm_id"] for f in CUSTOM_BUILDINGS}
    db_features = [f for f in features if f["properties"]["osm_id"] not in custom_ids]

    return {
        "type": "FeatureCollection",
        "features": db_features + CUSTOM_BUILDINGS
    }
