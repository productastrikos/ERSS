/**
 * NestBuilding3D — Schneider Electric "The NEST" 3D Digital Twin
 *
 * U-shaped horseshoe: left wing + back connector + right wing (curved SE corner)
 * Opening faces south (front). Realistic office facade — no bright cartoon colours.
 * Interactive: hover highlight, click to select room, floor filter, incident overlay.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
export type NestFloor    = 'F1' | 'F2' | 'F3';
export type NestIncident = 'fire' | 'hvac' | 'power' | 'occupancy' | 'energy' | null;

interface Room3D {
  id:        string;
  name:      string;
  floor:     NestFloor;
  pts:       [number, number][];
  height:    number;
  baseColor: number;
  systems:   string[];
  people?:   number;
  capacity?: number;
}

interface Props {
  selectedFloor: NestFloor | null;
  incidentSim:   NestIncident;
  incidentStage: number;
  activeSystem?: string | null;
  walkMode?:     boolean;
  onRoomClick?:  (roomId: string) => void;
  onFloorClick?: (floor: NestFloor) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Building Constants
// ─────────────────────────────────────────────────────────────────────────────
const FLOOR_H  = 4.0;
const SLAB_H   = 0.25;
const N_FLOORS = 3;
const TOT_H    = N_FLOORS * FLOOR_H;

// Plan (metres): Z=0 south/front, Z=60 north/back
const LW_X0  = 0;    // left wing west edge
const LW_X1  = 35;   // left wing east edge
const RW_X0  = 55;   // right wing west edge
const RW_X1  = 80;   // right wing east edge
const BD     = 60;   // total north-south depth
const CTY_D  = 50;   // courtyard depth (connector starts at Z=50)
const CR     = 10;   // SE corner curve radius

const FLOOR_Y: Record<NestFloor, number> = { F1: 0, F2: FLOOR_H, F3: FLOOR_H * 2 };
const ALL_FLOORS: NestFloor[] = ['F1', 'F2', 'F3'];

// Building exterior & interior palette
const PAL = {
  EXTERIOR   : 0x7a9ec0,   // main building mass — steel blue (matches reference)
  CONC_LIGHT : 0xe0e8f4,   // bright off-white cladding
  CONC_MID   : 0xc0cad8,   // medium grey concrete
  OFFICE_WARM: 0xd8d2c8,   // warm grey interior
  OFFICE_COOL: 0xccd6ea,   // cool grey interior
  OFFICE_NEUT: 0xd0d4d8,   // neutral grey interior
  SPANDREL   : 0x3a4a5c,   // dark aluminium spandrel
  MULLION    : 0xc8d8e4,   // aluminium mullion
  GLASS      : 0x90c0dc,   // blue-tinted curtain glass
};

// Incident overlay colours
const INC_COL: Record<NonNullable<NestIncident>, number> = {
  fire: 0xff2200, hvac: 0x00aaff, power: 0xffcc00, occupancy: 0xff7700, energy: 0x00ee88,
};
const ALERT_CSS_COLOR: Record<NonNullable<NestIncident>, string> = {
  fire: '#ff4422', hvac: '#00aaff', power: '#ffcc00', occupancy: '#ff7700', energy: '#00ee88',
};
const ALERT_ICON: Record<NonNullable<NestIncident>, string> = {
  fire: '🔥', hvac: '❄️', power: '⚡', occupancy: '👥', energy: '💡',
};

// ─────────────────────────────────────────────────────────────────────────────
// Room definitions  (neutral base colours, no rainbow)
// ─────────────────────────────────────────────────────────────────────────────
const F1_ROOMS: Room3D[] = [
  { id:'F1_LOBBY',    name:'Main Lobby',     floor:'F1', pts:[[2,5],[16,5],[16,20],[2,20]],       height:FLOOR_H, baseColor:PAL.OFFICE_COOL, systems:['lighting','hvac','access'],  people:25, capacity:50 },
  { id:'F1_CAFE',     name:'Cafeteria',      floor:'F1', pts:[[18,5],[33,5],[33,20],[18,20]],      height:FLOOR_H, baseColor:PAL.OFFICE_WARM, systems:['lighting','hvac','water'],   people:15, capacity:40 },
  { id:'F1_TRAIN',    name:'Training Room',  floor:'F1', pts:[[2,22],[33,22],[33,36],[2,36]],      height:FLOOR_H, baseColor:PAL.OFFICE_NEUT, systems:['lighting','hvac','av'],      people:20, capacity:35 },
  { id:'F1_LAB',      name:'Innovation Lab', floor:'F1', pts:[[2,38],[33,38],[33,58],[2,58]],      height:FLOOR_H, baseColor:PAL.CONC_MID,   systems:['lighting','hvac','power'],   people:12, capacity:20 },
  { id:'F1_DEMO',     name:'Demo Center',    floor:'F1', pts:[[57,5],[78,5],[78,28],[57,28]],      height:FLOOR_H, baseColor:PAL.OFFICE_COOL, systems:['lighting','hvac','av'],      people:18, capacity:30 },
  { id:'F1_WORK',     name:'Workshop',       floor:'F1', pts:[[57,30],[78,30],[78,58],[57,58]],    height:FLOOR_H, baseColor:PAL.CONC_LIGHT,  systems:['lighting','hvac','power'],   people:10, capacity:15 },
  { id:'F1_CORR',     name:'Connector Hall', floor:'F1', pts:[[37,51],[53,51],[53,58],[37,58]],    height:FLOOR_H, baseColor:PAL.CONC_MID,   systems:['lighting','access'],         people:5,  capacity:20 },
];
const F2_ROOMS: Room3D[] = [
  { id:'F2_OFFL',     name:'Open Office',    floor:'F2', pts:[[2,5],[33,5],[33,30],[2,30]],        height:FLOOR_H, baseColor:PAL.CONC_LIGHT,  systems:['lighting','hvac','power'],   people:35, capacity:50 },
  { id:'F2_MEET',     name:'Meeting Suite',  floor:'F2', pts:[[2,32],[33,32],[33,58],[2,58]],       height:FLOOR_H, baseColor:PAL.OFFICE_COOL, systems:['lighting','hvac','av'],      people:20, capacity:35 },
  { id:'F2_OFFR',     name:'Open Office',    floor:'F2', pts:[[57,5],[78,5],[78,40],[57,40]],       height:FLOOR_H, baseColor:PAL.CONC_LIGHT,  systems:['lighting','hvac','power'],   people:28, capacity:40 },
  { id:'F2_RES',      name:'Research Lab',   floor:'F2', pts:[[57,42],[78,42],[78,58],[57,58]],     height:FLOOR_H, baseColor:PAL.OFFICE_NEUT, systems:['lighting','hvac','power'],   people:15, capacity:20 },
  { id:'F2_BRIDGE',   name:'Sky Bridge',     floor:'F2', pts:[[37,51],[53,51],[53,58],[37,58]],     height:FLOOR_H, baseColor:PAL.CONC_MID,   systems:['lighting','access'],         people:3,  capacity:15 },
];
const F3_ROOMS: Room3D[] = [
  { id:'F3_CMD',      name:'Command Center', floor:'F3', pts:[[2,5],[33,5],[33,26],[2,26]],         height:FLOOR_H, baseColor:PAL.OFFICE_COOL, systems:['lighting','hvac','power','data'], people:18, capacity:25 },
  { id:'F3_EXEC',     name:'Executive Floor',floor:'F3', pts:[[2,28],[33,28],[33,58],[2,58]],        height:FLOOR_H, baseColor:PAL.OFFICE_WARM, systems:['lighting','hvac'],           people:8,  capacity:12 },
  { id:'F3_SRV',      name:'Server Room',    floor:'F3', pts:[[57,5],[78,5],[78,28],[57,28]],        height:FLOOR_H, baseColor:PAL.CONC_MID,   systems:['power','hvac','fire'],       people:2,  capacity:5  },
  { id:'F3_DATA',     name:'Data Center',    floor:'F3', pts:[[57,30],[78,30],[78,58],[57,58]],      height:FLOOR_H, baseColor:PAL.CONC_LIGHT,  systems:['power','hvac','fire'],       people:3,  capacity:8  },
  { id:'F3_TOPBR',    name:'Top Bridge',     floor:'F3', pts:[[37,51],[53,51],[53,58],[37,58]],      height:FLOOR_H, baseColor:PAL.CONC_MID,   systems:['lighting','access'],         people:2,  capacity:10 },
];
const ALL_ROOMS: Room3D[] = [...F1_ROOMS, ...F2_ROOMS, ...F3_ROOMS];

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────
export default function NestBuilding3D({
  selectedFloor,
  incidentSim,
  incidentStage,
  activeSystem: _activeSystem,
  walkMode = false,
  onRoomClick,
  onFloorClick,
}: Props) {
  const mountRef       = useRef<HTMLDivElement>(null);
  const sceneRef       = useRef<THREE.Scene | null>(null);
  const cameraRef      = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef    = useRef<THREE.WebGLRenderer | null>(null);
  const roomMeshesRef  = useRef<Map<string, THREE.Mesh>>(new Map());
  const tooltipRef     = useRef<THREE.Sprite | null>(null);
  const hoveredRef     = useRef<string | null>(null);
  const prevMouseRef   = useRef({ x: 0, y: 0 });

  // Walk-mode state
  const walkKeysRef    = useRef<Set<string>>(new Set());
  const walkYawRef     = useRef(0);   // horizontal look angle (radians)
  const walkPitchRef   = useRef(-0.08); // slight downward tilt
  const walkPointerRef = useRef(false); // pointer locked?
  const walkModeRef    = useRef(false);
  const camAngleRef    = useRef({ theta: Math.PI * 1.1, phi: 0.42 }); // south-west view, ~40° elevation
  const camDistRef     = useRef(95);
  const alertSpritesRef  = useRef<THREE.Sprite[]>([]);
  const incidentRoomsRef = useRef<Set<string>>(new Set());
  const blinkFrameRef    = useRef(0);
  const controlsRef      = useRef<OrbitControls | null>(null);
  const flyTargetRef     = useRef<{ camPos: THREE.Vector3; lookAt: THREE.Vector3 } | null>(null);

  // HTML alert popup state
  const [alertPopup, setAlertPopup] = useState<{ type: NonNullable<NestIncident>; rooms: string[] } | null>(null);

  // ── Camera ──────────────────────────────────────────────────────────────
  const CAM_CENTER = new THREE.Vector3(40, 5, 28);

  function updateCam(cam: THREE.PerspectiveCamera) {
    const { theta, phi } = camAngleRef.current;
    const d = camDistRef.current;
    cam.position.set(
      CAM_CENTER.x + d * Math.sin(theta) * Math.cos(phi),
      CAM_CENTER.y + d * Math.sin(phi),
      CAM_CENTER.z + d * Math.cos(theta) * Math.cos(phi),
    );
    cam.lookAt(CAM_CENTER);
  }

  // ── Scene init ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mountRef.current) return;
    const cont = mountRef.current;
    const w = cont.clientWidth, h = cont.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d1828);
    scene.fog = new THREE.Fog(0x0d1828, 160, 340);
    sceneRef.current = scene;

    const cam = new THREE.PerspectiveCamera(48, w / h, 0.5, 500);
    updateCam(cam);
    cameraRef.current = cam;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.75;
    cont.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // ── OrbitControls — full 360° orbit + smooth zoom + pan ─────────────
    const controls = new OrbitControls(cam, renderer.domElement);
    controls.target.set(CAM_CENTER.x, CAM_CENTER.y, CAM_CENTER.z);
    controls.enableDamping   = true;
    controls.dampingFactor   = 0.06;
    controls.minDistance     = 3;
    controls.maxDistance     = 220;
    controls.minPolarAngle   = 0;              // top-down view
    controls.maxPolarAngle   = Math.PI * 0.92; // almost from below
    controls.zoomSpeed       = 1.2;
    controls.rotateSpeed     = 0.8;
    controls.panSpeed        = 0.8;
    controls.enablePan       = true;
    controls.screenSpacePanning = true;
    controls.update();
    controlsRef.current = controls;

    addLighting(scene);
    buildBuilding(scene);
    addEnvironment(scene);

    // Tooltip (hidden initially)
    const tip = spawnTooltip('');
    tip.visible = false;
    scene.add(tip);
    tooltipRef.current = tip;

    let animId: number;
    const WALK_SPEED = 0.18; // metres per frame
    const loop = () => {
      animId = requestAnimationFrame(loop);
      // Blink incident rooms
      blinkFrameRef.current++;
      if (incidentRoomsRef.current.size > 0) {
        const blink = 0.22 + Math.abs(Math.sin(blinkFrameRef.current * 0.07)) * 0.65;
        incidentRoomsRef.current.forEach(id => {
          const mesh = roomMeshesRef.current.get(id);
          if (mesh) (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = blink;
        });
      }

      if (walkModeRef.current) {
        // ── Walk mode: WASD/arrow first-person movement ────────────────
        controls.enabled = false;
        const yaw   = walkYawRef.current;
        const pitch = walkPitchRef.current;
        // Forward direction (flat, no Y) from yaw
        const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
        const right   = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
        const keys    = walkKeysRef.current;
        const move    = new THREE.Vector3();
        if (keys.has('KeyW') || keys.has('ArrowUp'))    move.add(forward);
        if (keys.has('KeyS') || keys.has('ArrowDown'))  move.sub(forward);
        if (keys.has('KeyA') || keys.has('ArrowLeft'))  move.sub(right);
        if (keys.has('KeyD') || keys.has('ArrowRight')) move.add(right);
        if (move.lengthSq() > 0) {
          move.normalize().multiplyScalar(WALK_SPEED);
          cam.position.add(move);
          // Keep camera inside a broad boundary
          cam.position.x = Math.max(-20, Math.min(100, cam.position.x));
          cam.position.z = Math.max(-30, Math.min(75,  cam.position.z));
          cam.position.y = Math.max(1.5, Math.min(14,  cam.position.y));
        }
        // Apply yaw + pitch to camera look direction
        const lookTarget = cam.position.clone().add(
          new THREE.Vector3(
            -Math.sin(yaw) * Math.cos(pitch),
             Math.sin(pitch),
            -Math.cos(yaw) * Math.cos(pitch),
          )
        );
        cam.lookAt(lookTarget);
      } else {
        controls.enabled = true;
        controls.update();
        // Fly-to animation: lerp camera & target toward flyTargetRef
        const fly = flyTargetRef.current;
        if (fly && cam) {
          cam.position.lerp(fly.camPos, 0.05);
          controls.target.lerp(fly.lookAt, 0.05);
          if (cam.position.distanceTo(fly.camPos) < 0.5) flyTargetRef.current = null;
        }
      }

      renderer.render(scene, cam);
    };
    loop();

    const onResize = () => {
      const nw = cont.clientWidth, nh = cont.clientHeight;
      cam.aspect = nw / nh; cam.updateProjectionMatrix(); renderer.setSize(nw, nh);
    };
    window.addEventListener('resize', onResize);

    // ── Walk-mode: keyboard ───────────────────────────────────────────────
    const onKeyDown = (e: KeyboardEvent) => { walkKeysRef.current.add(e.code); };
    const onKeyUp   = (e: KeyboardEvent) => { walkKeysRef.current.delete(e.code); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup',   onKeyUp);

    // ── Walk-mode: pointer-lock mouse-look ────────────────────────────────
    const onMouseMovePointer = (e: MouseEvent) => {
      if (!walkModeRef.current || !document.pointerLockElement) return;
      const SENS = 0.0018;
      walkYawRef.current   -= e.movementX * SENS;
      walkPitchRef.current  = Math.max(-0.9, Math.min(0.9, walkPitchRef.current + e.movementY * SENS * -1));
    };
    const onPointerLockChange = () => {
      walkPointerRef.current = document.pointerLockElement === cont;
    };
    document.addEventListener('mousemove',         onMouseMovePointer);
    document.addEventListener('pointerlockchange', onPointerLockChange);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize',  onResize);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup',   onKeyUp);
      document.removeEventListener('mousemove',         onMouseMovePointer);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      if (document.pointerLockElement === cont) document.exitPointerLock();
      controls.dispose();
      renderer.dispose();
      if (cont.contains(renderer.domElement)) cont.removeChild(renderer.domElement);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sync walk mode ────────────────────────────────────────────────────────
  useEffect(() => {
    walkModeRef.current = walkMode;
    const cont = mountRef.current;
    const cam  = cameraRef.current;
    const controls = controlsRef.current;
    if (!cont || !cam || !controls) return;

    if (walkMode) {
      // Place camera inside the lobby at eye level, facing north into the building
      cam.position.set(17, 1.75, 3);
      walkYawRef.current   = 0;
      walkPitchRef.current = -0.06;
      controls.enabled = false;
      // Request pointer lock so mouse-drag = look
      cont.requestPointerLock?.();
    } else {
      // Restore orbit view
      if (document.pointerLockElement === cont) document.exitPointerLock();
      controls.enabled = true;
      cam.position.set(
        40 + 95 * Math.sin(Math.PI * 1.1) * Math.cos(0.42),
        5  + 95 * Math.sin(0.42),
        28 + 95 * Math.cos(Math.PI * 1.1) * Math.cos(0.42),
      );
      controls.target.set(40, 5, 28);
      controls.update();
    }
  }, [walkMode]);

  // ── Floor filter ─────────────────────────────────────────────────────────
  useEffect(() => {
    roomMeshesRef.current.forEach((mesh, id) => {
      const room = ALL_ROOMS.find(r => r.id === id);
      if (!room) return;
      const m = mesh.material as THREE.MeshStandardMaterial;
      m.opacity = (selectedFloor === null || room.floor === selectedFloor) ? 0.92 : 0.10;
      m.transparent = true;
    });
  }, [selectedFloor]);

  // ── Incident overlay + blinking alert sprites ──────────────────────────
  useEffect(() => {
    // Remove old 3D alert sprites
    alertSpritesRef.current.forEach(s => sceneRef.current?.remove(s));
    alertSpritesRef.current = [];
    incidentRoomsRef.current.clear();

    const affectedNames: string[] = [];
    let sumX = 0, sumZ = 0, sumFloorY = 0, count = 0;

    roomMeshesRef.current.forEach((mesh, id) => {
      const room = ALL_ROOMS.find(r => r.id === id);
      if (!room) return;
      const m = mesh.material as THREE.MeshStandardMaterial;
      // HVAC: no red room highlight — handled by the HVAC SOP panel instead
      if (incidentSim && incidentSim !== 'hvac' && room.systems.some(s => s === incidentSim)) {
        m.emissive.set(INC_COL[incidentSim]);
        m.emissiveIntensity = 0.5;
        incidentRoomsRef.current.add(id);
        affectedNames.push(room.name);
        const cx = room.pts.reduce((a, p) => a + p[0], 0) / room.pts.length;
        const cz = room.pts.reduce((a, p) => a + p[1], 0) / room.pts.length;
        sumX += cx; sumZ += cz;
        sumFloorY += FLOOR_Y[room.floor] + room.height;
        count++;
      } else {
        m.emissive.set(0x000000);
        m.emissiveIntensity = 0;
      }
    });

    if (incidentSim && incidentSim !== 'hvac' && count > 0) {
      // Single centered alert sprite
      const cx = sumX / count;
      const cz = sumZ / count;
      const topY = (sumFloorY / count) + 4;
      const alertSp = spawnAlertSprite(incidentSim);
      alertSp.position.set(cx, topY, cz);
      sceneRef.current?.add(alertSp);
      alertSpritesRef.current.push(alertSp);

      // Fly camera in to look at the incident cluster
      const lookAt = new THREE.Vector3(cx, sumFloorY / count - 1, cz);
      const offset = new THREE.Vector3(0, 12, 22); // offset behind & above
      flyTargetRef.current = { camPos: lookAt.clone().add(offset), lookAt };

      setAlertPopup({ type: incidentSim, rooms: affectedNames });
    } else {
      setAlertPopup(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentSim, incidentStage]);

  // ── HVAC 3D overlay (ducts, AHUs, FCUs) ──────────────────────────────────
  const hvacGroupRef = useRef<THREE.Group | null>(null);
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (hvacGroupRef.current) {
      scene.remove(hvacGroupRef.current);
      hvacGroupRef.current = null;
    }

    if (_activeSystem !== 'hvac') return;

    const group = new THREE.Group();
    hvacGroupRef.current = group;

    // ── Shared realistic materials ────────────────────────────────────────
    const mkMat = (color: number, emissive = 0x000000, emissiveInt = 0, rough = 0.35, metal = 0.65, opacity = 1.0) =>
      new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color(emissive), emissiveIntensity: emissiveInt,
        roughness: rough, metalness: metal, transparent: opacity < 1, opacity });

    const matAluPanel = mkMat(0x90a4ae, 0x000000, 0,   0.28, 0.75);          // aluminium panel
    const matAHU01    = mkMat(0xb71c1c, 0xaa2200, 0.4, 0.30, 0.60);          // AHU-01 housing — fault red
    const matAHU02    = mkMat(0x37474f, 0x000000, 0,   0.30, 0.70);          // AHU-02 housing — dark steel
    const matChiller  = mkMat(0x455a64, 0x000000, 0,   0.28, 0.72);          // chiller body
    const matCT_Fill  = mkMat(0x37474f, 0x000000, 0,   0.60, 0.20);          // cooling tower fill (plastic)
    const matCT_Basin = mkMat(0x263238, 0x000000, 0,   0.45, 0.40);          // basin concrete
    const matPumpBody = mkMat(0x546e7a, 0x000000, 0,   0.30, 0.75);          // pump casing
    const matPipe     = mkMat(0x78909c, 0x000000, 0,   0.25, 0.85);          // insulated pipe
    const matFaultPipe= mkMat(0xc62828, 0xff0000, 0.5, 0.30, 0.55);          // fault pipe — red glow
    const matLouvre   = mkMat(0x90a4ae, 0x000000, 0,   0.20, 0.90);          // louvre blades


    const F: Record<string, number> = { F1: FLOOR_Y.F1, F2: FLOOR_Y.F2, F3: FLOOR_Y.F3 };
    const roofY = F.F3 + FLOOR_H + 0.15;

    // ── Helper: realistic pipe run (thin cylinder) ─────────────────────────
    const addPipeRun = (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number,
      r: number, mat: THREE.Material) => {
      const path = new THREE.LineCurve3(new THREE.Vector3(x1,y1,z1), new THREE.Vector3(x2,y2,z2));
      const tube = new THREE.TubeGeometry(path, 4, r, 8, false);
      group.add(new THREE.Mesh(tube, mat));
    };

    // ── Helper: realistic AHU box with panels, flanges, louvres ──────────
    const addAHU = (x: number, y: number, z: number, fault: boolean) => {
      const mat = fault ? matAHU01 : matAHU02;
      const W = 5.6, H = 2.2, D = 2.8;
      // Main housing
      const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), mat);
      body.position.set(x, y, z); group.add(body);
      // Panel seam lines (horizontal)
      for (let s = -1; s <= 1; s++) {
        const seam = new THREE.Mesh(new THREE.BoxGeometry(W + 0.04, 0.05, D + 0.04), matLouvre);
        seam.position.set(x, y + s * 0.55, z); group.add(seam);
      }
      // Inlet louvre face (one end)
      for (let i = 0; i < 6; i++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, H * 0.7 / 6, D * 0.85), matLouvre);
        blade.position.set(x - W / 2 - 0.03, y - H * 0.35 / 2 + i * (H * 0.7 / 6) + H * 0.15, z);
        blade.rotation.z = 0.18; group.add(blade);
      }
      // Outlet plenum box (other end)
      const plenum = new THREE.Mesh(new THREE.BoxGeometry(0.7, H * 0.6, D * 0.8), matAluPanel);
      plenum.position.set(x + W / 2 + 0.35, y, z); group.add(plenum);
      // Inspection access panel (slightly recessed)
      const panel = new THREE.Mesh(new THREE.BoxGeometry(1.2, H * 0.55, 0.06), matAluPanel);
      panel.position.set(x, y, z + D / 2 + 0.03); group.add(panel);
      // Mounting feet
      [-1.8, 1.8].forEach(dx => {
        [-0.9, 0.9].forEach(dz => {
          const foot = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.3, 0.25), mkMat(0x263238));
          foot.position.set(x + dx, y - H / 2 - 0.15, z + dz); group.add(foot);
        });
      });
      // Fault beacon on top
      if (fault) {
        const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.3, 8),
          mkMat(0xff0000, 0xff0000, 1.2, 0.1, 0));
        beacon.position.set(x + W / 2 - 0.4, y + H / 2 + 0.15, z); group.add(beacon);
      }
    };

    // ── Helper: chiller unit (realistic rectangular centrifugal chiller) ───
    const addChiller = (x: number, y: number, z: number) => {
      // Main compressor barrel
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 4.5, 16), matChiller);
      barrel.rotation.z = Math.PI / 2;
      barrel.position.set(x, y + 0.9, z); group.add(barrel);
      // Evaporator shell (wider cylinder, below)
      const evap = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 3.2, 12), matAluPanel);
      evap.rotation.z = Math.PI / 2;
      evap.position.set(x, y + 0.3, z + 0.6); group.add(evap);
      // Condenser shell (front)
      const cond = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.65, 3.0, 12), matAluPanel);
      cond.rotation.z = Math.PI / 2;
      cond.position.set(x, y + 0.3, z - 0.7); group.add(cond);
      // Control panel box
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.2, 0.3),
        mkMat(0x37474f, 0x003388, 0.15, 0.4, 0.2));
      panel.position.set(x + 2.1, y + 0.9, z); group.add(panel);
      // Pipe connections (nozzles)
      [[0.4, -1.2], [-0.4, -1.2], [0.4, 1.3], [-0.4, 1.3]].forEach(([dy, dz]) => {
        addPipeRun(x - 1.8, y + dy, z + dz, x + 1.8, y + dy, z + dz, 0.12, matPipe);
      });
      // Skid base
      const skid = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.18, 2.2), mkMat(0x263238));
      skid.position.set(x, y - 0.09, z); group.add(skid);
    };

    // ── Helper: cooling tower (counter-flow induced-draft) ─────────────────
    const addCoolingTower = (x: number, z: number) => {
      const y = roofY;
      // Basin (concrete trough)
      const basin = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.5, 3.6), matCT_Basin);
      basin.position.set(x, y + 0.25, z); group.add(basin);
      // Fill media body (tapered frustum)
      const fill = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.7, 2.2, 12), matCT_Fill);
      fill.position.set(x, y + 1.6, z); group.add(fill);
      // Fan shroud top ring
      const shroud = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.12, 8, 24), matAluPanel);
      shroud.position.set(x, y + 2.85, z); group.add(shroud);
      // Fan blades (4-blade axial)
      for (let b = 0; b < 4; b++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 0.35),
          mkMat(0x546e7a, 0, 0, 0.3, 0.5));
        blade.rotation.y = (b * Math.PI) / 2;
        blade.position.set(x + Math.sin(b * Math.PI / 2) * 0.7, y + 2.8, z + Math.cos(b * Math.PI / 2) * 0.7);
        group.add(blade);
      }
      // Motor housing (top centre)
      const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.55, 10), matAluPanel);
      motor.position.set(x, y + 2.92, z); group.add(motor);
      // Inlet air louvres (side panels)
      [0, Math.PI / 2, Math.PI, -Math.PI / 2].forEach((angle, i) => {
        const panel = new THREE.Mesh(new THREE.BoxGeometry(i % 2 === 0 ? 3.4 : 0.06, 1.5, i % 2 === 0 ? 0.06 : 3.4),
          matLouvre);
        panel.position.set(x + Math.sin(angle) * 1.78, y + 1.35, z + Math.cos(angle) * 1.78);
        group.add(panel);
      });
    };

    // ── Helper: pump set (realistic centrifugal pump + motor) ─────────────
    const addPump = (x: number, y: number, z: number) => {
      // Volute casing (oblate hemisphere-ish)
      const volute = new THREE.Mesh(new THREE.SphereGeometry(0.38, 12, 8), matPumpBody);
      volute.scale.set(1.4, 0.9, 1.0);
      volute.position.set(x, y, z); group.add(volute);
      // Motor body (cylinder)
      const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.9, 10),
        mkMat(0x263238, 0, 0, 0.4, 0.3));
      motor.rotation.z = Math.PI / 2;
      motor.position.set(x + 0.7, y, z); group.add(motor);
      // Discharge nozzle (up)
      addPipeRun(x, y + 0.38, z, x, y + 0.9, z, 0.10, matPipe);
      // Suction nozzle (horizontal)
      addPipeRun(x - 0.55, y, z, x - 0.38, y, z, 0.12, matPipe);
      // Base plate
      const base = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 0.7), mkMat(0x263238));
      base.position.set(x + 0.3, y - 0.38, z); group.add(base);
    };

    // ═══════════════════════════════════════════════════════════════════════
    // BUILD HVAC EQUIPMENT
    // ═══════════════════════════════════════════════════════════════════════

    // ── Rooftop: Chillers ─────────────────────────────────────────────────
    addChiller(12, roofY + 0.9, 10);
    addChiller(22, roofY + 0.9, 10);

    // ── Rooftop: Cooling Towers ───────────────────────────────────────────
    addCoolingTower(35, 10);
    addCoolingTower(42, 10);

    // ── Rooftop: AHU-01 (fault only when incident active) ────────────────
    addAHU(60, roofY + 1.1, 8, incidentSim === 'hvac');

    // ── Rooftop: AHU-02 (Normal) ─────────────────────────────────────────
    addAHU(72, roofY + 1.1, 20, false);

    // ── Rooftop piping — CHW supply + return between chillers & AHUs ──────
    // CHW main header (horizontal run)
    addPipeRun(9, roofY + 0.4, 10, 58, roofY + 0.4, 10, 0.18, matPipe);     // supply header
    addPipeRun(9, roofY + 0.6, 10, 58, roofY + 0.6, 10, 0.16, matPipe);     // return header
    // Drop down to AHU-01 coil (fault pipe only when incident active)
    addPipeRun(58, roofY + 0.4, 10, 58, roofY + 0.4, 8.5, 0.14, incidentSim === 'hvac' ? matFaultPipe : matPipe);
    // Drop down to AHU-02 coil
    addPipeRun(58, roofY + 0.4, 10, 70, roofY + 0.4, 18, 0.14, matPipe);
    // CW condenser loop (orange-tinted pipe)
    const matCW = mkMat(0x8d6e63, 0, 0, 0.3, 0.6);
    addPipeRun(9, roofY + 0.8, 10, 32, roofY + 0.8, 10, 0.14, matCW);
    addPipeRun(32, roofY + 0.8, 10, 42, roofY + 0.8, 10, 0.14, matCW);

    // ── Basement: pump sets ───────────────────────────────────────────────
    const bY = -1.2; // just below ground slab
    addPump(10, bY, 18);    // CHW pump A
    addPump(13, bY, 18);    // CHW pump B (standby)
    addPump(10, bY, 22);    // CW pump A
    addPump(13, bY, 22);    // CW pump B (standby)

    // ── Ghost exterior shell so interior duct work is visible ─────────────
    type ShellSnapshot = { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; wasTransparent: boolean; origOpacity: number };
    const shelled: ShellSnapshot[] = [];
    scene.traverse(obj => {
      if (!(obj as THREE.Mesh).isMesh || !obj.userData.bldShell) return;
      const mesh = obj as THREE.Mesh;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (!mat || !('opacity' in mat)) return;
      shelled.push({ mesh, mat, wasTransparent: mat.transparent, origOpacity: mat.opacity });
      mat.transparent = true;
      mat.opacity = 0.10;
    });

    scene.add(group);

    return () => {
      scene.remove(group);
      hvacGroupRef.current = null;
      shelled.forEach(({ mat, wasTransparent, origOpacity }) => {
        mat.transparent = wasTransparent;
        mat.opacity = origOpacity;
      });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_activeSystem, incidentSim]);

  // ─────────────────────────────────────────────────────────────────────────
  // LIGHTING
  // ─────────────────────────────────────────────────────────────────────────
  function addLighting(scene: THREE.Scene) {
    // Strong ambient so nothing goes black
    scene.add(new THREE.AmbientLight(0xc8ddf0, 1.6));

    // Key sun — from south-east above, lights the front + right faces
    const sun = new THREE.DirectionalLight(0xfffbe8, 2.4);
    sun.position.set(60, 110, -40);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left:-100, right:140, top:110, bottom:-70, near:5, far:280 });
    scene.add(sun);

    // Fill from south-west — lights left wing & courtyard opening
    const fill = new THREE.DirectionalLight(0xd0e4ff, 1.2);
    fill.position.set(-40, 60, -50);
    scene.add(fill);

    // Sky/ground gradient
    scene.add(new THREE.HemisphereLight(0x88c0e0, 0x2a4030, 1.0));

    // Soft front bounce — illuminates south facades from viewer side
    const bounce = new THREE.PointLight(0xa0c0e0, 1.0, 180);
    bounce.position.set(40, 20, -60);
    scene.add(bounce);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BUILD BUILDING
  // ─────────────────────────────────────────────────────────────────────────
  function buildBuilding(scene: THREE.Scene) {
    addBuildingMass(scene);   // solid U-shape — primary visible element
    addFloorSlabs(scene);
    addSolidShell(scene);
    addCurtainWall(scene);
    addCurvedSECorner(scene);
    addColumns(scene);
    addRooms(scene);
    addRoomInteriors(scene);
    addCeilingHVAC(scene, incidentSim === 'hvac');
    addEntrances(scene);
    addRoofDetails(scene);
  }

  // ── Solid building mass (primary exterior shell) ────────────────────────
  function addBuildingMass(scene: THREE.Scene) {
    const geo = new THREE.ExtrudeGeometry(makeUShape(), { depth: TOT_H, bevelEnabled: false });
    const mat = new THREE.MeshStandardMaterial({
      color: PAL.EXTERIOR,
      roughness: 0.22,
      metalness: 0.42,
      envMapIntensity: 0.6,
      side: THREE.DoubleSide,
    });
    const mass = new THREE.Mesh(geo, mat);
    // rotation.x = +PI/2 maps shape Y → world +Z (south=0, north=60)
    // extrusion depth maps to world -Y; offset position.y=TOT_H so base=0, top=TOT_H
    mass.rotation.x = Math.PI / 2;
    mass.position.set(0, TOT_H, 0);
    mass.castShadow = true;
    mass.receiveShadow = true;
    mass.userData.bldShell = true;
    scene.add(mass);

    // Horizontal floor-line bands — white stripe at each slab edge
    const bandMat = new THREE.MeshStandardMaterial({ color: PAL.CONC_LIGHT, roughness: 0.3, metalness: 0.4, side: THREE.DoubleSide });
    for (let i = 0; i <= N_FLOORS; i++) {
      const band = new THREE.Mesh(new THREE.ShapeGeometry(makeUShape()), bandMat.clone());
      band.rotation.x = Math.PI / 2;
      band.position.y = i * FLOOR_H + 0.01;
      band.userData.bldShell = true;
      scene.add(band);
    }
  }

  // ── U-shape helper ──────────────────────────────────────────────────────
  function makeUShape(): THREE.Shape {
    // U = left wing + back connector + right wing; open at south (Z=0)
    // SE corner of right wing is a quarter-circle, radius CR
    const s = new THREE.Shape();
    s.moveTo(LW_X0, 0);
    s.lineTo(LW_X1, 0);         // left wing south
    s.lineTo(LW_X1, CTY_D);     // left inner courtyard bottom
    s.lineTo(LW_X1, BD);        // left wing north
    s.lineTo(RW_X0, BD);        // connector north
    s.lineTo(RW_X1, BD);        // right wing NE
    s.lineTo(RW_X1, CR);        // right wing east wall down to curve start
    // Quarter-circle SE corner: centre = (RW_X1-CR, CR), sweeping east→south
    const arcCX = RW_X1 - CR, arcCZ = CR;
    const arcSegs = 14;
    for (let i = arcSegs; i >= 0; i--) {
      const a = (i / arcSegs) * (Math.PI / 2); // π/2 → 0
      s.lineTo(arcCX + CR * Math.cos(a), arcCZ - CR * Math.sin(a));
    }
    s.lineTo(RW_X0, 0);         // right wing south-west
    s.lineTo(RW_X0, CTY_D);     // right inner courtyard bottom
    s.lineTo(LW_X1, CTY_D);     // courtyard back edge
    s.lineTo(LW_X0, CTY_D);
    s.lineTo(LW_X0, 0);
    return s;
  }

  // ── Floor slabs ──────────────────────────────────────────────────────────
  function addFloorSlabs(scene: THREE.Scene) {
    // Interior floor surface — slightly lighter than exterior
    const slabMat = new THREE.MeshStandardMaterial({ color: 0x3e4e62, roughness: 0.85, metalness: 0.08, side: THREE.DoubleSide });
    ALL_FLOORS.forEach((fl, i) => {
      const y = FLOOR_Y[fl];
      const slab = new THREE.Mesh(new THREE.ShapeGeometry(makeUShape()), slabMat.clone());
      slab.rotation.x = Math.PI / 2;
      slab.position.y = y + 0.02;
      slab.receiveShadow = true;
      scene.add(slab);
      const lbl = spawnLabel(`F${i + 1}`, '#00e5ff', 0.7, 0.9);
      lbl.position.set(17, y + 0.5, -1.5);
      scene.add(lbl);
    });
    // Roof slab
    const roof = new THREE.Mesh(new THREE.ShapeGeometry(makeUShape()),
      new THREE.MeshStandardMaterial({ color: 0x28364a, roughness: 0.9, metalness: 0.05, side: THREE.DoubleSide }));
    roof.rotation.x = Math.PI / 2;
    roof.position.y = TOT_H + 0.18;
    roof.receiveShadow = true;
    scene.add(roof);
  }

  // ── Solid back + side walls (concrete cladding panels) ──────────────────
  function addSolidShell(scene: THREE.Scene) {
    const panMat = new THREE.MeshStandardMaterial({
      color: PAL.CONC_LIGHT, roughness: 0.40, metalness: 0.20,
    });
    const spMat = new THREE.MeshStandardMaterial({
      color: PAL.SPANDREL, roughness: 0.22, metalness: 0.68,
    });

    const panel = (w: number, h: number, d: number, x: number, y: number, z: number, ry = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), panMat.clone());
      m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = true;
      m.userData.bldShell = true; scene.add(m);
    };
    const spandrel = (w: number, d: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.45, d), spMat.clone());
      m.position.set(x, y, z); m.userData.bldShell = true; scene.add(m);
    };

    const wh = TOT_H;
    // Left wing — west wall
    panel(0.35, wh, BD, LW_X0, wh / 2, BD / 2);
    // Left wing — north wall
    panel(LW_X1 - LW_X0, wh, 0.35, (LW_X0 + LW_X1) / 2, wh / 2, BD);
    // Connector — north wall
    panel(RW_X0 - LW_X1, wh, 0.35, (LW_X1 + RW_X0) / 2, wh / 2, BD);
    // Right wing — north wall
    panel(RW_X1 - RW_X0, wh, 0.35, (RW_X0 + RW_X1) / 2, wh / 2, BD);
    // Right wing — east wall (above curve)
    panel(0.35, wh, BD - CR, RW_X1, wh / 2, CR + (BD - CR) / 2);

    // Horizontal spandrel bands at each floor on solid walls
    for (let i = 0; i <= N_FLOORS; i++) {
      const fy = i * FLOOR_H;
      spandrel(0.38, BD, LW_X0, fy, BD / 2);  // west
      spandrel(LW_X1 - LW_X0, 0.38, (LW_X0 + LW_X1) / 2, fy, BD); // left north
      spandrel(RW_X0 - LW_X1, 0.38, (LW_X1 + RW_X0) / 2, fy, BD); // connector north
      spandrel(RW_X1 - RW_X0, 0.38, (RW_X0 + RW_X1) / 2, fy, BD); // right north
      spandrel(0.38, BD - CR, RW_X1, fy, CR + (BD - CR) / 2);       // east
    }
  }

  // ── Glass curtain wall (south + inner courtyard faces) ──────────────────
  function addCurtainWall(scene: THREE.Scene) {
    const gW = 2.5, gH = FLOOR_H - 0.5, spH = 0.45;

    const glassMat  = () => new THREE.MeshPhysicalMaterial({
      color: PAL.GLASS, roughness: 0.03, metalness: 0.0,
      transparent: true, opacity: 0.38,
      transmission: 0.72, thickness: 0.6, reflectivity: 0.94, ior: 1.52,
      side: THREE.DoubleSide,
    });
    const spMat = () => new THREE.MeshStandardMaterial({
      color: PAL.SPANDREL, roughness: 0.22, metalness: 0.68,
    });
    const mulMat = new THREE.MeshStandardMaterial({
      color: PAL.MULLION, roughness: 0.12, metalness: 0.88,
    });

    // axis='x': wall runs along X at constant Z
    // axis='z': wall runs along Z at constant X
    const strip = (a0: number, a1: number, fixed: number, axis: 'x' | 'z', rotY: number) => {
      const len = Math.abs(a1 - a0);
      const n = Math.max(1, Math.floor(len / gW));
      const pw = len / n;
      for (let fl = 0; fl < N_FLOORS; fl++) {
        const fy = fl * FLOOR_H;
        for (let c = 0; c < n; c++) {
          const t  = (c + 0.5) / n;
          const v  = a0 + t * (a1 - a0);
          const px = axis === 'x' ? v : fixed;
          const pz = axis === 'z' ? v : fixed;
          // glass
          const g = new THREE.Mesh(new THREE.PlaneGeometry(pw - 0.06, gH), glassMat());
          g.position.set(px, fy + spH + gH / 2, pz); g.rotation.y = rotY; scene.add(g);
          // spandrel
          const sp = new THREE.Mesh(new THREE.PlaneGeometry(pw - 0.06, spH), spMat());
          sp.position.set(px, fy + spH / 2, pz); sp.rotation.y = rotY; scene.add(sp);
        }
        // transom
        const txGeo = new THREE.BoxGeometry(
          axis === 'x' ? len : 0.06, 0.06, axis === 'z' ? len : 0.06
        );
        const tx = new THREE.Mesh(txGeo, mulMat.clone());
        tx.position.set(
          axis === 'x' ? (a0 + a1) / 2 : fixed,
          fl * FLOOR_H + spH,
          axis === 'z' ? (a0 + a1) / 2 : fixed,
        );
        scene.add(tx);
      }
      // vertical mullions
      for (let c = 0; c <= n; c++) {
        const v  = a0 + (c / n) * (a1 - a0);
        const mx = axis === 'x' ? v : fixed;
        const mz = axis === 'z' ? v : fixed;
        const mul = new THREE.Mesh(new THREE.BoxGeometry(0.07, TOT_H, 0.07), mulMat.clone());
        mul.position.set(mx, TOT_H / 2, mz);
        scene.add(mul);
      }
    };

    // Left wing south
    strip(LW_X0, LW_X1, 0, 'x', 0);
    // Left wing east (inner courtyard face)
    strip(0, CTY_D, LW_X1, 'z', Math.PI / 2);
    // Right wing south (straight section — curve handled separately)
    strip(RW_X0, RW_X1 - CR, 0, 'x', 0);
    // Right wing west (inner courtyard face)
    strip(0, CTY_D, RW_X0, 'z', Math.PI / 2);
    // Back connector inner face (courtyard back wall)
    strip(LW_X1, RW_X0, CTY_D, 'x', 0);
  }

  // ── Curved SE corner glass panels ────────────────────────────────────────
  function addCurvedSECorner(scene: THREE.Scene) {
    const SEGS = 16;
    const arcCX = RW_X1 - CR, arcCZ = CR;
    const spH = 0.45, gH = FLOOR_H - 0.5;

    const glassMat  = () => new THREE.MeshPhysicalMaterial({
      color: PAL.GLASS, roughness: 0.03, metalness: 0.0,
      transparent: true, opacity: 0.38,
      transmission: 0.72, thickness: 0.6, reflectivity: 0.94, ior: 1.52,
      side: THREE.DoubleSide,
    });
    const spMat = new THREE.MeshStandardMaterial({ color: PAL.SPANDREL, roughness: 0.22, metalness: 0.68 });
    const mulMat = new THREE.MeshStandardMaterial({ color: PAL.MULLION, roughness: 0.12, metalness: 0.88 });

    for (let fl = 0; fl < N_FLOORS; fl++) {
      const fy = fl * FLOOR_H;
      for (let s = 0; s < SEGS; s++) {
        const a1 = (s / SEGS) * (Math.PI / 2);
        const a2 = ((s + 1) / SEGS) * (Math.PI / 2);
        const x1 = arcCX + CR * Math.cos(a1), z1 = arcCZ - CR * Math.sin(a1);
        const x2 = arcCX + CR * Math.cos(a2), z2 = arcCZ - CR * Math.sin(a2);
        const segLen = Math.sqrt((x2 - x1) ** 2 + (z2 - z1) ** 2);
        const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
        const fAngle = Math.atan2(mz - arcCZ, mx - arcCX);
        const ry = -(fAngle + Math.PI / 2);

        const g = new THREE.Mesh(new THREE.PlaneGeometry(segLen, gH), glassMat());
        g.position.set(mx, fy + spH + gH / 2, mz); g.rotation.y = ry; scene.add(g);

        const sp = new THREE.Mesh(new THREE.PlaneGeometry(segLen, spH), spMat.clone());
        sp.position.set(mx, fy + spH / 2, mz); sp.rotation.y = ry; scene.add(sp);
      }
      // Mullions at arc vertices
      for (let s = 0; s <= SEGS; s++) {
        const a = (s / SEGS) * (Math.PI / 2);
        const mx = arcCX + CR * Math.cos(a), mz = arcCZ - CR * Math.sin(a);
        const mul = new THREE.Mesh(new THREE.BoxGeometry(0.07, FLOOR_H, 0.07), mulMat.clone());
        mul.position.set(mx, fy + FLOOR_H / 2, mz);
        scene.add(mul);
      }
    }
  }

  // ── Structural columns ───────────────────────────────────────────────────
  function addColumns(scene: THREE.Scene) {
    const colMat = new THREE.MeshStandardMaterial({ color: 0xc8d2de, roughness: 0.28, metalness: 0.62 });
    const colGeo = new THREE.BoxGeometry(0.6, TOT_H, 0.6);
    ([
      [LW_X0, 0],[LW_X1, 0],[LW_X0, BD],[LW_X1, BD],
      [LW_X0, BD / 2],[LW_X1, BD / 2],
      [LW_X0, BD * 0.25],[LW_X0, BD * 0.75],
      [RW_X0, 0],[RW_X0, BD],[RW_X1, BD],
      [RW_X0, BD / 2],[RW_X1, BD / 2],
      [(LW_X1 + RW_X0) / 2, BD],
    ] as [number, number][]).forEach(([x, z]) => {
      const col = new THREE.Mesh(colGeo.clone(), colMat.clone());
      col.position.set(x, TOT_H / 2, z); col.castShadow = true; scene.add(col);
    });
  }

  // ── Room interior meshes (interactive) ───────────────────────────────────
  function addRooms(scene: THREE.Scene) {
    roomMeshesRef.current.clear();
    ALL_ROOMS.forEach((room) => {
      const y = FLOOR_Y[room.floor];
      // rotation.x = -PI/2 maps shape Y → world -Z.
      // We store pts as [worldX, worldZ], so use (BD - pz) for shape Y
      // then offset position.z = BD so world Z = BD - (BD - pz) = pz  ✓
      const shape = new THREE.Shape();
      room.pts.forEach(([px, pz], i) => {
        if (i === 0) shape.moveTo(px, BD - pz); else shape.lineTo(px, BD - pz);
      });
      shape.closePath();

      const geo = new THREE.ExtrudeGeometry(shape, { depth: room.height - SLAB_H, bevelEnabled: false });
      const mat = new THREE.MeshStandardMaterial({
        color: room.baseColor,
        roughness: 0.65, metalness: 0.08,
        transparent: true, opacity: 0.92,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(0, y + SLAB_H, BD);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.userData = { roomId: room.id, floor: room.floor, roomName: room.name };
      scene.add(mesh);
      roomMeshesRef.current.set(room.id, mesh);

      // Ceiling tile strip (subtle functional colour accent, top face only)
      const cGeo = new THREE.ShapeGeometry(shape);
      const cMat = new THREE.MeshStandardMaterial({
        color: room.baseColor,
        emissive: new THREE.Color(room.baseColor).multiplyScalar(0.25),
        emissiveIntensity: 0.18, roughness: 0.5, metalness: 0.1,
      });
      const ceil = new THREE.Mesh(cGeo, cMat);
      ceil.rotation.x = -Math.PI / 2;
      ceil.position.set(0, y + room.height - 0.1, BD);
      scene.add(ceil);

      // Room label — world Z = pz (unchanged, sprite positioned directly)
      const cx = room.pts.reduce((a, p) => a + p[0], 0) / room.pts.length;
      const cz = room.pts.reduce((a, p) => a + p[1], 0) / room.pts.length;
      const lbl = spawnLabel(room.name, 'rgba(220,228,255,0.9)', 0.44, 0.62);
      lbl.position.set(cx, y + room.height * 0.55, cz);
      scene.add(lbl);
    });
  }

  // ── Room interiors ────────────────────────────────────────────────────────
  function addRoomInteriors(scene: THREE.Scene) {
    const desk   = new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.72, metalness: 0.12 });
    const chair  = new THREE.MeshStandardMaterial({ color: 0x2a3a4e, roughness: 0.68, metalness: 0.18 });
    const screen = new THREE.MeshStandardMaterial({ color: 0x0a1a2e, roughness: 0.15, metalness: 0.7,
                                                    emissive: new THREE.Color(0x1a90ff), emissiveIntensity: 0.35 });
    const metal  = new THREE.MeshStandardMaterial({ color: 0x607080, roughness: 0.38, metalness: 0.82 });
    const server = new THREE.MeshStandardMaterial({ color: 0x1a2432, roughness: 0.28, metalness: 0.86,
                                                    emissive: new THREE.Color(0x003366), emissiveIntensity: 0.22 });
    const plant  = new THREE.MeshStandardMaterial({ color: 0x2d5a22, roughness: 0.9 });
    const white  = new THREE.MeshStandardMaterial({ color: 0xe8eef4, roughness: 0.55, metalness: 0.08 });
    const sofa   = new THREE.MeshStandardMaterial({ color: 0x4a5568, roughness: 0.78, metalness: 0.08 });

    const add = (geo: THREE.BufferGeometry, mat: THREE.Material,
                 x: number, y: number, z: number, ry = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.y = ry;
      m.castShadow = true;
      m.receiveShadow = true;
      scene.add(m);
    };

    // ── F1 LOBBY  (X 2–16, Z 5–20) ─────────────────────────────────────────
    const lobbyY = FLOOR_Y.F1 + SLAB_H;
    add(new THREE.BoxGeometry(8, 1.1, 1.4),   desk,  9,    lobbyY + 0.55,  7.5);
    add(new THREE.BoxGeometry(8, 0.06, 1.5),  white, 9,    lobbyY + 1.13,  7.5);
    add(new THREE.BoxGeometry(1.4, 0.9, 0.08), screen, 10.5, lobbyY + 1.65,  7.5);
    add(new THREE.BoxGeometry(5, 0.42, 1.8),  sofa,  7,    lobbyY + 0.21, 16.0);
    add(new THREE.BoxGeometry(5, 0.72, 0.3),  sofa,  7,    lobbyY + 0.36, 17.1);
    add(new THREE.BoxGeometry(1.8, 0.42, 1.8), sofa, 4,   lobbyY + 0.21, 16.0);
    add(new THREE.BoxGeometry(2.4, 0.06, 1.2), white, 7,  lobbyY + 0.52, 14.5);
    add(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 6), metal, 6.2, lobbyY + 0.25, 14.5);
    add(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 6), metal, 8.2, lobbyY + 0.25, 14.5);
    add(new THREE.CylinderGeometry(0.35, 0.28, 0.7, 8), plant, 14.5, lobbyY + 0.35,  6.5);
    add(new THREE.SphereGeometry(0.6, 7, 5), plant, 14.5, lobbyY + 1.35,  6.5);

    // ── F1 CAFETERIA  (X 18–33, Z 5–20) ────────────────────────────────────
    const cafeY = FLOOR_Y.F1 + SLAB_H;
    const cafeTables: [number, number][] = [[22,8],[27,8],[22,13],[27,13],[22,17],[27,17]];
    cafeTables.forEach(([tx, tz]) => {
      add(new THREE.CylinderGeometry(1.0, 1.0, 0.07, 12), white, tx, cafeY + 0.78, tz);
      add(new THREE.CylinderGeometry(0.06, 0.06, 0.76, 6), metal, tx, cafeY + 0.38, tz);
      const offsets: [number, number][] = [[1.4, 0], [0, 1.4], [-1.4, 0], [0, -1.4]];
      offsets.forEach(([dx, dz]) => {
        add(new THREE.BoxGeometry(0.7, 0.08, 0.7), chair, tx + dx, cafeY + 0.46, tz + dz);
        add(new THREE.BoxGeometry(0.7, 0.62, 0.08), chair, tx + dx, cafeY + 0.78,
            tz + (dz < 0 ? dz - 0.31 : dz + 0.31));
      });
    });
    add(new THREE.BoxGeometry(12, 1.0, 1.0), desk,  25.5, cafeY + 0.50, 19.5);
    add(new THREE.BoxGeometry(12, 0.06, 1.1), white, 25.5, cafeY + 1.03, 19.5);

    // ── F1 TRAINING ROOM  (X 2–33, Z 22–36) ────────────────────────────────
    const trainY = FLOOR_Y.F1 + SLAB_H;
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 5; col++) {
        const dx = 4 + col * 5.5;
        const dz = 24 + row * 3.0;
        add(new THREE.BoxGeometry(4.5, 0.07, 1.2),  desk,   dx,  trainY + 0.78, dz);
        add(new THREE.BoxGeometry(0.1, 0.76, 0.1),  metal,  dx - 1.8, trainY + 0.38, dz + 0.4);
        add(new THREE.BoxGeometry(0.1, 0.76, 0.1),  metal,  dx + 1.8, trainY + 0.38, dz + 0.4);
        add(new THREE.BoxGeometry(4.0, 0.08, 0.9),  chair,  dx,  trainY + 0.46, dz + 1.0);
        add(new THREE.BoxGeometry(1.2, 0.76, 0.06), screen, dx,  trainY + 1.22, dz - 0.6);
      }
    }
    add(new THREE.BoxGeometry(1.4, 1.0, 0.9),  desk,  17.5, trainY + 0.5, 22.5);
    add(new THREE.BoxGeometry(8,   2.4, 0.08), white, 17.5, trainY + 1.6, 22.2);

    // ── F1 INNOVATION LAB  (X 2–33, Z 38–58) ───────────────────────────────
    const labY = FLOOR_Y.F1 + SLAB_H;
    add(new THREE.BoxGeometry(28, 0.07, 1.2), desk, 17.5, labY + 0.92, 39.5);
    add(new THREE.BoxGeometry(28, 0.07, 1.2), desk, 17.5, labY + 0.92, 57.5);
    for (let i = 0; i < 5; i++) {
      add(new THREE.BoxGeometry(1.4, 0.8, 0.9), metal, 5 + i * 5.5, labY + 1.32, 39.5);
      add(new THREE.BoxGeometry(0.9, 0.5, 0.06), screen, 5 + i * 5.5, labY + 1.55, 39.1);
    }
    add(new THREE.BoxGeometry(10, 0.08, 4), white, 17.5, labY + 0.82, 48);
    for (let i = 0; i < 3; i++) {
      add(new THREE.BoxGeometry(2.8, 0.42, 1.1), sofa, 9 + i * 5, labY + 0.21, 45.5);
      add(new THREE.BoxGeometry(2.8, 0.42, 1.1), sofa, 9 + i * 5, labY + 0.21, 50.5);
    }

    // ── F1 DEMO CENTER  (X 57–78, Z 5–28) ──────────────────────────────────
    const demoY = FLOOR_Y.F1 + SLAB_H;
    const plinths: [number, number][] = [[60,8],[65,8],[70,8],[75,8],[60,15],[67,15],[74,15]];
    plinths.forEach(([px, pz]) => {
      add(new THREE.BoxGeometry(2.2, 1.0, 2.2), white, px, demoY + 0.50, pz);
      add(new THREE.BoxGeometry(1.8, 0.06, 1.8), metal, px, demoY + 1.03, pz);
      add(new THREE.BoxGeometry(1.0, 0.5,  0.8), metal, px, demoY + 1.28, pz);
    });
    for (let i = 0; i < 5; i++) {
      add(new THREE.BoxGeometry(1.6, 0.42, 1.4), sofa, 59 + i * 3.8, demoY + 0.21, 23);
    }
    add(new THREE.BoxGeometry(10, 3.0, 0.1), screen, 67.5, demoY + 2.2, 5.5);

    // ── F1 WORKSHOP  (X 57–78, Z 30–58) ────────────────────────────────────
    const workY = FLOOR_Y.F1 + SLAB_H;
    for (let row = 0; row < 2; row++) {
      const wz = 33 + row * 11;
      add(new THREE.BoxGeometry(18, 0.1, 2.0), desk, 67.5, workY + 0.96, wz);
      add(new THREE.BoxGeometry(18, 1.6, 0.06), metal, 67.5, workY + 2.0, wz - 1.1);
      for (let c = 0; c < 4; c++) {
        add(new THREE.BoxGeometry(2.0, 0.5, 1.4), metal, 59 + c * 5.8, workY + 1.21, wz);
      }
    }
    add(new THREE.CylinderGeometry(0.3, 0.4, 1.5, 8), metal, 67.5, workY + 0.75, 44);
    add(new THREE.BoxGeometry(1.2, 0.4, 1.2),           metal, 67.5, workY + 1.7,  44);
    add(new THREE.CylinderGeometry(0.08, 0.08, 0.8, 6), metal, 67.5, workY + 2.1,  44);
    for (let sh = 0; sh < 3; sh++) {
      add(new THREE.BoxGeometry(0.06, 2.4, 10), metal, 77.8, workY + 1.2,  38 + sh * 8);
      add(new THREE.BoxGeometry(0.06, 0.06, 10), white, 77.8, workY + 0.7,  38 + sh * 8);
      add(new THREE.BoxGeometry(0.06, 0.06, 10), white, 77.8, workY + 1.4,  38 + sh * 8);
      add(new THREE.BoxGeometry(0.06, 0.06, 10), white, 77.8, workY + 2.1,  38 + sh * 8);
    }

    // ── F2 OPEN OFFICE LEFT  (X 2–33, Z 5–30) ──────────────────────────────
    const offLY = FLOOR_Y.F2 + SLAB_H;
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 3; col++) {
        const dx = 5 + col * 10;
        const dz = 7 + row * 5.5;
        add(new THREE.BoxGeometry(4.5, 0.07, 1.4),  desk,   dx,       offLY + 0.78, dz);
        add(new THREE.BoxGeometry(1.4, 0.07, 2.2),  desk,   dx + 1.7, offLY + 0.78, dz + 1.4);
        add(new THREE.BoxGeometry(4.5, 1.1, 0.05),  metal,  dx,       offLY + 1.3,  dz - 0.72);
        add(new THREE.BoxGeometry(1.4, 0.82, 0.06), screen, dx,       offLY + 1.25, dz - 0.2);
        add(new THREE.BoxGeometry(1.0, 0.08, 1.0),  chair,  dx,       offLY + 0.46, dz + 0.8);
        add(new THREE.BoxGeometry(1.0, 0.62, 0.08), chair,  dx,       offLY + 0.78, dz + 1.38);
      }
    }
    add(new THREE.CylinderGeometry(2.5, 2.5, 0.07, 16), white, 17, offLY + 0.82, 26);
    add(new THREE.CylinderGeometry(0.08, 0.08, 0.78, 6), metal, 17, offLY + 0.39, 26);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      add(new THREE.BoxGeometry(0.7, 0.08, 0.7), chair,
          17 + Math.cos(a) * 1.8, offLY + 0.46, 26 + Math.sin(a) * 1.8);
    }

    // ── F2 MEETING SUITE  (X 2–33, Z 32–58) ────────────────────────────────
    const meetY = FLOOR_Y.F2 + SLAB_H;
    add(new THREE.BoxGeometry(16, 0.09, 5), desk,  17.5, meetY + 0.78, 45);
    add(new THREE.CylinderGeometry(0.12, 0.12, 0.76, 6), metal, 12, meetY + 0.38, 45);
    add(new THREE.CylinderGeometry(0.12, 0.12, 0.76, 6), metal, 23, meetY + 0.38, 45);
    for (let i = 0; i < 6; i++) {
      add(new THREE.BoxGeometry(1.2, 0.08, 1.0), chair, 8 + i * 3.4, meetY + 0.46, 43.5);
      add(new THREE.BoxGeometry(1.2, 0.08, 1.0), chair, 8 + i * 3.4, meetY + 0.46, 46.5);
    }
    add(new THREE.BoxGeometry(8, 2.8, 0.1), screen, 17.5, meetY + 2.2, 32.5);
    add(new THREE.BoxGeometry(0.06, 2.8, 8), metal, 24, meetY + 1.4, 53);
    add(new THREE.BoxGeometry(5, 0.08, 3.2), white, 28, meetY + 0.78, 54);
    for (let i = 0; i < 4; i++) {
      add(new THREE.BoxGeometry(1.0, 0.08, 1.0), chair, 25.5 + i * 1.8, meetY + 0.46, 54);
    }

    // ── F2 OPEN OFFICE RIGHT  (X 57–78, Z 5–40) ────────────────────────────
    const offRY = FLOOR_Y.F2 + SLAB_H;
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 3; col++) {
        const dx = 59 + col * 6.5;
        const dz = 7 + row * 6;
        add(new THREE.BoxGeometry(5.5, 0.07, 1.4),  desk,   dx,  offRY + 0.78, dz);
        add(new THREE.BoxGeometry(5.5, 1.0, 0.05),  metal,  dx,  offRY + 1.28, dz - 0.72);
        add(new THREE.BoxGeometry(1.4, 0.82, 0.06), screen, dx,  offRY + 1.25, dz - 0.2);
        add(new THREE.BoxGeometry(1.0, 0.08, 1.0),  chair,  dx,  offRY + 0.46, dz + 0.8);
      }
    }

    // ── F2 RESEARCH LAB  (X 57–78, Z 42–58) ────────────────────────────────
    const resY = FLOOR_Y.F2 + SLAB_H;
    add(new THREE.BoxGeometry(18, 0.08, 1.6), desk, 67.5, resY + 0.92, 43.5);
    add(new THREE.BoxGeometry(18, 0.08, 1.6), desk, 67.5, resY + 0.92, 57.5);
    for (let i = 0; i < 5; i++) {
      add(new THREE.BoxGeometry(1.8, 0.6, 1.2),  metal,  59 + i * 4.5, resY + 1.22, 43.5);
      add(new THREE.BoxGeometry(1.8, 0.5, 1.2),  metal,  59 + i * 4.5, resY + 1.22, 57.5);
      add(new THREE.BoxGeometry(1.4, 0.82, 0.06), screen, 59 + i * 4.5, resY + 1.72, 43.1);
    }
    add(new THREE.BoxGeometry(8, 0.08, 3.5), white, 67.5, resY + 0.92, 50);
    for (let i = 0; i < 4; i++) {
      add(new THREE.BoxGeometry(0.9, 0.08, 1.0), chair, 62 + i * 3.5, resY + 0.46, 48);
    }

    // ── F3 COMMAND CENTER  (X 2–33, Z 5–26) ────────────────────────────────
    const cmdY = FLOOR_Y.F3 + SLAB_H;
    for (let i = 0; i < 7; i++) {
      const angle = (i / 6) * Math.PI * 0.7 - Math.PI * 0.35;
      const r = 8;
      const cx3 = 17.5 + Math.sin(angle) * r;
      const cz3 = 13   - Math.cos(angle) * r;
      add(new THREE.BoxGeometry(2.8, 0.09, 1.2), desk,   cx3, cmdY + 0.78, cz3, angle);
      add(new THREE.BoxGeometry(1.1, 0.7, 0.06), screen, cx3 - 0.4, cmdY + 1.28, cz3 - 0.55, angle);
      add(new THREE.BoxGeometry(1.1, 0.7, 0.06), screen, cx3 + 0.4, cmdY + 1.28, cz3 - 0.55, angle);
      add(new THREE.BoxGeometry(0.9, 0.08, 0.9), chair, cx3, cmdY + 0.46, cz3 + 0.65, angle);
    }
    add(new THREE.BoxGeometry(28, 3.2, 0.14), screen, 17.5, cmdY + 2.2, 25.8);
    add(new THREE.BoxGeometry(28.4, 3.4, 0.06),
        new THREE.MeshStandardMaterial({ color: 0x003366, emissive: new THREE.Color(0x0044aa),
                                         emissiveIntensity: 0.6, roughness: 0.2, metalness: 0.8 }),
        17.5, cmdY + 2.2, 25.75);
    add(new THREE.BoxGeometry(0.08, 2.2, 6), screen, 2.5,  cmdY + 2.0, 15);
    add(new THREE.BoxGeometry(0.08, 2.2, 6), screen, 32.5, cmdY + 2.0, 15);

    // ── F3 EXECUTIVE FLOOR  (X 2–33, Z 28–58) ──────────────────────────────
    const execY = FLOOR_Y.F3 + SLAB_H;
    const execDesks: [number, number][] = [[8, 32], [20, 32], [8, 42], [20, 42]];
    execDesks.forEach(([ex, ez]) => {
      add(new THREE.BoxGeometry(4.5, 0.09, 2.0), desk,   ex,      execY + 0.82, ez);
      add(new THREE.BoxGeometry(2.0, 0.09, 1.8), desk,   ex + 2.5, execY + 0.82, ez + 1.6);
      add(new THREE.BoxGeometry(1.4, 0.82, 0.06), screen, ex,      execY + 1.32, ez - 0.9);
      add(new THREE.BoxGeometry(1.0, 0.08, 1.1), sofa,   ex,      execY + 0.46, ez + 0.9);
    });
    add(new THREE.BoxGeometry(14, 0.09, 4.5), desk, 17.5, execY + 0.82, 52);
    for (let i = 0; i < 5; i++) {
      add(new THREE.BoxGeometry(1.2, 0.08, 1.0), sofa, 9 + i * 3.5, execY + 0.46, 50);
      add(new THREE.BoxGeometry(1.2, 0.08, 1.0), sofa, 9 + i * 3.5, execY + 0.46, 54);
    }
    add(new THREE.BoxGeometry(7, 0.45, 2.2),  sofa,  27, execY + 0.22, 34);
    add(new THREE.BoxGeometry(7, 0.68, 0.3),  sofa,  27, execY + 0.34, 35.2);
    add(new THREE.BoxGeometry(2.4, 0.07, 1.4), white, 27, execY + 0.55, 32);

    // ── F3 SERVER ROOM  (X 57–78, Z 5–28) ──────────────────────────────────
    const srvY = FLOOR_Y.F3 + SLAB_H;
    for (let row = 0; row < 3; row++) {
      for (let rack = 0; rack < 5; rack++) {
        const rx = 59 + rack * 3.8;
        const rz = 7  + row * 7;
        add(new THREE.BoxGeometry(1.8, 2.2, 1.0), server, rx, srvY + 1.1, rz);
        add(new THREE.BoxGeometry(1.6, 0.08, 0.06),
            new THREE.MeshStandardMaterial({ color: 0x001100, emissive: new THREE.Color(0x00ff44), emissiveIntensity: 0.9 }),
            rx, srvY + 0.6, rz - 0.52);
        add(new THREE.BoxGeometry(1.6, 0.08, 0.06),
            new THREE.MeshStandardMaterial({ color: 0x100800, emissive: new THREE.Color(0xff8800), emissiveIntensity: 0.8 }),
            rx, srvY + 1.0, rz - 0.52);
        add(new THREE.BoxGeometry(1.6, 0.08, 0.06),
            new THREE.MeshStandardMaterial({ color: 0x001030, emissive: new THREE.Color(0x0088ff), emissiveIntensity: 0.7 }),
            rx, srvY + 1.4, rz - 0.52);
      }
    }
    add(new THREE.BoxGeometry(19, 0.04, 21), metal, 67.5, srvY - 0.01, 16.5);
    add(new THREE.BoxGeometry(0.4, 2.8, 6), metal, 77.6, srvY + 1.4, 16);
    add(new THREE.BoxGeometry(0.18, 2.4, 5.6),
        new THREE.MeshStandardMaterial({ color: 0x002244, emissive: new THREE.Color(0x004488), emissiveIntensity: 0.4 }),
        77.8, srvY + 1.4, 16);

    // ── F3 DATA CENTER  (X 57–78, Z 30–58) ─────────────────────────────────
    const dataY = FLOOR_Y.F3 + SLAB_H;
    for (let row = 0; row < 4; row++) {
      for (let rack = 0; rack < 4; rack++) {
        const rx = 59.5 + rack * 4.5;
        const rz = 32   + row * 6;
        add(new THREE.BoxGeometry(2.0, 2.4, 1.2), server, rx, dataY + 1.2, rz);
        add(new THREE.BoxGeometry(1.8, 0.06, 0.06),
            new THREE.MeshStandardMaterial({ color: 0x001100, emissive: new THREE.Color(0x00ee44), emissiveIntensity: 1.0 }),
            rx, dataY + 0.5 + rack * 0.3, rz - 0.62);
      }
    }
    add(new THREE.BoxGeometry(6, 0.08, 1.8), desk, 67.5, dataY + 0.82, 56);
    for (let i = 0; i < 3; i++) {
      add(new THREE.BoxGeometry(1.6, 1.0, 0.06), screen, 63 + i * 4, dataY + 1.4, 55.1);
    }
    add(new THREE.BoxGeometry(19, 0.04, 26), metal, 67.5, dataY - 0.01, 44);
  }

  // ── Ceiling HVAC infrastructure (always visible in interior) ─────────────
  function addCeilingHVAC(scene: THREE.Scene, hvacFault: boolean) {
    const matGalv  = new THREE.MeshStandardMaterial({ color: 0xb0bec5, roughness: 0.30, metalness: 0.80 });
    const matFault = new THREE.MeshStandardMaterial({ color: 0xb71c1c, roughness: 0.35, metalness: 0.55,
      emissive: new THREE.Color(0xaa0000), emissiveIntensity: 0.3, transparent: true, opacity: 0.92 });
    const matPipe  = new THREE.MeshStandardMaterial({ color: 0x78909c, roughness: 0.25, metalness: 0.85 });
    const matRiser = new THREE.MeshStandardMaterial({ color: 0xc62828, roughness: 0.30, metalness: 0.55,
      emissive: new THREE.Color(0xff0000), emissiveIntensity: 0.4 });
    const matRib   = new THREE.MeshStandardMaterial({ color: 0x607d8b, roughness: 0.25, metalness: 0.85 });
    const matLouvre= new THREE.MeshStandardMaterial({ color: 0x90a4ae, roughness: 0.20, metalness: 0.90 });
    const matFCUok = new THREE.MeshStandardMaterial({ color: 0x37474f, roughness: 0.25, metalness: 0.80 });
    const matFCUfl = new THREE.MeshStandardMaterial({ color: 0xb71c1c, roughness: 0.30, metalness: 0.55,
      emissive: new THREE.Color(0xff1100), emissiveIntensity: 0.5 });
    const matLED   = new THREE.MeshStandardMaterial({ color: 0xff1111, roughness: 0.10, metalness: 0,
      emissive: new THREE.Color(0xff0000), emissiveIntensity: 1.0 });

    const pipeRun = (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number,
      r: number, mat: THREE.Material) => {
      const path = new THREE.LineCurve3(new THREE.Vector3(x1,y1,z1), new THREE.Vector3(x2,y2,z2));
      scene.add(new THREE.Mesh(new THREE.TubeGeometry(path, 4, r, 8, false), mat));
    };

    const rectDuct = (x: number, y: number, z: number, lx: number, ly: number, lz: number,
      mat: THREE.Material) => {
      const d = new THREE.Mesh(new THREE.BoxGeometry(lx, ly, lz), mat);
      d.position.set(x, y, z); scene.add(d);
      if (lx > lz) {
        for (let rx = x - lx / 2 + 1.2; rx < x + lx / 2; rx += 1.2) {
          const r = new THREE.Mesh(new THREE.BoxGeometry(0.06, ly + 0.06, lz + 0.06), matRib);
          r.position.set(rx, y, z); scene.add(r);
        }
      } else {
        for (let rz = z - lz / 2 + 1.2; rz < z + lz / 2; rz += 1.2) {
          const r = new THREE.Mesh(new THREE.BoxGeometry(lx + 0.06, ly + 0.06, 0.06), matRib);
          r.position.set(x, y, rz); scene.add(r);
        }
      }
    };

    const addFCU = (x: number, y: number, z: number, fault: boolean) => {
      const mat = fault ? matFCUfl : matFCUok;
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.28, 1.0), mat);
      body.position.set(x, y, z); scene.add(body);
      for (let i = 0; i < 5; i++) {
        const l = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.04, 0.06), matLouvre);
        l.position.set(x, y - 0.14, z - 0.38 + i * 0.19); scene.add(l);
      }
      const grille = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.03, 0.3), matLouvre);
      grille.position.set(x, y + 0.15, z - 0.28); scene.add(grille);
      const tray = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.05, 1.1),
        new THREE.MeshStandardMaterial({ color: fault ? 0x7f1d1d : 0x37474f, roughness: 0.5, metalness: 0.3 }));
      tray.position.set(x, y - 0.17, z); scene.add(tray);
      if (fault) {
        const led = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.04, 0.06), matLED);
        led.position.set(x, y - 0.13, z + 0.46); scene.add(led);
      }
    };

    const F: Record<string, number> = { F1: FLOOR_Y.F1, F2: FLOOR_Y.F2, F3: FLOOR_Y.F3 };

    // ── Vertical duct shafts (full storey height) ─────────────────────────
    for (let fy = 0; fy < TOT_H; fy += 0.4) {
      const s1 = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.65, 0.38, 10), (hvacFault ? matFault : matGalv).clone());
      s1.position.set(5, fy + 0.19, 5); scene.add(s1);
      const s2 = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.38, 10), matGalv.clone());
      s2.position.set(75, fy + 0.19, 5); scene.add(s2);
    }

    // ── CHW supply + return risers (inside wing corners) ──────────────────
    // Left wing — fault zone (red pipe only when hvac incident)
    pipeRun(6, 0, 8, 6, TOT_H, 8, 0.12, hvacFault ? matRiser : matPipe);
    pipeRun(6.3, 0, 8, 6.3, TOT_H, 8, 0.09, matPipe);
    // Right wing — normal zone
    pipeRun(74, 0, 8, 74, TOT_H, 8, 0.12, matPipe);
    pipeRun(74.3, 0, 8, 74.3, TOT_H, 8, 0.09, matPipe);

    // ── Per-floor ceiling supply duct trunks ──────────────────────────────
    (['F1', 'F2', 'F3'] as const).forEach((fl) => {
      const cY = F[fl] + FLOOR_H - 0.55;
      const isFault = hvacFault && fl === 'F1';
      const mat = isFault ? matFault : matGalv;
      // Left wing E-W main trunk
      rectDuct(17, cY, 12, 34, 0.55, 0.85, mat);
      // Right wing E-W main trunk
      rectDuct(67, cY, 22, 22, 0.55, 0.85, mat);
      // Left wing N-S branch ducts
      rectDuct(5,  cY, 32, 0.55, 0.45, 28, mat);
      rectDuct(30, cY, 32, 0.55, 0.45, 28, mat);
      // Right wing N-S branch ducts
      rectDuct(60, cY, 30, 0.55, 0.45, 24, mat);
      rectDuct(76, cY, 30, 0.55, 0.45, 24, mat);
      // CHW horizontal branch piping at ceiling level
      pipeRun(6, cY - 0.5, 8, 17, cY - 0.5, 12, 0.10, isFault ? matRiser : matPipe);
      pipeRun(74, cY - 0.5, 8, 67, cY - 0.5, 22, 0.10, matPipe);
    });

    // ── FCU ceiling cassettes ─────────────────────────────────────────────
    ([
      [9,  F.F1 + FLOOR_H - 0.14, 13,  hvacFault],
      [26, F.F1 + FLOOR_H - 0.14, 13,  hvacFault],
      [9,  F.F1 + FLOOR_H - 0.14, 42,  hvacFault],
      [26, F.F1 + FLOOR_H - 0.14, 51,  hvacFault],
      [62, F.F1 + FLOOR_H - 0.14, 16,  hvacFault],
      [68, F.F1 + FLOOR_H - 0.14, 44,  hvacFault],
      [9,  F.F2 + FLOOR_H - 0.14, 18,  false],
      [26, F.F2 + FLOOR_H - 0.14, 45,  false],
      [62, F.F2 + FLOOR_H - 0.14, 22,  false],
      [68, F.F2 + FLOOR_H - 0.14, 50,  false],
      [13, F.F3 + FLOOR_H - 0.14, 16,  false],
      [16, F.F3 + FLOOR_H - 0.14, 43,  false],
      [62, F.F3 + FLOOR_H - 0.14, 16,  false],
      [68, F.F3 + FLOOR_H - 0.14, 44,  false],
    ] as [number, number, number, boolean][]).forEach(([x, y, z, flt]) => addFCU(x, y, z, flt));
  }

  // ── Entrances ────────────────────────────────────────────────────────────
  function addEntrances(scene: THREE.Scene) {
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x1c2838, metalness: 0.88, roughness: 0.14 });
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x90c8e8, transparent: true, opacity: 0.48,
      transmission: 0.65, roughness: 0.03, ior: 1.52, side: THREE.DoubleSide,
    });
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0xb0bcc8, metalness: 0.62, roughness: 0.3 });

    [17, 66].forEach((x) => {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(5.6, 3.9, 0.22), frameMat.clone());
      frame.position.set(x, 1.95, -0.11); scene.add(frame);

      const door = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 3.3), glassMat.clone());
      door.position.set(x, 2.0, 0.02); scene.add(door);

      const canopy = new THREE.Mesh(new THREE.BoxGeometry(7.5, 0.14, 3.2), canopyMat.clone());
      canopy.position.set(x, 4.0, -1.6); canopy.castShadow = true; scene.add(canopy);
    });
  }

  // ── Roof details ─────────────────────────────────────────────────────────
  function addRoofDetails(scene: THREE.Scene) {
    const ry = TOT_H + 0.25;
    const hvacMat = new THREE.MeshStandardMaterial({ color: 0x48525e, roughness: 0.58, metalness: 0.52 });
    const grilleMat = new THREE.MeshStandardMaterial({ color: 0x2e3540, roughness: 0.92 });
    const parMat = new THREE.MeshStandardMaterial({ color: PAL.CONC_LIGHT, roughness: 0.42, metalness: 0.18 });

    // HVAC units
    ([[12,18],[20,44],[22,10],[62,24],[68,42],[70,10]] as [number,number][]).forEach(([x, z]) => {
      const u = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.8, 3.2), hvacMat.clone());
      u.position.set(x, ry + 0.9, z); u.castShadow = true; scene.add(u);
      const gr = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.1, 3.0), grilleMat.clone());
      gr.position.set(x, ry + 1.85, z); scene.add(gr);
    });

    // Parapet walls
    const par = (w: number, d: number, x: number, z: number) => {
      const p = new THREE.Mesh(new THREE.BoxGeometry(w, 0.75, d), parMat.clone());
      p.position.set(x, TOT_H + 0.38, z); scene.add(p);
    };
    par(LW_X1 - LW_X0, 0.28, (LW_X0 + LW_X1) / 2, 0);        // left wing south
    par(0.28, BD, LW_X0, BD / 2);                               // left wing west
    par(RW_X0 - LW_X1, 0.28, (LW_X1 + RW_X0) / 2, BD);        // connector north
    par(0.28, BD, RW_X1, BD / 2);                               // right wing east

    // ── Schneider Electric facade sign (mounted on south wall, F3 level) ────
    addSchneiderSign(scene);
  }

  function addSchneiderSign(scene: THREE.Scene) {
    // White aluminium backing panel on the south facade
    const panelMat = new THREE.MeshStandardMaterial({ color: 0xf0f4f8, roughness: 0.38, metalness: 0.28 });
    const panel = new THREE.Mesh(new THREE.BoxGeometry(18, 2.4, 0.12), panelMat);
    panel.position.set(17, TOT_H - 1.5, 0.06);   // centred on left-wing south face, top floor
    scene.add(panel);

    // Green accent bar along the bottom of the panel
    const barMat = new THREE.MeshStandardMaterial({ color: 0x3dcd58, roughness: 0.3, metalness: 0.2, emissive: 0x1a7030, emissiveIntensity: 0.18 });
    const bar = new THREE.Mesh(new THREE.BoxGeometry(18, 0.22, 0.14), barMat);
    bar.position.set(17, TOT_H - 2.61, 0.07);
    scene.add(bar);

    // Canvas texture: Schneider Electric logo style
    const cv = document.createElement('canvas');
    cv.width = 1024; cv.height = 160;
    const ctx = cv.getContext('2d')!;

    // Panel background — off-white
    ctx.fillStyle = '#f0f4f8';
    ctx.fillRect(0, 0, 1024, 160);

    // Green bottom bar on canvas
    ctx.fillStyle = '#3dcd58';
    ctx.fillRect(0, 138, 1024, 22);

    // Schneider Electric "square-S" style — green square left marker
    ctx.fillStyle = '#3dcd58';
    ctx.fillRect(28, 20, 14, 110);   // vertical bar
    ctx.fillRect(28, 20, 80, 14);    // top horizontal
    ctx.fillRect(28, 63, 80, 14);    // mid horizontal
    ctx.fillRect(28, 107, 80, 14);   // bottom horizontal

    // "Schneider" — bold, large, dark grey
    ctx.font = 'bold 68px "Arial", sans-serif';
    ctx.fillStyle = '#1a2230';
    ctx.textBaseline = 'top';
    ctx.fillText('Schneider', 126, 12);

    // "Electric" — lighter weight, slightly smaller, SE brand green
    ctx.font = '500 52px "Arial", sans-serif';
    ctx.fillStyle = '#3dcd58';
    ctx.fillText('Electric', 126, 82);

    // "THE NEST" tag — right side, small caps style
    ctx.font = 'bold 30px "Arial", sans-serif';
    ctx.fillStyle = '#6a8aaa';
    ctx.textAlign = 'right';
    ctx.fillText('THE NEST', 996, 52);

    const tex = new THREE.CanvasTexture(cv);
    tex.needsUpdate = true;
    const sigMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.3, metalness: 0.1, transparent: false });
    const sigMesh = new THREE.Mesh(new THREE.PlaneGeometry(17.6, 2.2), sigMat);
    sigMesh.position.set(17, TOT_H - 1.5, 0.13);
    scene.add(sigMesh);
  }

  // ── Environment ──────────────────────────────────────────────────────────
  function addEnvironment(scene: THREE.Scene) {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300),
      new THREE.MeshStandardMaterial({ color: 0x1a2018, roughness: 0.93 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05;
    ground.receiveShadow = true; scene.add(ground);

    // Road
    const road = new THREE.Mesh(new THREE.PlaneGeometry(200, 12),
      new THREE.MeshStandardMaterial({ color: 0x161a20, roughness: 0.97 }));
    road.rotation.x = -Math.PI / 2; road.position.set(40, -0.02, -10); scene.add(road);
    for (let i = -70; i < 110; i += 12) {
      const mk = new THREE.Mesh(new THREE.PlaneGeometry(6, 0.28),
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82 }));
      mk.rotation.x = -Math.PI / 2; mk.position.set(i, -0.01, -10); scene.add(mk);
    }

    // Walkway
    const walk = new THREE.Mesh(new THREE.PlaneGeometry(110, 4),
      new THREE.MeshStandardMaterial({ color: 0x727e88, roughness: 0.78 }));
    walk.rotation.x = -Math.PI / 2; walk.position.set(40, -0.01, -4); scene.add(walk);

    // Trees
    const tMat = new THREE.MeshStandardMaterial({ color: 0x26502a, roughness: 0.88 });
    const tkMat = new THREE.MeshStandardMaterial({ color: 0x553820 });
    [-12, -2, 8, 18, 28, 46, 58, 70, 84].forEach((x) => {
      const tk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 3.5, 8), tkMat.clone());
      tk.position.set(x, 1.75, -15); scene.add(tk);
      const cr = new THREE.Mesh(new THREE.SphereGeometry(2.3, 8, 6), tMat.clone());
      cr.scale.y = 0.52; cr.position.set(x, 4.9, -15); cr.castShadow = true; scene.add(cr);
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SPRITE HELPERS
  // ─────────────────────────────────────────────────────────────────────────
  // ── 3D alert sprite (shown above affected rooms) ─────────────────────
  function spawnAlertSprite(incident: NonNullable<NestIncident>): THREE.Sprite {
    const LABELS: Record<NonNullable<NestIncident>, string> = {
      fire: '🔥  FIRE ALERT', hvac: '❄  HVAC FAULT', power: '⚡  POWER ALERT',
      occupancy: '👥  OCCUPANCY', energy: '💡  ENERGY ALERT',
    };
    const col = ALERT_CSS_COLOR[incident];
    const cv = document.createElement('canvas');
    cv.width = 340; cv.height = 84;
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = 'rgba(6,10,22,0.94)';
    rRect(ctx, 2, 2, 336, 80, 10); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 2.5;
    rRect(ctx, 2, 2, 336, 80, 10); ctx.stroke();
    ctx.font = 'bold 26px Inter, sans-serif';
    ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(LABELS[incident], 170, 42);
    const tex = new THREE.CanvasTexture(cv);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sp.scale.set(18, 4.5, 1);
    return sp;
  }

  function spawnLabel(text: string, color: string, fs: number, lh: number): THREE.Sprite {
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 128;
    const ctx = cv.getContext('2d')!;
    ctx.font = `bold ${Math.round(fs * 48)}px Inter, sans-serif`;
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 64);
    const tex = new THREE.CanvasTexture(cv);
    tex.needsUpdate = true;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sp.scale.set(lh * 8, lh * 2, 1);
    return sp;
  }

  function spawnTooltip(text: string): THREE.Sprite {
    const cv = document.createElement('canvas');
    cv.width = 384; cv.height = 96;
    const ctx = cv.getContext('2d')!;
    if (text) {
      ctx.fillStyle = 'rgba(8,14,26,0.90)';
      rRect(ctx, 4, 4, 376, 88, 10); ctx.fill();
      ctx.strokeStyle = '#00e5ff'; ctx.lineWidth = 2;
      rRect(ctx, 4, 4, 376, 88, 10); ctx.stroke();
      ctx.font = 'bold 22px Inter, sans-serif';
      ctx.fillStyle = '#e8eeff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, 192, 38);
      ctx.font = '16px Inter, sans-serif';
      ctx.fillStyle = '#88aacc';
      const room = ALL_ROOMS.find(r => r.name === text || text.startsWith(r.name));
      if (room) ctx.fillText(`${room.people ?? 0} / ${room.capacity ?? '?'} people  •  ${room.systems.join(', ')}`, 192, 68);
    }
    const tex = new THREE.CanvasTexture(cv);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sp.scale.set(20, 5, 1);
    return sp;
  }

  function rRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }

  function refreshTooltip(roomId: string | null) {
    const tip = tooltipRef.current;
    if (!tip) return;
    if (!roomId) { tip.visible = false; return; }
    const room = ALL_ROOMS.find(r => r.id === roomId);
    if (!room) { tip.visible = false; return; }
    const newSp = spawnTooltip(room.name);
    (tip.material as THREE.SpriteMaterial).map = (newSp.material as THREE.SpriteMaterial).map;
    (tip.material as THREE.SpriteMaterial).map!.needsUpdate = true;
    tip.visible = true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RAYCASTING
  // ─────────────────────────────────────────────────────────────────────────
  function getHitRoom(e: React.MouseEvent): string | null {
    const renderer = rendererRef.current, cam = cameraRef.current;
    if (!renderer || !cam || !mountRef.current) return null;
    const rect = mountRef.current.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, cam);
    const hits = rc.intersectObjects(Array.from(roomMeshesRef.current.values()), false);
    return hits.length ? (hits[0].object.userData as { roomId: string }).roomId ?? null : null;
  }

  function applyHover(roomId: string | null) {
    // Un-highlight previous
    if (hoveredRef.current && hoveredRef.current !== roomId) {
      const prev = roomMeshesRef.current.get(hoveredRef.current);
      if (prev) {
        const r = ALL_ROOMS.find(x => x.id === hoveredRef.current);
        if (r) {
          (prev.material as THREE.MeshStandardMaterial).color.set(r.baseColor);
          (prev.material as THREE.MeshStandardMaterial).emissiveIntensity = 0;
        }
      }
    }
    // Highlight new
    if (roomId && roomId !== hoveredRef.current) {
      const mesh = roomMeshesRef.current.get(roomId);
      if (mesh) {
        (mesh.material as THREE.MeshStandardMaterial).color.set(0xfff4c0);
        (mesh.material as THREE.MeshStandardMaterial).emissive.set(0x806600);
        (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.35;
      }
      // Move tooltip above room
      const tip = tooltipRef.current;
      if (tip) {
        const room = ALL_ROOMS.find(r => r.id === roomId)!;
        const cx = room.pts.reduce((a, p) => a + p[0], 0) / room.pts.length;
        const cz = room.pts.reduce((a, p) => a + p[1], 0) / room.pts.length;
        tip.position.set(cx, FLOOR_Y[room.floor] + room.height + 3, cz);
      }
      refreshTooltip(roomId);
    } else if (!roomId) {
      refreshTooltip(null);
    }
    hoveredRef.current = roomId;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MOUSE HANDLERS
  // ─────────────────────────────────────────────────────────────────────────
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    prevMouseRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    // Hover highlight only — orbit is handled by OrbitControls
    applyHover(getHitRoom(e));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    // Only fire room click if the pointer barely moved (i.e. it was a tap, not an orbit drag)
    const dx = e.clientX - prevMouseRef.current.x;
    const dy = e.clientY - prevMouseRef.current.y;
    if (Math.hypot(dx, dy) < 5) {
      const id = getHitRoom(e);
      if (id) {
        onRoomClick?.(id);
        const room = ALL_ROOMS.find(r => r.id === id);
        if (room) onFloorClick?.(room.floor);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onRoomClick, onFloorClick]);

  const handleMouseLeave = useCallback(() => {
    applyHover(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <style>{`
        @keyframes nestAlertGlow {
          0%, 100% { box-shadow: 0 0 14px 2px var(--ac); }
          50%       { box-shadow: 0 0 30px 8px var(--ac); }
        }
        @keyframes nestAlertBorder {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.45; }
        }
      `}</style>

      {/* 3D canvas */}
      <div
        ref={mountRef}
        style={{ width: '100%', height: '100%', cursor: walkMode ? 'crosshair' : 'grab' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onClick={() => { if (walkMode && mountRef.current) mountRef.current.requestPointerLock?.(); }}
      />

      {/* HTML alert popup overlay — hidden for HVAC (handled by SOP panel) */}
      {alertPopup && alertPopup.type !== 'hvac' && (() => {
        const col = ALERT_CSS_COLOR[alertPopup.type];
        return (
          <div style={{
            position: 'absolute', top: 16, right: 16,
            background: 'rgba(6,10,22,0.96)',
            border: `2px solid ${col}`,
            borderRadius: 10,
            padding: '12px 18px',
            minWidth: 230,
            maxWidth: 280,
            // @ts-expect-error CSS variable
            '--ac': col,
            animation: 'nestAlertGlow 1.2s ease-in-out infinite',
            zIndex: 20,
            fontFamily: 'Inter, sans-serif',
            color: '#e8eeff',
            pointerEvents: 'none',
          }}>
            {/* Title row */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              fontSize: 15, fontWeight: 700, color: col, marginBottom: 8,
              animation: 'nestAlertBorder 1.2s ease-in-out infinite',
            }}>
              <span style={{ fontSize: 20 }}>{ALERT_ICON[alertPopup.type]}</span>
              {alertPopup.type.toUpperCase()} ALERT
            </div>
            {/* Affected rooms */}
            <div style={{ fontSize: 11, color: '#88aacc', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 1 }}>
              Affected Areas
            </div>
            {alertPopup.rooms.map(r => (
              <div key={r} style={{
                fontSize: 13, color: '#ccd6ea', padding: '3px 0',
                borderLeft: `3px solid ${col}`, paddingLeft: 8, marginBottom: 3,
              }}>• {r}</div>
            ))}
            <div style={{ marginTop: 8, fontSize: 11, color: '#667788' }}>
              ⚠ Rooms highlighted in 3D view
            </div>
          </div>
        );
      })()}

      {/* Walk-mode HUD overlay */}
      {walkMode && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 15 }}>
          {/* Crosshair */}
          <div style={{
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 22, height: 22,
          }}>
            <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1.5,
              background: 'rgba(255,255,255,0.75)', transform: 'translateY(-50%)' }} />
            <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1.5,
              background: 'rgba(255,255,255,0.75)', transform: 'translateX(-50%)' }} />
          </div>
          {/* Controls hint */}
          <div style={{
            position: 'absolute', bottom: 18, left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,0.62)', backdropFilter: 'blur(6px)',
            borderRadius: 10, padding: '8px 20px',
            color: 'rgba(255,255,255,0.85)', fontSize: 11,
            fontFamily: 'Inter, sans-serif', letterSpacing: 0.3,
            display: 'flex', gap: 10, alignItems: 'center',
          }}>
            <span>🖱 Click to capture mouse</span>
            <span style={{ opacity: 0.4 }}>|</span>
            {(['W','A','S','D'] as const).map(k => (
              <kbd key={k} style={{
                display: 'inline-block', background: 'rgba(255,255,255,0.15)',
                border: '1px solid rgba(255,255,255,0.25)', borderRadius: 4,
                padding: '1px 6px', fontFamily: 'monospace', fontSize: 11,
              }}>{k}</kbd>
            ))}
            <span>Move</span>
            <span style={{ opacity: 0.4 }}>|</span>
            <span>Mouse Look</span>
            <span style={{ opacity: 0.4 }}>|</span>
            <kbd style={{
              display: 'inline-block', background: 'rgba(255,255,255,0.15)',
              border: '1px solid rgba(255,255,255,0.25)', borderRadius: 4,
              padding: '1px 6px', fontFamily: 'monospace', fontSize: 11,
            }}>ESC</kbd>
            <span>Release</span>
          </div>
        </div>
      )}
    </div>
  );
}


