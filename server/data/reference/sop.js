/**
 * Standard operating procedures — what the console tells an operator to do, and in what
 * order, once a detection is confirmed.
 *
 * An SOP is DATA, not a component. Every scenario the simulation runs differs only in the
 * rows below: the same panel, the same phases, the same approve-and-assign button. Adding
 * a detection type is adding a key here, not writing a screen.
 *
 * There is one key, because the trial watches the road (config/poc.js). The indoor
 * procedure that used to sit beside it is in `_archive/indoor-scenario/`, intact.
 *
 * Each step declares WHO owns it and whether the platform can pre-fill it. `auto: true`
 * means the system has already done it by the time the operator reads the row — those
 * are the steps that make the case, because each one is a minute the old workflow spent
 * on the phone. `action` names an operation the console can actually perform; a step
 * with no action is an instruction to a human.
 */

export const SOPS = {
  /** A collision detected at a signalised junction. */
  rta_junction: {
    key: 'rta_junction',
    title: 'Road traffic collision — signalised junction',
    leadAgency: 'DCAS',
    supportingAgencies: ['RTA', 'DP'],
    /** What the AI proposes the moment the detection confirms. */
    advisory: {
      headline: 'Collision confirmed at a live junction — clear the approach before the ambulance arrives',
      clearTimeEstMin: 18,
      signalPlan: 'Lock DSO-SIG-101 RED; hold DSO-SIG-104 and DSO-SIG-107; extend green on DSO-SIG-105 and DSO-SIG-111 by 20 s',
      diversion: 'Divert westbound traffic via Academic City Road Entry (DSO-SIG-103)',
    },
    steps: [
      { id: 'lock', label: 'Lock the accident junction RED and hold the side approaches', owner: 'RTA', auto: true, action: 'signals.lock' },
      { id: 'divert', label: 'Open the diversion route and extend green on the absorbing corridors', owner: 'RTA', auto: true, action: 'signals.divert' },
      { id: 'cctv', label: 'Confirm the scene on both junction cameras before committing a crew', owner: 'DCAS', auto: false, action: 'cctv.open' },
      { id: 'dispatch', label: 'Dispatch the recommended ambulance', owner: 'DCAS', auto: false, action: 'dispatch.approve' },
      { id: 'police', label: 'Notify Dubai Police — carriageway obstruction, two lanes blocked', owner: 'DP', auto: true, action: 'agency.notify' },
      { id: 'corridor', label: 'Open the green corridor along the responding unit route', owner: 'RTA', auto: true, action: 'preempt.open' },
      { id: 'onscene', label: 'Crew on scene — confirm patient count against the camera', owner: 'DCAS', auto: false, action: null },
    ],
  },

};

export const sopFor = (key) => SOPS[key] ?? null;
