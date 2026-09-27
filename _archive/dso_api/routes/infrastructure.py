from fastapi import APIRouter
from database import get_cursor
import json

router = APIRouter()

# ── Category mapping ─────────────────────────────────────────────────────────
def _derive_category(highway: str | None, man_made: str | None,
                     amenity: str | None, power: str | None,
                     emergency: str | None) -> str:
    # highway-based
    if highway == 'bus_stop':                             return 'bus_stop'
    if highway == 'speed_camera':                         return 'speed_camera'
    if highway == 'crossing':                             return 'crossing'
    if highway in ('turning_circle', 'turning_loop'):     return 'roundabout'
    if highway in ('stop', 'motorway_junction'):          return 'road_sign'
    # man_made-based
    if man_made in ('surveillance', 'camera'):            return 'cctv'
    if man_made == 'street_lamp':                         return 'street_lamp'
    if man_made == 'mast':                                return 'mast'
    if man_made == 'flagpole':                            return 'flagpole'
    if man_made == 'tower':                               return 'tower'
    if man_made == 'water_tap':                           return 'water_tap'
    if man_made == 'wastewater_plant':                    return 'wastewater_plant'
    if man_made == 'pumping_station':                     return 'pumping_station'
    # amenity-based
    if amenity == 'charging_station':                     return 'ev_charging'
    if amenity == 'recycling':                            return 'recycling'
    if amenity == 'waste_basket':                         return 'waste_basket'
    if amenity == 'drinking_water':                       return 'drinking_water'
    if amenity == 'toilets':                              return 'toilets'
    # emergency
    if emergency == 'fire_hydrant':                       return 'fire_hydrant'
    # power (polygons)
    if power == 'substation':                             return 'power_substation'
    return 'infrastructure'


@router.get("/infrastructure")
def infrastructure():
    """
    Returns all infrastructure nodes + utility polygons in Dubai Silicon Oasis
    as a single GeoJSON FeatureCollection (WGS84 lon/lat).

    Point sources:
      - highway: bus_stop, speed_camera, crossing, turning_circle/loop,
                 stop, motorway_junction
      - man_made: surveillance, camera, street_lamp, mast, flagpole,
                  tower, water_tap
      - amenity:  charging_station, recycling, waste_basket,
                  drinking_water, toilets
      - tags->emergency = fire_hydrant

    Polygon sources (centroid used as point):
      - power = substation
      - man_made IN (wastewater_plant, pumping_station)
    """
    cur = get_cursor()

    # ── 1. Point features ──────────────────────────────────────────────────
    cur.execute("""
        SELECT
            ST_AsGeoJSON(ST_Transform(way, 4326))  AS geom,
            osm_id,
            name,
            highway,
            man_made,
            amenity,
            NULL::text                             AS power,
            tags->'emergency'                      AS emergency,
            tags->'crossing'                       AS crossing_type,
            tags->'traffic_signals'                AS traffic_signals,
            tags->'ref'                            AS ref,
            tags->'operator'                       AS operator,
            tags->'surveillance:type'              AS surveillance_type,
            tags->'description'                    AS description,
            tags->'height'                         AS height,
            tags->'capacity'                       AS capacity,
            tags->'recycling_type'                 AS recycling_type,
            tags->'socket:type2'                   AS socket_type
        FROM planet_osm_point
        WHERE highway IN (
            'bus_stop', 'speed_camera', 'crossing',
            'turning_circle', 'turning_loop',
            'stop', 'motorway_junction'
        )
        OR man_made IN (
            'surveillance', 'street_lamp', 'camera',
            'mast', 'flagpole', 'tower', 'water_tap'
        )
        OR amenity IN (
            'charging_station', 'recycling', 'waste_basket',
            'drinking_water', 'toilets'
        )
        OR tags->'emergency' = 'fire_hydrant'
          AND way && ST_Transform(ST_MakeEnvelope(55.355, 25.085, 55.415, 25.155, 4326), 3857)
        ORDER BY osm_id
    """)
    point_rows = cur.fetchall()

    # ── 2. Polygon utilities → centroid point ──────────────────────────────
    cur.execute("""
        SELECT
            ST_AsGeoJSON(ST_Transform(ST_Centroid(way), 4326))  AS geom,
            osm_id,
            name,
            NULL::text   AS highway,
            man_made,
            amenity,
            power,
            NULL::text   AS emergency,
            NULL::text   AS crossing_type,
            NULL::text   AS traffic_signals,
            tags->'ref'          AS ref,
            tags->'operator'     AS operator,
            NULL::text   AS surveillance_type,
            tags->'description'  AS description,
            tags->'height'       AS height,
            NULL::text   AS capacity,
            NULL::text   AS recycling_type,
            NULL::text   AS socket_type
        FROM planet_osm_polygon
        WHERE (power = 'substation'
           OR man_made IN ('wastewater_plant', 'pumping_station'))
          AND way && ST_Transform(ST_MakeEnvelope(55.355, 25.085, 55.415, 25.155, 4326), 3857)
        ORDER BY osm_id
    """)
    poly_rows = cur.fetchall()

    cur.close()

    features = []
    for row in (point_rows + poly_rows):
        (geom, osm_id, name, highway, man_made, amenity, power, emergency,
         crossing_type, traffic_signals, ref, operator,
         surveillance_type, description, height,
         capacity, recycling_type, socket_type) = row

        category = _derive_category(highway, man_made, amenity, power, emergency)

        features.append({
            "type": "Feature",
            "geometry": json.loads(geom),
            "properties": {
                "osm_id":             osm_id,
                "name":               name,
                "highway":            highway,
                "man_made":           man_made,
                "amenity":            amenity,
                "power":              power,
                "category":           category,
                "crossing_type":      crossing_type,
                "traffic_signals":    traffic_signals,
                "ref":                ref,
                "operator":           operator,
                "surveillance_type":  surveillance_type,
                "description":        description,
                "height":             height,
                "capacity":           capacity,
                "recycling_type":     recycling_type,
                "socket_type":        socket_type,
            }
        })

    return {
        "type": "FeatureCollection",
        "features": features
    }
