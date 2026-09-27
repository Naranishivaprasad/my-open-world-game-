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
    const police = useSimSample(() => sim.police);
    const stamina = useSimSample(() => Math.round(sim.player.stamina));
    const aimHeld = useSimSample(() => sim.input.aimHeld);
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

  const setSeason = (s: 'sunny' | 'rainy' | 'snowy' | 'autumn') => {
    sim.season = s;
    // Force a React re-render by doing nothing via Zustand (or just rely on the next frame)
  };

  return (
    <div className="hud">
      {/* Version Indicator & Controls */}
      <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ background: 'rgba(255,0,0,0.8)', color: 'white', padding: '4px 8px', borderRadius: '4px', fontWeight: 'bold' }}>
          VERSION: 9 (Build Fix + Physics + Animations)
        </div>
        <div style={{ display: 'flex', gap: '4px', background: 'rgba(0,0,0,0.5)', padding: '4px', borderRadius: '4px' }}>
          <button style={{ cursor: 'pointer', padding: '2px 6px', fontSize: '12px' }} onClick={() => setSeason('sunny')}>Sunny</button>
          <button style={{ cursor: 'pointer', padding: '2px 6px', fontSize: '12px' }} onClick={() => setSeason('rainy')}>Rainy</button>
          <button style={{ cursor: 'pointer', padding: '2px 6px', fontSize: '12px' }} onClick={() => setSeason('snowy')}>Snowy</button>
          <button style={{ cursor: 'pointer', padding: '2px 6px', fontSize: '12px' }} onClick={() => setSeason('autumn')}>Autumn</button>
        </div>
      </div>

      {/* Crosshair */}
      {aimHeld && sim.controlMode === 'foot' && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            width: 12,
            height: 12,
            transform: 'translate(-50%, -50%)',
            border: '2px solid rgba(255, 255, 255, 0.8)',
            borderRadius: '50%',
            zIndex: 50,
            pointerEvents: 'none',
          }}
        >
          <div style={{ position: 'absolute', top: 5, left: 5, width: 2, height: 2, backgroundColor: 'red', borderRadius: '50%' }} />
        </div>
      )}

      {/* Vice City Style HUD */}
      <div
        style={{
          position: 'absolute',
          top: '2em',
          right: '2.5em',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          fontFamily: '"Impact", "Arial Black", sans-serif',
          zIndex: 10,
          textShadow: '2px 2px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 0 2px 0 #000, 2px 0 0 #000, 0 -2px 0 #000, -2px 0 0 #000',
        }}
      >
        {/* Time */}
        <div style={{ fontSize: '2.2vw', color: '#5ebdec', letterSpacing: '2px', lineHeight: 1.1 }}>
          {clock}
        </div>
        
        {/* Money */}
        <div style={{ fontSize: '2.5vw', color: '#5cc788', letterSpacing: '2px', lineHeight: 1.1 }}>
          ${String(mission.money).padStart(8, '0')}
        </div>

        {/* Health and Weapon Row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1vw', marginTop: '0.2em' }}>
          {/* Health */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4vw' }}>
            <svg width="2vw" height="2vw" viewBox="0 0 24 24" fill="#ff7eb3" style={{ filter: 'drop-shadow(2px 2px 0 #000)' }}>
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
            </svg>
            <span style={{ fontSize: '2.2vw', color: '#ff7eb3', letterSpacing: '2px' }}>
              {String(health).padStart(3, '0')}
            </span>
          </div>

          {/* Weapon */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', marginLeft: '1vw' }}>
            <div style={{ 
              width: '4vw', 
              height: '2.8vw', 
              background: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)', 
              borderRadius: '8px',
              border: '3px solid #fff',
              boxShadow: '2px 2px 0 #000',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              position: 'relative',
              overflow: 'hidden'
            }}>
              {/* Simple gun icon placeholder */}
              <div style={{ width: '2.5vw', height: '1.2vw', backgroundColor: '#333', borderRadius: '2px' }}>
                <div style={{ width: '0.8vw', height: '0.8vw', backgroundColor: '#333', position: 'absolute', bottom: '0.4vw', right: '1.2vw' }} />
              </div>
            </div>
            <div style={{ fontSize: '1.2vw', color: '#ff7eb3', letterSpacing: '1px', marginTop: '0.2vw' }}>
              73-9
            </div>
          </div>
        </div>

        {/* Wanted Level Stars */}
        <div style={{ display: 'flex', gap: '0.3vw', marginTop: '0.2vw', marginRight: '4vw' }}>
          {[...Array(6)].map((_, i) => (
            <svg key={i} width="1.8vw" height="1.8vw" viewBox="0 0 24 24" 
                 fill={i < police.wanted ? "#5ebdec" : "transparent"} 
                 stroke={i < police.wanted ? "none" : "#5ebdec"} 
                 strokeWidth="2"
                 style={{ filter: i < police.wanted ? 'drop-shadow(2px 2px 0 #000)' : 'none' }}>
              <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
            </svg>
          ))}
        </div>

        {/* Health and Stamina Bars */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4vw', marginTop: '1vw', width: '12vw', marginRight: '4vw' }}>
          {/* Health Bar */}
          <div style={{ width: '100%', height: '0.8vw', background: 'rgba(0,0,0,0.6)', border: '0.15vw solid black', borderRadius: '4px', overflow: 'hidden' }}>
            <div style={{ width: `${Math.max(0, health)}%`, height: '100%', background: '#ff3333', transition: 'width 0.2s' }} />
          </div>
          {/* Stamina Bar */}
          <div style={{ width: '100%', height: '0.6vw', background: 'rgba(0,0,0,0.6)', border: '0.15vw solid black', borderRadius: '4px', overflow: 'hidden' }}>
            <div style={{ width: `${Math.max(0, stamina)}%`, height: '100%', background: '#33ccff', transition: 'width 0.1s' }} />
          </div>
        </div>
      </div>

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
            {input.hasTouch ? 'Map button to skip' : 'M to skip'}
          </div>
        </div>
      )}

      {police.state === 'busted' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            backdropFilter: 'blur(4px)',
            zIndex: 100,
          }}
        >
          <div
            style={{
              fontFamily: '"Impact", "Arial Black", sans-serif',
              fontSize: '12vw',
              color: '#d32f2f',
              textShadow: '0 0 10px #000, 4px 4px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              transform: 'scale(1)',
              animation: 'busted-slam 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards',
            }}
          >
            Busted
          </div>
          <style>{`
            @keyframes busted-slam {
              0% { transform: scale(5); opacity: 0; }
              100% { transform: scale(1); opacity: 1; }
            }
          `}</style>
        </div>
      )}

      {(prompt || mission.promptLabel) && (
        <div className="hud__prompt">
          {!input.hasTouch && <span className="keycap">{mission.promptKey ?? prompt?.key}</span>}
          <span>{mission.promptLabel ?? prompt?.label}</span>
        </div>
      )}

      <WantedDisplay />

      {toast && <div className="hud__toast">{toast}</div>}

      {health < 100 && <HealthBar value={health} />}

      <DriveCluster />

      {/* CROSSHAIR */}
      <Crosshair />
      {/* WASTED screen */}
      {health <= 0 && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0,0,0,0.4)',
          color: '#d41111',
          fontSize: '120px',
          fontWeight: 900,
          fontFamily: '"Impact", "Pricedown", sans-serif',
          textShadow: '4px 4px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000',
          letterSpacing: '5px',
          pointerEvents: 'none',
          zIndex: 100000,
          animation: 'wastedFade 0.5s ease-out'
        }}>
          WASTED
          <style>
            {`
              @keyframes wastedFade {
                from { transform: scale(1.5); opacity: 0; }
                to { transform: scale(1); opacity: 1; }
              }
            `}
          </style>
        </div>
      )}
    </div>
  );
}

function Crosshair() {
  const show = useSimSample(() => sim.controlMode === 'foot' && sim.input.aimHeld, 12);
  
  if (!show) return null;
  return (
    <div style={{
      position: 'absolute',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: '4px',
      height: '4px',
      backgroundColor: 'rgba(255, 255, 255, 0.8)',
      borderRadius: '50%',
      pointerEvents: 'none'
    }}>
      <div style={{ position: 'absolute', top: -10, left: 1, width: 2, height: 8, backgroundColor: 'white' }} />
      <div style={{ position: 'absolute', bottom: -10, left: 1, width: 2, height: 8, backgroundColor: 'white' }} />
      <div style={{ position: 'absolute', left: -10, top: 1, width: 8, height: 2, backgroundColor: 'white' }} />
      <div style={{ position: 'absolute', right: -10, top: 1, width: 8, height: 2, backgroundColor: 'white' }} />
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
      const rot = sim.camera.yaw;
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
      if (route && route.length > 1 && (sim.mission.state === 'active' || sim.mission.state === 'available')) {
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
      if ((m.state === 'active' || m.state === 'available') && m.route && m.route.length > 0) {
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
      {`NEO TOKYO  dev overlay (F3)
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
    if (input.hasTouch) return [];
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
