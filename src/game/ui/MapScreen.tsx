'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getBlocks, getRoadGraph } from '../world/roadGraph';
import { districtFor, type District } from '../world/buildCity';
import { GROUND_HALF, SEA_X, SHORE_X, WORLD_HALF } from '../config/world';
import { formatClock } from '../config/timeOfDay';
import { parkedVehicles } from '../vehicle/parkedVehicles';
import { getParkedHero } from '../vehicle/takeover';
import { sim } from '../core/sim';

/**
 * The full-screen city map (spec 29).
 *
 * Everything on it is read from the SAME sources the world is built from - the
 * road graph for streets, `getBlocks()` for building footprints, `districtFor`
 * for the districts - so the map cannot show a street, a block or a district
 * that is not there. Opening it pauses the simulation, like the pause menu.
 *
 * Interaction: scroll to zoom, drag to pan, click to drop a waypoint. The
 * waypoint lives in `sim` so the minimap and the HUD can show it too.
 */

/** A district's fill and its label. */
const DISTRICTS: Record<District, { fill: string; label: string }> = {
  downtown: { fill: '#3a4250', label: 'DOWNTOWN' },
  commercial: { fill: '#343b46', label: 'MIDTOWN' },
  residential: { fill: '#333c39', label: 'CORAL HEIGHTS' },
  industrial: { fill: '#3b3a34', label: 'DOCKSIDE' },
  seafront: { fill: '#39434c', label: 'VISTA DEL MAR' },
};

/** One label per district, placed at a hand-picked readable spot. */
const DISTRICT_LABELS: { x: number; z: number; district: District }[] = [
  { x: 170, z: -40, district: 'downtown' },
  { x: -180, z: -40, district: 'commercial' },
  { x: -180, z: -300, district: 'residential' },
  { x: -120, z: 220, district: 'industrial' },
  { x: 300, z: 220, district: 'seafront' },
];

const LANDMARKS: { x: number; z: number; label: string }[] = [
  { x: 126, z: -26, label: 'Sunfuel station' },
  { x: 136, z: 55, label: 'Calle Verde parking' },
  { x: 393, z: 120, label: 'Vista del Mar beach' },
];

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 8;

export function MapScreen({ onClose }: { onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** Kept in a ref, not state: the draw loop reads it every frame. */
  /**
   * Default view, centred on the CITY rather than on the world origin: the
   * land runs from -515 to the shoreline at 378, so origin-centred left a
   * wide empty margin on one side.
   */
  const view = useRef({ zoom: 1, panX: -70, panZ: 0 });
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [waypointLabel, setWaypointLabel] = useState<string | null>(null);

  /** World metres per screen pixel at the current zoom, filled in by the draw. */
  const metresPerPx = useRef(1);
  const centre = useRef({ x: 0, y: 0 });

  const clearWaypoint = useCallback(() => {
    sim.waypoint = null;
    setWaypointLabel(null);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const graph = getRoadGraph();
    const blocks = getBlocks();

    // Named streets, grouped so one road is labelled once however many edges
    // it is split into at junctions.
    const streets = new Map<string, { edges: typeof graph.edges; vertical: boolean }>();
    for (const e of graph.edges) {
      if (e.kind === 'alley') continue;
      const entry = streets.get(e.name);
      if (entry) entry.edges.push(e);
      else streets.set(e.name, { edges: [e], vertical: Math.abs(e.dz) > Math.abs(e.dx) });
    }

    let raf = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
        canvas.width = cssW * dpr;
        canvas.height = cssH * dpr;
      }
      const W = canvas.width;
      const H = canvas.height;

      // Fit the land east to the shoreline, then apply zoom and pan.
      const span = (WORLD_HALF * 2 + 120) / view.current.zoom;
      const scale = Math.min(W, H) / span;
      const cx = W / 2 - view.current.panX * scale;
      const cy = H / 2 - view.current.panZ * scale;
      metresPerPx.current = 1 / (scale / dpr);
      centre.current = { x: cx / dpr, y: cy / dpr };

      const sx = (wx: number) => cx + wx * scale;
      const sy = (wz: number) => cy + wz * scale;

      ctx.clearRect(0, 0, W, H);

      // ---------------------------------------------------------- terrain
      ctx.fillStyle = '#10141a';
      ctx.fillRect(0, 0, W, H);

      const landT = sy(-WORLD_HALF - 60);
      const landB = sy(WORLD_HALF + 60);
      ctx.fillStyle = '#262c35';
      ctx.fillRect(sx(-WORLD_HALF - 60), landT, sx(SHORE_X) - sx(-WORLD_HALF - 60), landB - landT);

      // Beach, then the water it runs into.
      const beach = ctx.createLinearGradient(sx(SHORE_X), 0, sx(SEA_X), 0);
      beach.addColorStop(0, '#8c7f5f');
      beach.addColorStop(1, '#6e6a52');
      ctx.fillStyle = beach;
      ctx.fillRect(sx(SHORE_X), landT, sx(SEA_X) - sx(SHORE_X), landB - landT);

      const sea = ctx.createLinearGradient(sx(SEA_X), 0, sx(GROUND_HALF), 0);
      sea.addColorStop(0, '#1b4d61');
      sea.addColorStop(1, '#0d2c3a');
      ctx.fillStyle = sea;
      ctx.fillRect(sx(SEA_X), landT, W - sx(SEA_X), landB - landT);

      // ------------------------------------------------- building blocks
      // Drawn from the generator's own buildable rectangles, so the map shows
      // the city's real footprint rather than a bare street grid.
      for (const b of blocks) {
        ctx.fillStyle = DISTRICTS[districtFor(b.cx, b.cz)].fill;
        ctx.fillRect(sx(b.x0), sy(b.z0), (b.x1 - b.x0) * scale, (b.z1 - b.z0) * scale);
      }

      // ------------------------------------------------------------ roads
      ctx.lineCap = 'butt';
      // Casing first, then the surface, so junctions read as junctions.
      for (const pass of [0, 1] as const) {
        for (const e of graph.edges) {
          const w = Math.max(1.2 * dpr, e.halfWidth * 2 * scale);
          ctx.lineWidth = pass === 0 ? w + 2.2 * dpr : w;
          ctx.strokeStyle =
            pass === 0
              ? '#1a1f26'
              : e.kind === 'boulevard'
                ? '#737e8a'
                : e.kind === 'alley'
                  ? '#414952'
                  : '#626c77';
          ctx.beginPath();
          ctx.moveTo(sx(e.ax), sy(e.az));
          ctx.lineTo(sx(e.bx), sy(e.bz));
          ctx.stroke();
        }
      }
      for (const e of graph.edges) {
        if (e.centreLine !== 'double-yellow') continue;
        ctx.strokeStyle = 'rgba(224,184,58,0.55)';
        ctx.lineWidth = Math.max(1, 1.1 * dpr);
        ctx.beginPath();
        ctx.moveTo(sx(e.ax), sy(e.az));
        ctx.lineTo(sx(e.bx), sy(e.bz));
        ctx.stroke();
      }

      // ------------------------------------------------- district labels
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `600 ${Math.max(10, 13 * dpr * Math.min(1.4, view.current.zoom))}px system-ui, sans-serif`;
      for (const d of DISTRICT_LABELS) {
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        ctx.fillText(DISTRICTS[d.district].label, sx(d.x), sy(d.z));
      }

      // --------------------------------------------------- street names
      //
      // Anchored to the part of the road nearest the middle of the VIEW, not
      // to the road's own midpoint: once zoomed in, a road's midpoint is
      // usually off screen, so every label disappeared exactly when it became
      // readable.
      if (view.current.zoom >= 1.4) {
        const viewX = view.current.panX;
        const viewZ = view.current.panZ;
        ctx.font = `600 ${11 * dpr}px ui-monospace, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 3 * dpr;
        ctx.strokeStyle = 'rgba(8,11,15,0.85)';
        ctx.fillStyle = 'rgba(226,232,240,0.85)';

        for (const [name, st] of streets) {
          // Closest point on the closest edge of this road to the view centre.
          let best: { x: number; z: number; d: number } | null = null;
          for (const e of st.edges) {
            const t = Math.max(
              0,
              Math.min(1, ((viewX - e.ax) * e.dx + (viewZ - e.az) * e.dz) / Math.max(e.length, 0.001)),
            );
            const px = e.ax + (e.bx - e.ax) * t;
            const pz = e.az + (e.bz - e.az) * t;
            const d = Math.hypot(px - viewX, pz - viewZ);
            if (!best || d < best.d) best = { x: px, z: pz, d };
          }
          if (!best) continue;
          const lx = sx(best.x);
          const ly = sy(best.z);
          if (lx < -60 || ly < -60 || lx > W + 60 || ly > H + 60) continue;

          ctx.save();
          ctx.translate(lx, ly);
          if (st.vertical) ctx.rotate(-Math.PI / 2);
          ctx.strokeText(name, 0, 0);
          ctx.fillText(name, 0, 0);
          ctx.restore();
        }
      }

      // --------------------------------------------------------- vehicles
      for (const v of parkedVehicles.all()) {
        ctx.fillStyle = 'rgba(150,180,210,0.5)';
        const s = 2.2 * dpr;
        ctx.fillRect(sx(v.x) - s / 2, sy(v.z) - s / 2, s, s);
      }
      const hero = getParkedHero();
      if (hero) {
        ctx.fillStyle = '#5ad1ff';
        ctx.beginPath();
        ctx.arc(sx(hero.at.x), sy(hero.at.z), 4 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }

      // ------------------------------------------- mission route and blip
      const m = sim.mission;
      if ((m.state === 'active' || m.state === 'available') && m.route && m.route.length > 1) {
        ctx.strokeStyle = '#ff5ca8';
        ctx.lineWidth = 2.6 * dpr;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(sx(m.route[0]!.x), sy(m.route[0]!.z));
        for (let i = 1; i < m.route.length; i++) ctx.lineTo(sx(m.route[i]!.x), sy(m.route[i]!.z));
        ctx.stroke();

        const last = m.route[m.route.length - 1]!;
        blip(ctx, sx(last.x), sy(last.z), 6 * dpr, '#ffb347');
      }

      // ---------------------------------------------------- landmark pins
      ctx.font = `${11 * dpr}px ui-monospace, monospace`;
      ctx.textAlign = 'left';
      for (const l of LANDMARKS) {
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.beginPath();
        ctx.arc(sx(l.x), sy(l.z), 2.6 * dpr, 0, Math.PI * 2);
        ctx.fill();
        if (view.current.zoom >= 1.2) {
          ctx.fillStyle = 'rgba(255,255,255,0.7)';
          ctx.fillText(l.label, sx(l.x) + 7 * dpr, sy(l.z));
        }
      }

      // -------------------------------------------------------- waypoint
      if (sim.waypoint) {
        blip(ctx, sx(sim.waypoint.x), sy(sim.waypoint.z), 6 * dpr, '#6ee7ff');
      }

      // ----------------------------------------------------- the player
      const inCar = sim.controlMode === 'vehicle';
      const px = inCar ? sim.vehicle.position.x : sim.player.position.x;
      const pz = inCar ? sim.vehicle.position.z : sim.player.position.z;
      const heading = inCar ? sim.vehicle.heading : sim.player.heading;
      ctx.save();
      ctx.translate(sx(px), sy(pz));
      // Heading is atan2(dirX, dirZ); on a north-up map, -Z is up.
      ctx.rotate(Math.PI - heading);
      ctx.fillStyle = '#ffb347';
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.moveTo(0, -10 * dpr);
      ctx.lineTo(6.5 * dpr, 7.5 * dpr);
      ctx.lineTo(0, 3.8 * dpr);
      ctx.lineTo(-6.5 * dpr, 7.5 * dpr);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // ---------------------------------------------------- scale bar, N
      const barMetres = view.current.zoom >= 3 ? 50 : view.current.zoom >= 1.5 ? 100 : 200;
      const barPx = barMetres * scale;
      const bx = 18 * dpr;
      const by = H - 20 * dpr;
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + barPx, by);
      ctx.moveTo(bx, by - 4 * dpr);
      ctx.lineTo(bx, by + 4 * dpr);
      ctx.moveTo(bx + barPx, by - 4 * dpr);
      ctx.lineTo(bx + barPx, by + 4 * dpr);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = `${11 * dpr}px ui-monospace, monospace`;
      ctx.textAlign = 'left';
      ctx.fillText(`${barMetres} m`, bx, by - 10 * dpr);

      ctx.textAlign = 'center';
      ctx.font = `${14 * dpr}px ui-monospace, monospace`;
      ctx.fillText('N', W - 26 * dpr, 24 * dpr);
      ctx.beginPath();
      ctx.moveTo(W - 26 * dpr, 40 * dpr);
      ctx.lineTo(W - 26 * dpr, 58 * dpr);
      ctx.stroke();
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ------------------------------------------------------------ interaction

  const toWorld = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    return {
      x: (px - centre.current.x) * metresPerPx.current,
      z: (py - centre.current.y) * metresPerPx.current,
    };
  };

  const onWheel = (e: React.WheelEvent) => {
    const v = view.current;
    const factor = Math.exp(-e.deltaY * 0.0014);
    v.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, moved: false };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    view.current.panX -= dx * metresPerPx.current;
    view.current.panZ -= dy * metresPerPx.current;
    d.x = e.clientX;
    d.y = e.clientY;
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    // A click that did not drag is a waypoint, not a pan.
    if (!d || d.moved) return;
    const w = toWorld(e.clientX, e.clientY);
    sim.waypoint = { x: w.x, z: w.z };
    setWaypointLabel(`${w.x.toFixed(0)}, ${w.z.toFixed(0)}`);
  };

  const resetView = () => {
    view.current = { zoom: 1, panX: -70, panZ: 0 };
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="City map"
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(8,11,15,0.95)',
        display: 'flex',
        flexDirection: 'column',
        padding: '16px 20px',
        gap: 10,
      }}
    >
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
        <h2 style={{ margin: 0, font: '600 20px/1.2 system-ui, sans-serif', color: '#f3f1ec' }}>
          PALM COAST
        </h2>
        <span style={{ font: '13px ui-monospace, monospace', color: '#ffb347' }}>
          {formatClock(sim.time.hour)}
        </span>
        <span style={{ font: '13px ui-monospace, monospace', color: 'rgba(255,255,255,0.45)' }}>
          {sim.time.phase}
        </span>
        <span style={{ marginLeft: 'auto', font: '12px ui-monospace, monospace', color: 'rgba(255,255,255,0.45)' }}>
          scroll to zoom · drag to pan · click to set a waypoint · M or Esc to close
        </span>
      </header>

      <canvas
        ref={canvasRef}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{ flex: 1, width: '100%', minHeight: 0, display: 'block', cursor: 'crosshair', touchAction: 'none' }}
      />

      <footer
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 18,
          font: '12px ui-monospace, monospace',
          color: 'rgba(255,255,255,0.5)',
          flexWrap: 'wrap',
        }}
      >
        <Key swatch="#ffb347" label="You" />
        <Key swatch="#ff5ca8" label="Objective" />
        <Key swatch="#6ee7ff" label="Waypoint" />
        <Key swatch="#5ad1ff" label="Your parked car" />
        <Key swatch="rgba(150,180,210,0.7)" label="Parked vehicle" />
        <Key swatch="#8c7f5f" label="Beach" />
        <Key swatch="#1b4d61" label="Sea" />

        {waypointLabel && (
          <span style={{ color: '#6ee7ff' }}>
            waypoint {waypointLabel}
            <button onClick={clearWaypoint} style={btnStyle}>
              clear
            </button>
          </span>
        )}

        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={resetView} style={btnStyle}>
            Reset view
          </button>
          <button onClick={onClose} style={btnStyle}>
            Close
          </button>
        </span>
      </footer>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  marginLeft: 8,
  font: '12px system-ui, sans-serif',
  padding: '5px 12px',
  borderRadius: 6,
  border: '1px solid rgba(255,255,255,0.25)',
  background: 'transparent',
  color: '#f3f1ec',
  cursor: 'pointer',
};

function blip(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, colour: string) {
  ctx.fillStyle = colour;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function Key({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 10, height: 10, borderRadius: 2, background: swatch, display: 'inline-block' }} />
      {label}
    </span>
  );
}
