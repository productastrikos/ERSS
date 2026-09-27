/**
 * trafficIcons.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates HTML strings for MapLibre custom HTML markers using react-icons.
 * All functions return strings safe for `element.innerHTML` assignment
 * or for use in MapLibre Popup.setHTML().
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  FaTrafficLight,
  FaVideo,
  FaAmbulance,
  FaFireExtinguisher,
  FaShieldAlt,
  FaWrench,
} from 'react-icons/fa';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function icon(Ic: any, color: string, size = 20): string {
  return renderToStaticMarkup(React.createElement(Ic, { color, size }));
}

// ── Traffic Signal Marker ────────────────────────────────────────────────────
export function signalMarkerHTML(signalColor: string, signalId: string, state: string): string {
  return `
    <div class="tsmap-signal-dot"
         style="
           background: #0f1117;
           border: 2px solid ${signalColor};
           border-radius: 50%;
           width: 34px; height: 34px;
           display: flex; align-items: center; justify-content: center;
           box-shadow: 0 0 10px 3px ${signalColor}55, 0 0 4px ${signalColor};
           cursor: pointer;
           position: relative;
           transition: transform 0.15s;
         "
         title="${signalId} · ${state}"
    >
      ${icon(FaTrafficLight, signalColor, 18)}
      <div style="
        position:absolute; bottom:-18px; left:50%; transform:translateX(-50%);
        background:rgba(0,0,0,0.8); color:${signalColor}; font-size:8px;
        font-weight:700; padding:1px 5px; border-radius:3px;
        white-space:nowrap; letter-spacing:.05em;
      ">${state}</div>
    </div>
  `;
}

// ── CCTV Camera Marker ───────────────────────────────────────────────────────
export function cctvMarkerHTML(label: string, blink = false): string {
  return `
    <div class="tsmap-cctv-dot"
         style="
           background: rgba(0,10,5,0.85);
           border: 1.5px solid #4ade80;
           border-radius: 5px;
           width: 26px; height: 24px;
           display: flex; align-items: center; justify-content: center;
           cursor: pointer;
           position: relative;
           box-shadow: 0 0 6px #4ade8055;
         "
         title="CCTV: ${label}"
    >
      ${icon(FaVideo, '#4ade80', 13)}
      <div style="
        position:absolute; top:-7px; right:-6px;
        background:#ef4444; color:#fff; font-size:6px;
        font-weight:900; padding:1px 3px; border-radius:2px;
        letter-spacing:.05em;
        ${blink ? 'animation: tsmap-blink 1.2s step-start infinite;' : ''}
      ">●</div>
    </div>
  `;
}

// ── CCTV Popup Content (with real video embed) ───────────────────────────────
export function cctvPopupHTML(label: string, signalId: string, videoSrc: string): string {
  const ts   = new Date().toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const chan  = signalId.replace('DSO-SIG-', 'CH ');
  return `
    <div style="background:#080d12;border:1px solid #4ade80;border-radius:8px;padding:10px 12px;min-width:220px;font-family:'Courier New',monospace;color:#4ade80">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-weight:700;font-size:11px;letter-spacing:.1em">📷 CCTV LIVE</span>
        <span style="background:#ef4444;color:#fff;font-size:7px;padding:1px 5px;border-radius:3px;font-weight:900;letter-spacing:.05em;animation:tsmap-blink 1s step-start infinite">● REC</span>
      </div>
      <div style="margin-bottom:4px;font-size:8px;color:#6ee7b799">${ts} &nbsp;·&nbsp; ${signalId}</div>
      <div style="position:relative;border-radius:4px;overflow:hidden;margin-bottom:8px">
        <video src="${videoSrc}" autoplay muted loop playsinline
          style="display:block;width:100%;height:110px;object-fit:cover;border-radius:4px"></video>
        <div style="position:absolute;inset:0;background:repeating-linear-gradient(0deg,rgba(0,255,0,0.03) 0,rgba(0,255,0,0.03) 1px,transparent 1px,transparent 3px);pointer-events:none"></div>
        <div style="position:absolute;top:4px;left:5px;font-size:7px;color:#4ade8099;font-weight:700">${chan} · 720p · 25fps</div>
      </div>
      <div style="font-size:9px;color:#6ee7b7;letter-spacing:.04em">◉ ${label}</div>
    </div>
  `;
}

// ── Signal Info Popup (click on signal marker) ────────────────────────────────
export function signalInfoPopupHTML(
  signalId: string, name: string,
  state: string, signalColor: string,
  cycleTime: number, vehicleDensity: number,
  connectedRoads: number, greenTime: number, redTime: number,
  videoSrc: string,
  initialRemainingSec: number, // actual seconds remaining in the current phase
): string {
  const ts       = new Date().toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const chan      = signalId.replace('DSO-SIG-', 'CH ');
  const stateBg:  Record<string,string> = { GREEN:'#14532d', RED:'#450a0a', YELLOW:'#422006', FLASHING:'#431407' };
  const stateGlow:Record<string,string> = { GREEN:'#22c55e', RED:'#ef4444', YELLOW:'#f59e0b', FLASHING:'#f97316' };
  const bg   = stateBg[state]   ?? '#111827';
  const glow = stateGlow[state] ?? signalColor;
  const pct  = Math.round((greenTime / cycleTime) * 100);
  // Unique DOM id prefix so multiple popups don't clash
  const uid  = signalId.replace(/[^a-z0-9]/gi, '');
  return `
    <div id="sp-root-${uid}"
      data-green="${greenTime}" data-red="${redTime}" data-cycle="${cycleTime}" data-state="${state}"
      style="background:#080d12;border:1.5px solid ${glow};border-radius:10px;padding:0;min-width:240px;font-family:'Inter',system-ui,sans-serif;color:#e2e8f0;overflow:hidden;box-shadow:0 0 20px ${glow}33">

      <!-- Header -->
      <div id="sp-hdr-${uid}" style="background:${bg};padding:9px 12px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid ${glow}33">
        <div>
          <div style="font-size:9px;font-weight:700;letter-spacing:.12em;color:${glow}99">🚦 TRAFFIC SIGNAL</div>
          <div style="font-size:11px;font-weight:700;color:#e2e8f0;margin-top:2px">${signalId}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px">
          <div id="sp-state-${uid}" style="padding:2px 7px;border-radius:4px;font-size:9px;font-weight:900;background:${glow}22;color:${glow};border:1px solid ${glow}55;letter-spacing:.08em">${state}</div>
          <div style="font-size:7px;color:${glow}88">${ts}</div>
        </div>
      </div>

      <!-- CCTV live -->
      <div style="position:relative;margin:8px 10px 0">
        <video src="${videoSrc}" autoplay muted loop playsinline
          style="display:block;width:100%;height:108px;object-fit:cover;border-radius:5px"></video>
        <div style="position:absolute;inset:0;background:repeating-linear-gradient(0deg,rgba(0,200,80,.025) 0,rgba(0,200,80,.025) 1px,transparent 1px,transparent 3px);pointer-events:none;border-radius:5px"></div>
        <div style="position:absolute;top:4px;left:6px;font-size:7px;font-family:'Courier New',monospace;color:#4ade80cc;font-weight:700">${chan} · 720p · LIVE</div>
        <div style="position:absolute;top:4px;right:6px;background:#ef4444;color:#fff;font-size:6.5px;padding:1px 5px;border-radius:3px;font-weight:900">● REC</div>
      </div>

      <!-- Stats grid -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:9px 10px">
        <div style="background:#0f172a;border-radius:5px;padding:6px 8px;border:1px solid #1e293b">
          <div style="font-size:8px;color:#64748b;margin-bottom:2px">Remaining</div>
          <div id="sp-cnt-${uid}" style="font-size:13px;font-weight:700;color:${glow}">${initialRemainingSec}<span style="font-size:8px;font-weight:400">s</span></div>
        </div>
        <div style="background:#0f172a;border-radius:5px;padding:6px 8px;border:1px solid #1e293b">
          <div style="font-size:8px;color:#64748b;margin-bottom:2px">Vehicle Density</div>
          <div style="font-size:13px;font-weight:700;color:#fb923c">${vehicleDensity}<span style="font-size:8px;font-weight:400"> veh/km</span></div>
        </div>
        <div style="background:#0f172a;border-radius:5px;padding:6px 8px;border:1px solid #1e293b">
          <div style="font-size:8px;color:#64748b;margin-bottom:2px">Green Time</div>
          <div style="font-size:13px;font-weight:700;color:#22c55e">${greenTime}<span style="font-size:8px;font-weight:400">s</span></div>
        </div>
        <div style="background:#0f172a;border-radius:5px;padding:6px 8px;border:1px solid #1e293b">
          <div style="font-size:8px;color:#64748b;margin-bottom:2px">Roads Connected</div>
          <div style="font-size:13px;font-weight:700;color:#a78bfa">${connectedRoads}</div>
        </div>
      </div>

      <!-- Green-time efficiency bar -->
      <div style="padding:0 10px 10px">
        <div style="display:flex;justify-content:space-between;font-size:8px;color:#64748b;margin-bottom:3px">
          <span>Green Efficiency</span><span id="sp-pct-${uid}" style="color:${glow}">${pct}%</span>
        </div>
        <div style="background:#1e293b;border-radius:3px;height:4px;overflow:hidden">
          <div id="sp-bar-${uid}" style="width:${pct}%;height:4px;background:${glow};border-radius:3px;transition:width .5s"></div>
        </div>
        <div style="font-size:8px;color:#475569;margin-top:5px;text-align:center">${name}</div>
      </div>
    </div>
  `;
}

// ── Emergency Vehicle Markers ────────────────────────────────────────────────
const VEHICLE_STYLES: Record<string, { bg: string; border: string; label: string }> = {
  ambulance:   { bg: '#1a0010', border: '#f472b6', label: '🚑' },   // pink/magenta
  fire:        { bg: '#1a0800', border: '#fb923c', label: '🚒' },   // bright orange
  police:      { bg: '#001a1a', border: '#00e5ff', label: '🚔' },   // DSO cyan
  maintenance: { bg: '#1a1200', border: '#fbbf24', label: '🔧' },   // amber/yellow
};

export function vehicleMarkerHTML(type: 'ambulance' | 'fire' | 'police' | 'maintenance', arrived: boolean): string {
  const v = VEHICLE_STYLES[type] ?? VEHICLE_STYLES.police;
  // Role-specific icon — kept even when arrived (just turns green)
  const iconEl =
    type === 'ambulance'   ? icon(FaAmbulance,       arrived ? '#22c55e' : v.border, 16) :
    type === 'fire'        ? icon(FaFireExtinguisher, arrived ? '#22c55e' : v.border, 15) :
    type === 'maintenance' ? icon(FaWrench,           arrived ? '#22c55e' : v.border, 14) :
                             icon(FaShieldAlt,        arrived ? '#22c55e' : v.border, 15);

  return `
    <div class="tsmap-vehicle tsmap-vehicle--${type} ${arrived ? 'tsmap-vehicle--arrived' : ''}"
         style="
           background: ${arrived ? '#052905' : v.bg};
           border: 2px solid ${arrived ? '#22c55e' : v.border};
           border-radius: 50%;
           width: 36px; height: 36px;
           display: flex; align-items: center; justify-content: center;
           box-shadow: 0 0 12px 4px ${arrived ? '#22c55e44' : v.border + '55'};
           position: relative;
           transition: background 0.3s, border-color 0.3s;
         "
         title="${type.charAt(0).toUpperCase() + type.slice(1)} ${
             arrived ? '— ON SCENE' : '— En Route'}"
    >
      ${iconEl}
      <div style="
        position:absolute; bottom:-16px; left:50%; transform:translateX(-50%);
        background:rgba(0,0,0,0.8); color:${arrived ? '#22c55e' : v.border};
        font-size:7px; font-weight:700; padding:1px 4px; border-radius:3px;
        white-space:nowrap; letter-spacing:.05em;
      ">${arrived ? 'ON SCENE' : 'EN ROUTE'}</div>
    </div>
  `;
}

// ── Intersection node marker (small pulse dot) ───────────────────────────────
//  Not an HTML marker — used as canvas image for MapLibre symbol layer
export function drawIntersectionNodeImage(): { data: Uint8Array; width: number; height: number } {
  const W = 14, H = 14;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // Outer pulse ring
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, 6, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Core dot
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(200,220,255,0.7)';
  ctx.fill();

  const imgData = ctx.getImageData(0, 0, W, H);
  return { data: new Uint8Array(imgData.data.buffer), width: W, height: H };
}

// ── Road type → vehicle type config (exported for TSM panel) ────────────────
export const RESPONDER_CONFIG = {
  ambulance:   { icon: '🚑', label: 'Ambulance',        color: '#f472b6', amenity: 'hospital'      },
  fire:        { icon: '🚒', label: 'Fire Truck',       color: '#fb923c', amenity: 'fire_station'  },
  police:      { icon: '🚔', label: 'Police',           color: '#00e5ff', amenity: 'police'        },
  maintenance: { icon: '🔧', label: 'Maintenance Crew', color: '#fbbf24', amenity: 'depot'         },
} as const;

export const VEHICLE_COLOR: Record<string, string> = {
  ambulance:   '#f472b6',   // hot pink / magenta
  fire:        '#fb923c',   // bright orange
  police:      '#00e5ff',   // DSO cyan
  maintenance: '#fbbf24',   // amber
};
