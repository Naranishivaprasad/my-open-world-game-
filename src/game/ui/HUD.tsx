'use client';

import { useEffect, useRef, useState } from 'react';
import { sim } from '../core/sim';
import { formatClock } from '../config/timeOfDay';
import { useGame } from '../core/store';
import { getRoadGraph } from '../world/roadGraph';
import { keyLabel } from '../config/bindings';
import { input } from '../input/InputManager';

/**
 * Heads-up display (spec 29).
 *
 * The world stays dominant: a compact minimap, a contextual prompt, and an
 * objective line. Every value shown is read from a real system - there are no
 * decorative gauges.
 */

/**
 * Sample the non-reactive sim at a human rate rather than every frame, so the
 * HUD re-renders ~10x/sec instead of 60x (spec 33).
 *
 * `read` is held in a ref so passing an inline closure does not tear down and
 * recreate the interval on every render.
 */
function useSimSample<T>(read: () => T, hz = 10): T {
  const [value, setValue] = useState(read);
  const readRef = useRef(read);
  readRef.current = read;
  useEffect(() => {
    const id = window.setInterval(() => setValue(readRef.current()), 1000 / hz);
    return () => window.clearInterval(id);
  }, [hz]);
  return value;
}

export function HUD() {
  const health = useSimSample(() => Math.round(sim.player.health));
  const prompt = useSimSample(() => sim.interaction);
  const toast = useSimSample(() => sim.toast);
  const clock = useSimSample(() => formatClock(sim.time.hour), 4);
  const waypoint = useSimSample(() => {
    if (!sim.waypoint) return null;
    const inCar = sim.controlMode === 'vehicle';
    const px = inCar ? sim.vehicle.position.x : sim.player.position.x;
    const pz = inCar ? sim.vehicle.position.z : sim.player.position.z;
    return Math.round(Math.hypot(sim.waypoint.x - px, sim.waypoint.z - pz));
  }, 4);
  const mission = useSimSample(
    () => ({
      state: sim.mission.state,
      label: sim.mission.objectiveLabel,
      distance: Math.round(sim.mission.distance),
      carrying: sim.mission.carryingCrate,
      promptKey: sim.mission.promptKey,
      promptLabel: sim.mission.promptLabel,
      dialogue: sim.mission.dialogue,
      reward: sim.mission.reward,
      money: sim.money,
      timeLeft: sim.mission.timeLeft,
      done: sim.mission.completedCount,
      total: sim.mission.totalCount,
    }),
    8,
  );

  return (
    <div className="hud">
      <div className="hud__minimap">
        <Minimap />
        <div className="hud__clock" aria-label="Time of day">
          {clock}
          {waypoint !== null && <span className="hud__waypoint"> · {waypoint} m</span>}
        </div>
      </div>

      {mission.label && mission.state === 'active' && (
        <div className="hud__objective">
          <div className="hud__objective-label">
            {mission.carrying ? 'Delivering' : 'Objective'}
          </div>
          <div className="hud__objective-text">{mission.label}</div>
          <div className="hint" style={{ marginTop: '0.2em' }}>
            {mission.distance} m
            {mission.timeLeft !== null && (
              <span className={mission.timeLeft < 30 ? 'hud__timer hud__timer--low' : 'hud__timer'}>
                {' '}
                · {Math.floor(mission.timeLeft / 60)}:
                {String(Math.floor(mission.timeLeft % 60)).padStart(2, '0')}
              </span>
            )}
            {mission.total > 0 && (
              <span style={{ opacity: 0.6 }}>
                {' '}
                · job {Math.min(mission.done + 1, mission.total)}/{mission.total}
              </span>
            )}
          </div>
        </div>
      )}

      {(mission.state === 'completed' ||
        mission.state === 'failed' ||
        mission.state === 'abandoned') && (
        <div className="hud__objective">
          <div
            className="hud__objective-label"
            style={{ color: mission.state === 'completed' ? 'var(--ok)' : 'var(--danger)' }}
          >
            {mission.state === 'completed' ? 'Mission complete' : `Mission ${mission.state}`}
          </div>
          <div className="hud__objective-text">First Delivery</div>
          {mission.state === 'completed' && (
            <div className="hint" style={{ marginTop: '0.2em' }}>
              +${mission.reward}
            </div>
          )}
        </div>
      )}

      {mission.money > 0 && (
        <div
          style={{
            position: 'absolute',
            right: '1.5em',
            top: mission.label || mission.state !== 'active' ? '6.2em' : '1.3em',
            fontSize: '1.2em',
            fontWeight: 800,
            color: 'var(--ok)',
            textShadow: '0 2px 10px rgba(0,0,0,0.85)',
            fontVariantNumeric: 'tabular-nums',
          }}
          aria-label={`Money ${mission.money} dollars`}
        >
          ${mission.money.toLocaleString()}
        </div>
      )}

      {mission.dialogue && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: '24%',
            transform: 'translateX(-50%)',
            maxWidth: 'min(46em, 82vw)',
            padding: '0.7em 1.2em',
            background: 'rgba(10,13,18,0.82)',
            border: '1px solid var(--hairline)',
            borderLeft: '3px solid var(--accent)',
            borderRadius: 8,
            fontSize: '0.95em',
            lineHeight: 1.45,
            textAlign: 'center',
          }}
        >
          {mission.dialogue}
          <div className="hint" style={{ marginTop: '0.35em', fontSize: '0.72em' }}>
            M to skip
          </div>
        </div>
      )}

      {(prompt || mission.promptLabel) && (
        <div className="hud__prompt">
          <span className="keycap">{mission.promptKey ?? prompt?.key}</span>
          <span>{mission.promptLabel ?? prompt?.label}</span>
        </div>
      )}

      <WantedDisplay />

      {toast && <div className="hud__toast">{toast}</div>}

      {health < 100 && <HealthBar value={health} />}

      <DriveCluster />
    </div>
  );
}

/**
 * Speed and gear readout, shown only while driving (spec 29: no fake gauges -
 * every value here is read from the vehicle controller).
 */
function DriveCluster() {
  const v = useSimSample(
    () => ({
      driving: sim.controlMode === 'vehicle',
      kph: Math.round(sim.vehicle.speedKph),
      gear: sim.vehicle.gear,
      rpm: sim.vehicle.rpm01,
      lights: sim.vehicle.headlights,
    }),
    12,
  );

  if (!v.driving) return null;

  return (
    <div
      style={{
        position: 'absolute',
        right: '1.6em',
        bottom: '1.5em',
        display: 'flex',
        alignItems: 'flex-end',
        gap: '0.9em',
        padding: '0.7em 1.1em',
        background: 'rgba(10,13,18,0.62)',
        border: '1px solid var(--hairline)',
        borderRadius: 12,
      }}
    >
      <div style={{ textAlign: 'right' }}>
        <div
          style={{
            fontSize: '2.4em',
            fontWeight: 800,
            lineHeight: 0.95,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {v.kph}
        </div>
        <div style={{ fontSize: '0.62em', letterSpacing: '0.24em', color: 'var(--ink-faint)' }}>
          KM/H
        </div>
      </div>

      <div style={{ display: 'grid', gap: '0.35em', justifyItems: 'center' }}>
        <div
          style={{
            fontFamily: 'var(--mono)',
            fontSize: '1.1em',
            fontWeight: 700,
            color: v.gear === 'R' ? 'var(--danger)' : 'var(--accent)',
            minWidth: '1.4em',
            textAlign: 'center',
          }}
        >
          {v.gear}
        </div>
        {/* Engine load bar, driven by the controller's rpm01. */}
        <div
          style={{
            width: 74,
            height: 4,
            background: 'rgba(255,255,255,0.12)',
            borderRadius: 99,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${Math.round(v.rpm * 100)}%`,
              height: '100%',
              background: v.rpm > 0.88 ? 'var(--danger)' : 'var(--accent)',
              transition: 'width 90ms linear',
            }}
          />
        </div>
        <div
          style={{
            fontSize: '0.58em',
            letterSpacing: '0.18em',
            color: v.lights ? 'var(--accent)' : 'var(--ink-faint)',
          }}
        >
          {v.lights ? 'LIGHTS ON' : 'LIGHTS OFF'}
        </div>
      </div>
    </div>
  );
}

/**
 * Wanted level and police status (spec 29).
 *
 * Shows the ACTUAL state machine, including whether the police currently have
 * eyes on you or are searching your last known position - the brief is explicit
 * that the HUD must display the real state, not a decorative meter.
 */
function WantedDisplay() {
  const p = useSimSample(
    () => ({
      wanted: sim.police.wanted,
      state: sim.police.state,
      hasSight: sim.police.hasSight,
      search: Math.ceil(sim.police.searchRemaining),
    }),
    8,
  );

  if (p.wanted <= 0) return null;

  const label =
    p.state === 'pursuing'
      ? p.hasSight
        ? 'SPOTTED'
        : 'IN PURSUIT'
      : p.state === 'searching'
        ? `SEARCHING ${p.search}s`
        : p.state === 'responding'
          ? 'UNITS RESPONDING'
          : p.state === 'cooling'
            ? 'LOSING THEM'
            : p.state === 'busted'
              ? 'BUSTED'
              : '';

  return (
    <div
      style={{
        position: 'absolute',
        left: '1.5em',
        bottom: 'calc(1.4em + 182px)',
        display: 'grid',
        gap: '0.25em',
      }}
      role="status"
      aria-label={`Wanted level ${p.wanted}, ${label}`}
    >
      <div style={{ display: 'flex', gap: '0.22em' }}>
        {[0, 1, 2].map((i) => (
          <Star key={i} lit={i < p.wanted} active={p.hasSight} />
        ))}
      </div>
      <div
        style={{
          fontSize: '0.62em',
          letterSpacing: '0.2em',
          fontWeight: 700,
          color: p.hasSight ? 'var(--danger)' : 'var(--accent)',
          textShadow: '0 1px 6px rgba(0,0,0,0.9)',
        }}
      >
        {label}
      </div>
    </div>
  );
}

function Star({ lit, active }: { lit: boolean; active: boolean }) {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden>
      <path
        d="M12 2.6l2.9 5.9 6.5.95-4.7 4.6 1.1 6.45L12 17.45 6.2 20.5l1.1-6.45-4.7-4.6 6.5-.95z"
        fill={lit ? (active ? '#e2543f' : '#ffb347') : 'rgba(255,255,255,0.14)'}
        stroke="rgba(0,0,0,0.55)"
        strokeWidth="1.2"
      />
    </svg>
  );
}

function HealthBar({ value }: { value: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: '1.4em',
        bottom: 'calc(1.4em + 190px)',
        width: 168,
        height: 5,
        background: 'rgba(10,13,18,0.7)',
        borderRadius: 99,
        overflow: 'hidden',
      }}
      role="img"
      aria-label={`Health ${value} percent`}
    >
      <div
        style={{
          width: `${value}%`,
          height: '100%',
          background: value > 30 ? 'var(--ok)' : 'var(--danger)',
        }}
      />
    </div>
  );
}

/**
 * Minimap drawn from the real road graph (spec 29: it must represent the actual
 * world). North-up is marked; the map rotates with the player.
 */
const MAP_SIZE = 168;
const MAP_METRES = 170; // width of the visible area in world metres

function Minimap() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = MAP_SIZE * dpr;
    canvas.height = MAP_SIZE * dpr;

    const graph = getRoadGraph();
    const scale = (MAP_SIZE / MAP_METRES) * dpr;
    const c = (MAP_SIZE * dpr) / 2;
    let raf = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);

      const px = sim.player.position.x;
      const pz = sim.player.position.z;
      // Rotate so the player's facing points up the map.
      const rot = -sim.camera.yaw;
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);

      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Round clip.
      ctx.beginPath();
      ctx.arc(c, c, c - 2 * dpr, 0, Math.PI * 2);
      ctx.clip();

      ctx.fillStyle = '#1a2028';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const toScreen = (wx: number, wz: number) => {
        const dx = (wx - px) * scale;
        const dz = (wz - pz) * scale;
        return [c + dx * cos - dz * sin, c + dx * sin + dz * cos] as const;
      };

      // Carriageways, drawn at true width.
      ctx.lineCap = 'round';
      for (const e of graph.edges) {
        const [x0, y0] = toScreen(e.ax, e.az);
        const [x1, y1] = toScreen(e.bx, e.bz);
        ctx.strokeStyle = e.kind === 'boulevard' ? '#5a646f' : e.kind === 'alley' ? '#39414a' : '#4c555f';
        ctx.lineWidth = Math.max(1.5 * dpr, e.halfWidth * 2 * scale);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }

      // Centre lines on the boulevard, so orientation reads at a glance.
      for (const e of graph.edges) {
        if (e.centreLine !== 'double-yellow') continue;
        const [x0, y0] = toScreen(e.ax, e.az);
        const [x1, y1] = toScreen(e.bx, e.bz);
        ctx.strokeStyle = 'rgba(224,184,58,0.45)';
        ctx.lineWidth = 1 * dpr;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }

      // --- mission route, following real roads (spec 29) ---
      const route = sim.mission.route;
      if (route && route.length > 1 && sim.mission.state === 'active') {
        ctx.strokeStyle = '#ff5ca8';
        ctx.lineWidth = 3 * dpr;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        const [sx0, sy0] = toScreen(route[0]!.x, route[0]!.z);
        ctx.moveTo(sx0, sy0);
        for (let i = 1; i < route.length; i++) {
          const [sx, sy] = toScreen(route[i]!.x, route[i]!.z);
          ctx.lineTo(sx, sy);
        }
        ctx.stroke();
      }

      // --- player waypoint, set from the full map ---
      if (sim.waypoint) {
        const [wx, wy] = toScreen(sim.waypoint.x, sim.waypoint.z);
        ctx.fillStyle = '#6ee7ff';
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 1.4 * dpr;
        ctx.beginPath();
        ctx.arc(wx, wy, 4 * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      // --- objective blip ---
      const m = sim.mission;
      if (m.state === 'active' && m.route && m.route.length > 0) {
        const last = m.route[m.route.length - 1]!;
        const [bx, by] = toScreen(last.x, last.z);
        ctx.fillStyle = '#ffb347';
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 1.4 * dpr;
        ctx.beginPath();
        ctx.arc(bx, by, 4.5 * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      ctx.restore();

      // Player arrow, always centred.
      ctx.save();
      ctx.translate(c, c);
      ctx.fillStyle = '#ffb347';
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1.2 * dpr;
      ctx.beginPath();
      ctx.moveTo(0, -7 * dpr);
      ctx.lineTo(5 * dpr, 6 * dpr);
      ctx.lineTo(0, 3.2 * dpr);
      ctx.lineTo(-5 * dpr, 6 * dpr);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // Frame + north pip.
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.arc(c, c, c - 2 * dpr, 0, Math.PI * 2);
      ctx.stroke();

      const northAngle = rot - Math.PI / 2;
      const nr = c - 11 * dpr;
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = `${9 * dpr}px ui-monospace, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('N', c + Math.cos(northAngle) * nr, c + Math.sin(northAngle) * nr);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: MAP_SIZE, height: MAP_SIZE, display: 'block' }}
      aria-label="Minimap"
      role="img"
    />
  );
}

// ------------------------------------------------------------------ debug

/** Development-only overlay (spec 36). Not part of the player HUD. */
export function DebugOverlay() {
  const stats = useSimSample(
    () => ({
      fps: Math.round(sim.stats.fps),
      frameMs: sim.stats.frameMs.toFixed(2),
      draws: sim.stats.drawCalls,
      tris: sim.stats.triangles,
      bodies: sim.stats.rigidBodies,
      x: sim.player.position.x.toFixed(1),
      y: sim.player.position.y.toFixed(2),
      z: sim.player.position.z.toFixed(1),
      speed: sim.player.speed.toFixed(2),
      grounded: sim.player.grounded,
      loco: sim.player.locomotion,
      mode: sim.controlMode,
      vKph: sim.vehicle.speedKph.toFixed(1),
      vGear: sim.vehicle.gear,
      vSteer: sim.vehicle.steer.toFixed(3),
      vOver: sim.vehicle.overturned,
      pol: sim.police.state,
      wanted: sim.police.wanted,
      polUnits: sim.police.units,
      polSight: sim.police.hasSight,
      traffic: sim.stats.trafficCount,
      peds: sim.stats.pedestrianCount,
      mState: sim.mission.state,
      mObj: sim.mission.objectiveIndex,
      mDist: sim.mission.distance.toFixed(1),
      mRoute: sim.mission.route ? sim.mission.route.length : 0,
      money: sim.money,
      yaw: sim.camera.yaw.toFixed(2),
      pitch: sim.camera.pitch.toFixed(2),
      camDist: sim.camera.actualDistance.toFixed(2),
    }),
    8,
  );

  return (
    <div className="debug">
      {`PALM COAST  dev overlay (F3)
fps        ${stats.fps}  (${stats.frameMs} ms)
draws      ${stats.draws}
triangles  ${stats.tris.toLocaleString()}
bodies     ${stats.bodies}
--
pos        ${stats.x}, ${stats.y}, ${stats.z}
speed      ${stats.speed} m/s
grounded   ${stats.grounded}
locomotion ${stats.loco}
control    ${stats.mode}
--
car kph    ${stats.vKph}
car gear   ${stats.vGear}
car steer  ${stats.vSteer}
overturned ${stats.vOver}
--
police     ${stats.pol}  wanted ${stats.wanted}
units      ${stats.polUnits}  line-of-sight ${stats.polSight}
traffic    ${stats.traffic}   peds ${stats.peds}
--
mission    ${stats.mState}  step ${stats.mObj}
distance   ${stats.mDist} m   route pts ${stats.mRoute}
money      $${stats.money}
--
cam yaw    ${stats.yaw}
cam pitch  ${stats.pitch}
cam dist   ${stats.camDist}
F4 toggles collider wireframes`}
    </div>
  );
}

// ------------------------------------------------------------- onboarding

interface Hint {
  id: string;
  text: string;
  /** Seconds after the previous hint cleared. */
  after: number;
  hold: number;
}

/**
 * Short contextual onboarding (spec 30) - never a permanent screen cover.
 */
export function Onboarding() {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(false);

  const hints: Hint[] = useRefConst(() => {
    const b = input.getBindings();
    return [
      {
        id: 'move',
        text: `Move with ${keyLabel(b.moveForward[0] ?? 'KeyW')}${keyLabel(b.moveLeft[0] ?? 'KeyA')}${keyLabel(b.moveBack[0] ?? 'KeyS')}${keyLabel(b.moveRight[0] ?? 'KeyD')} · look with the mouse`,
        after: 0.8,
        hold: 6,
      },
      {
        id: 'sprint',
        text: `Hold ${keyLabel(b.sprint[0] ?? 'ShiftLeft')} to sprint · ${keyLabel(b.walk[0] ?? 'AltLeft')} to walk · ${keyLabel(b.jump[0] ?? 'Space')} to jump`,
        after: 2,
        hold: 6,
      },
      {
        id: 'pause',
        text: `${keyLabel(b.pause[0] ?? 'Escape')} pauses and releases the mouse · F3 shows the dev overlay`,
        after: 3,
        hold: 6,
      },
    ];
  });

  useEffect(() => {
    if (index >= hints.length) return;
    const hint = hints[index]!;
    const showAt = window.setTimeout(() => setVisible(true), hint.after * 1000);
    const hideAt = window.setTimeout(
      () => {
        setVisible(false);
        setIndex((i) => i + 1);
      },
      (hint.after + hint.hold) * 1000,
    );
    return () => {
      window.clearTimeout(showAt);
      window.clearTimeout(hideAt);
    };
  }, [index, hints]);

  if (index >= hints.length || !visible) return null;

  return (
    <div className="hud overlay--passthrough">
      <div className="hud__toast">{hints[index]!.text}</div>
    </div>
  );
}

function useRefConst<T>(make: () => T): T {
  const ref = useRef<T | null>(null);
  if (ref.current === null) ref.current = make();
  return ref.current;
}
