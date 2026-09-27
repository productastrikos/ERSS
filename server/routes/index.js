/**
 * Route registration. One file per resource; this is the index.
 * Contract: docs/04-API-AND-SOCKET-CONTRACT.md
 */

import authRoutes from './auth.js';
import bootstrapRoutes from './bootstrap.js';
import referenceRoutes from './reference.js';
import layerRoutes from './layers.js';
import incidentRoutes from './incidents.js';
import assignmentRoutes from './assignments.js';
import unitRoutes from './units.js';
import operationsRoutes from './operations.js';
import analyticsRoutes from './analytics.js';
import advisoryRoutes from './advisories.js';
import sosRoutes from './sos.js';
import meRoutes from './me.js';
import assistantRoutes from './assistant.js';
import patientRoutes from './patients.js';
import liveRoutes from './live.js';
import insightsRoutes from './insights.js';

export function registerRoutes(app) {
  app.use('/api/auth', authRoutes);
  app.use('/api', bootstrapRoutes);
  app.use('/api', referenceRoutes);
  app.use('/api/layers', layerRoutes);
  app.use('/api/incidents', incidentRoutes);
  app.use('/api/assignments', assignmentRoutes);
  app.use('/api/units', unitRoutes);
  app.use('/api', operationsRoutes);      // /kpi/today, /hospitals/recommend
  app.use('/api', analyticsRoutes);       // /analytics/response-time, /ranking
  app.use('/api', advisoryRoutes);        // /advisories
  app.use('/api', sosRoutes);             // /sos — citizen app
  app.use('/api', meRoutes);              // /me/medical-profile
  app.use('/api', assistantRoutes);       // /assistant/ask
  app.use('/api', patientRoutes);         // /incidents/:ref/patients, /patients/:id/*
  app.use('/api', liveRoutes);            // /sim, /live/*, /feed, /alerts
  app.use('/api', insightsRoutes);        // /insights/* — almanac, radial search, comparison, replay
}
