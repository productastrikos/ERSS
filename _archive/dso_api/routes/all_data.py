from fastapi import APIRouter
from database import get_cursor
import json

router = APIRouter()

# ------------------------------------------------------------------
# Helper: execute a query and return a list of GeoJSON Features
# ------------------------------------------------------------------

def _fetch_features(cur, sql: str, prop_builder) -> list:
    cur.execute(sql)
    rows = cur.fetchall()
    features = []
    for row in rows:
        geom_str = row[0]
        if geom_str is None:
            continue
        props = prop_builder(row[1:])
        features.append({
            "type": "Feature",
            "geometry": json.loads(geom_str),
            "properties": props,
        })
    return features


@router.get("/all")
def all_data():
    """
    Returns ALL Dubai Silicon Oasis map data in a single response.

    The response is a JSON object where each key is a layer name and
    the value is a GeoJSON FeatureCollection:

        {
          "roads":     { "type": "FeatureCollection", "features": [...] },
          "buildings": { "type": "FeatureCollection", "features": [...] },
          "pois":      { "type": "FeatureCollection", "features": [...] },
          "parks":     { "type": "FeatureCollection", "features": [...] },
          "water":     { "type": "FeatureCollection", "features": [...] },
          "railways":  { "type": "FeatureCollection", "features": [...] }
        }

    Use each key as a separate MapLibre source.
    """
    cur = get_cursor()

    # ---- Roads ----
    road_features = _fetch_features(cur, """
        SELECT ST_AsGeoJSON(ST_Transform(way, 4326)),
               osm_id, name, highway, ref, surface, oneway
        FROM planet_osm_line
        WHERE highway IS NOT NULL
    """, lambda r: {
        "layer": "roads", "osm_id": r[0], "name": r[1],
        "highway": r[2], "ref": r[3], "surface": r[4], "oneway": r[5]
    })

    # ---- Buildings ----
    building_features = _fetch_features(cur, """
        SELECT ST_AsGeoJSON(ST_Transform(way, 4326)),
               osm_id, name, building, amenity,
               tags->'height' AS height, tags->'building:levels' AS levels
        FROM planet_osm_polygon
        WHERE building IS NOT NULL
    """, lambda r: {
        "layer": "buildings", "osm_id": r[0], "name": r[1],
        "building": r[2], "amenity": r[3], "height": r[4], "levels": r[5]
    })

    # ---- POIs ----
    poi_features = _fetch_features(cur, """
        SELECT ST_AsGeoJSON(ST_Transform(way, 4326)),
               osm_id, name, amenity, shop,
               tags->'cuisine' AS cuisine, tags->'opening_hours' AS opening_hours
        FROM planet_osm_point
        WHERE amenity IS NOT NULL
    """, lambda r: {
        "layer": "pois", "osm_id": r[0], "name": r[1],
        "amenity": r[2], "shop": r[3], "cuisine": r[4], "opening_hours": r[5]
    })

    # ---- Parks / Landuse ----
    park_features = _fetch_features(cur, """
        SELECT ST_AsGeoJSON(ST_Transform(way, 4326)),
               osm_id, name, landuse
        FROM planet_osm_polygon
        WHERE landuse IS NOT NULL
    """, lambda r: {
        "layer": "parks", "osm_id": r[0], "name": r[1], "landuse": r[2]
    })

    # ---- Water (polygons + lines) ----
    water_poly = _fetch_features(cur, """
        SELECT ST_AsGeoJSON(ST_Transform(way, 4326)),
               osm_id, name, water, waterway
        FROM planet_osm_polygon
        WHERE water IS NOT NULL OR waterway IS NOT NULL
    """, lambda r: {
        "layer": "water", "osm_id": r[0], "name": r[1],
        "water": r[2], "waterway": r[3], "source": "polygon"
    })
    water_line = _fetch_features(cur, """
        SELECT ST_AsGeoJSON(ST_Transform(way, 4326)),
               osm_id, name, waterway
        FROM planet_osm_line
        WHERE waterway IS NOT NULL
    """, lambda r: {
        "layer": "water", "osm_id": r[0], "name": r[1],
        "waterway": r[2], "source": "line"
    })

    # ---- Railways ----
    railway_features = _fetch_features(cur, """
        SELECT ST_AsGeoJSON(ST_Transform(way, 4326)),
               osm_id, name, railway, ref
        FROM planet_osm_line
        WHERE railway IS NOT NULL
    """, lambda r: {
        "layer": "railways", "osm_id": r[0], "name": r[1],
        "railway": r[2], "ref": r[3]
    })

    cur.close()

    def fc(features):
        return {"type": "FeatureCollection", "features": features}

    return {
        "roads":     fc(road_features),
        "buildings": fc(building_features),
        "pois":      fc(poi_features),
        "parks":     fc(park_features),
        "water":     fc(water_poly + water_line),
        "railways":  fc(railway_features),
        "summary": {
            "roads":     len(road_features),
            "buildings": len(building_features),
            "pois":      len(poi_features),
            "parks":     len(park_features),
            "water":     len(water_poly) + len(water_line),
            "railways":  len(railway_features),
        }
    }
