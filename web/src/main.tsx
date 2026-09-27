/**
 * The surface router. This is the ENTIRE routing story for the application.
 *
 *   /      → command console   (desktop, video wall)
 *   /app   → mobile app        (phone browser + Capacitor APK)
 *
 * Inside /app the surface is chosen by the authenticated user's ROLE, not by a second
 * URL — a citizen never sees a responder screen and vice versa, because there is no
 * /app/responder path to guess at. See docs/00-DECISIONS D-03.
 */

import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';

import './theme/base.css';
import 'maplibre-gl/dist/maplibre-gl.css';

import { ConsoleApp } from './console/ConsoleApp';
import { MobileApp } from './app/MobileApp';
import { setLocale } from './lib/i18n';
import './lib/stores/theme';   // applies the restored theme before first render

setLocale('en');

const isMobileSurface = window.location.pathname.startsWith('/app');

// The mobile surface opts into the larger touch targets and type ramp.
document.body.classList.add(isMobileSurface ? 'surface-mobile' : 'surface-console');

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing from index.html');

// Development only: the map lab (shared/map/lab). The DEV guard is statically false in
// a production build, so the lab and its fixtures are dropped from the bundle.
const MapLab = import.meta.env.DEV && new URLSearchParams(window.location.search).has('maplab')
  ? lazy(() => import('./shared/map/lab/MapLab'))
  : null;

createRoot(root).render(
  <StrictMode>
    {MapLab ? <Suspense><MapLab /></Suspense> : isMobileSurface ? <MobileApp /> : <ConsoleApp />}
  </StrictMode>,
);
