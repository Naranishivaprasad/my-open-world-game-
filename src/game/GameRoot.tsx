'use client';

import * as THREE from 'three';
import { Suspense, use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Physics } from '@react-three/rapier';
import { useProgress } from '@react-three/drei';
import { useGame } from './core/store';
import { QUALITY_PRESETS } from './config/quality';
import { input } from './input/InputManager';
import { resetSim, sim } from './core/sim';
import { MaterialLibrary, type MaterialKey } from './world/materials';
import { World } from './world/World';
import { Lighting } from './world/Lighting';
import { Player, FIXED_DT } from './character/Player';
import { CameraRig } from './camera/CameraRig';
import type { CharacterController } from './character/CharacterController';
import type { Animator } from './character/Animator';
import { HeroVehicle } from './vehicle/HeroVehicle';
import { VehicleSystems } from './vehicle/VehicleSystems';
import { Traffic } from './traffic/Traffic';
import { Pedestrians } from './traffic/Pedestrians';
import type { TrafficSystem } from './traffic/TrafficSystem';
import { Police } from './police/Police';
import { OffenceWatcher } from './police/OffenceWatcher';
import type { PoliceSystem } from './police/PoliceSystem';
import type { PedestrianSystem } from './traffic/PedestrianSystem';
import { Mission } from './mission/Mission';
import type { MissionSystem } from './mission/MissionSystem';
import type { VehicleController } from './vehicle/VehicleController';
import type { VehicleOwner } from './vehicle/VehicleOwner';
import { HUD, DebugOverlay, Onboarding } from './ui/HUD';
import { MapScreen } from './ui/MapScreen';
import { MobileControls } from './ui/MobileControls';
import { StatsProbe } from './debug/StatsProbe';
import { AudioDriver } from './audio/AudioDriver';
import { audio } from './audio/AudioSystem';
import { StartScreen, PauseMenu, ErrorScreen, ClickToPlay } from './ui/Menus';
import { HAZE } from './config/world';
import { DEBUG_HOOKS } from './core/sim';

/**
 * Top-level game shell (spec 30, 33).
 *
 * Owns application phase, input ownership, pointer lock and the render surface.
 * The 3D scene lives under a Suspense boundary so the loading screen reflects
 * genuine loader progress rather than an invented percentage.
 */

const MATERIAL_KEYS: MaterialKey[] = [
  'asphalt',
  'concrete',
  'plaster',
  'brick',
  'grass',
  'corrugated',
  'dirt',
];

/** Module-level cache so the library is built once and can suspend on. */
let materialsPromise: Promise<MaterialLibrary> | null = null;
function getMaterials(anisotropy: number): Promise<MaterialLibrary> {
  if (!materialsPromise) {
    const lib = new MaterialLibrary(anisotropy);
    materialsPromise = lib.load(MATERIAL_KEYS).then(() => lib);
  }
  return materialsPromise;
}

export default function GameRoot() {
  const phase = useGame((s) => s.phase);
  const settings = useGame((s) => s.settings);
  const settingsLoaded = useGame((s) => s.settingsLoaded);
  const errorMessage = useGame((s) => s.errorMessage);
  const pointerLocked = useGame((s) => s.pointerLocked);
  const debugOverlay = useGame((s) => s.debugOverlay);
  const setPhase = useGame((s) => s.setPhase);
  const setPointerLocked = useGame((s) => s.setPointerLocked);
  const setError = useGame((s) => s.setError);
  const hydrateSettings = useGame((s) => s.hydrateSettings);
  const toggleDebugOverlay = useGame((s) => s.toggleDebugOverlay);
  const toggleColliders = useGame((s) => s.toggleColliders);
  const setHasSession = useGame((s) => s.setHasSession);

  const containerRef = useRef<HTMLDivElement>(null);
  const missionRef = useRef<MissionSystem | null>(null);
  const [worldReady, setWorldReady] = useState(false);
  const [pointerLockDenied, setPointerLockDenied] = useState(false);
  const [contextLost, setContextLost] = useState(false);

  const quality = QUALITY_PRESETS[settings.quality];

  // Settings come from localStorage; they are a preference store, NOT a save
  // game (spec 32 - no pretending session state is persistence).
  useEffect(() => {
    hydrateSettings();
  }, [hydrateSettings]);

  useEffect(() => {
    document.documentElement.style.setProperty('--ui-scale', String(settings.uiScale));
  }, [settings.uiScale]);

  // ---------------------------------------------------------------- input

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    input.attach(el);

    const hasTouch = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
    input.hasTouch = hasTouch;

    input.onPointerLockChange = (locked) => {
      setPointerLocked(locked);
      if (locked) setPointerLockDenied(false);
    };
    input.onPointerLockError = () => setPointerLockDenied(true);

    return () => {
      audio.dispose();
      input.detach();
      input.onPointerLockChange = undefined;
      input.onPointerLockError = undefined;
      input.onPause = undefined;
      input.onMap = undefined;
    };
  }, [setPointerLocked]);

  // The map toggles between playing and a paused full-screen map.
  useEffect(() => {
    input.onMap = () => {
      const current = useGame.getState().phase;
      // While a character is talking, the map key skips the line instead; the
      // mission system consumes it.
      if (current === 'playing' && sim.mission.dialogue) return;
      if (current === 'playing') {
        setPhase('map');
        input.exitPointerLock();
      } else if (current === 'map') {
        setPhase('playing');
      }
    };
  }, [setPhase]);

  // Pause is wired separately because it depends on the current phase.
  useEffect(() => {
    input.onPause = () => {
      const current = useGame.getState().phase;
      if (current === 'playing') {
        setPhase('paused');
        input.exitPointerLock();
      } else if (current === 'paused' || current === 'map') {
        setPhase('playing');
      }
    };
  }, [setPhase]);

  /**
   * Gameplay owns input only while playing AND pointer-locked (spec 31).
   *
   * Losing pointer lock (alt-tab, browser Esc) therefore stops movement and
   * surfaces the ClickToPlay prompt instead of leaving the player with a live
   * character and a dead camera.
   */
  useEffect(() => {
    input.setGameplayEnabled(phase === 'playing' && (pointerLocked || input.hasTouch));
    if (phase !== 'playing') input.exitPointerLock();
  }, [phase, pointerLocked, input.hasTouch]);

  // Dev-only overlay toggles.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'F3') {
        e.preventDefault();
        toggleDebugOverlay();
      }
      if (e.code === 'F4') {
        e.preventDefault();
        toggleColliders();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleDebugOverlay, toggleColliders]);

  // ---------------------------------------------------------------- phases

  const handleMissionReady = useCallback((m: MissionSystem) => {
    missionRef.current = m;
  }, []);

  const startGame = useCallback(() => {
    resetSim();
    // A new session re-arms the mission from scratch: no carried crate, no
    // stale markers, no second reward (spec 24).
    missionRef.current?.restart();
    setHasSession(true);
    
    // Jump straight into the game, as the world is already loaded!
    setPhase('playing');

    if (input.hasTouch && typeof screen !== 'undefined' && screen.orientation && (screen.orientation as any).lock) {
      (screen.orientation as any).lock('landscape').catch(() => {
        // Silently ignore if the browser doesn't support orientation lock or denies it
      });
    }
  }, [setPhase, setHasSession, worldReady]);

  const handleWorldReady = useCallback(() => {
    setWorldReady(true);
    // After initial load, go to the main menu! 
    if (useGame.getState().phase === 'loading') {
      setPhase('menu');
    }
  }, [setPhase]);

  const resume = useCallback(() => {
    setPhase('playing');
  }, [setPhase]);

  const quitToMenu = useCallback(() => {
    input.exitPointerLock();
    setPhase('menu');
  }, [setPhase]);

  const requestLock = useCallback(() => {
    input.setGameplayEnabled(true);
    input.requestPointerLock();
    // Browsers only allow audio to start from a user gesture (spec 28); this
    // click is that gesture.
    void audio.start();
  }, []);

  // ------------------------------------------------------------- rendering

  const showCanvas =
    phase === 'menu' || phase === 'loading' || phase === 'playing' || phase === 'paused' || phase === 'map';

  return (
    <div
      ref={containerRef}
      style={{ position: 'absolute', inset: 0, background: HAZE.color }}
      tabIndex={-1}
    >
      {showCanvas && !contextLost && (
        <Canvas
          /*
           * R3F sets the shadow map type ITSELF from this prop, in an effect
           * that runs after onCreated - so setting gl.shadowMap.type by hand
           * was silently overwritten. Passing the string maps to PCFShadowMap
           * ('percentage'); the boolean form maps to PCFSoftShadowMap, which
           * three 0.186 has removed.
           */
          shadows={quality.shadowsEnabled ? 'percentage' : false}
          dpr={[1, quality.maxPixelRatio]}
          gl={{
            antialias: quality.antialias,
            powerPreference: 'high-performance',
            alpha: false,
            stencil: false,
          }}
          camera={{ fov: settings.fov, near: 0.15, far: quality.viewDistance, position: [0, 3, 8] }}
          onCreated={({ gl, scene }) => {
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 1.02;
            sim.scene = scene;
            if (DEBUG_HOOKS && typeof window !== 'undefined') {
              const w = window as unknown as { __PALM__?: Record<string, unknown> };
              w.__PALM__ = {
                ...(w.__PALM__ ?? {}),
                renderer: gl,
                setHour: (h: number) => {
                  sim.time.hour = ((h % 24) + 24) % 24;
                },
                setTimeScale: (s: number) => {
                  sim.time.scale = s;
                },
              };
            }

            const canvas = gl.domElement;
            canvas.addEventListener('webglcontextlost', (e) => {
              e.preventDefault();
              setContextLost(true);
              setError(
                'The graphics context was lost. This usually means the GPU driver reset or another application took over. Reload to continue.',
              );
            });
          }}
        >
          <Suspense fallback={null}>
            <GameScene
              anisotropy={quality.maxPixelRatio >= 2 ? 8 : 4}
              onReady={handleWorldReady}
              paused={phase !== 'playing'}
              phase={phase}
              fov={settings.fov}
              qualityKey={settings.quality}
              onMissionReady={handleMissionReady}
              sensitivity={settings.mouseSensitivity}
              invertY={settings.invertY}
            />
          </Suspense>
        </Canvas>
      )}

      {phase === 'menu' && <StartScreen onStart={startGame} />}
      {phase === 'loading' && <LoadingOverlay />}
      {phase === 'paused' && (
        <PauseMenu
          onResume={resume}
          onQuit={quitToMenu}
          missionState={sim.mission.state}
          onRestartMission={() => {
            missionRef.current?.restart();
            setPhase('playing');
          }}
          onAbandonMission={() => {
            missionRef.current?.abandon();
            setPhase('playing');
          }}
        />
      )}
      {phase === 'map' && <MapScreen onClose={() => setPhase('playing')} />}
      {phase === 'error' && <ErrorScreen message={errorMessage ?? 'Unknown error'} />}

      {phase === 'playing' && worldReady && (
        <>
          <HUD />
          {input.hasTouch && <MobileControls />}
          <Onboarding />
          {debugOverlay && <DebugOverlay />}
          {!pointerLocked && !input.hasTouch && <ClickToPlay denied={pointerLockDenied} onClick={requestLock} />}
        </>
      )}

      {!settingsLoaded && phase === 'boot' && <BootGate onReady={() => setPhase('loading')} />}
      
      {/* Block portrait mode and prompt rotation */}
      {input.hasTouch && <PortraitBlocker />}
    </div>
  );
}

function PortraitBlocker() {
  const [isPortrait, setIsPortrait] = useState(false);

  useEffect(() => {
    const checkOrientation = () => {
      setIsPortrait(window.innerHeight > window.innerWidth);
    };
    checkOrientation();
    window.addEventListener('resize', checkOrientation);
    return () => window.removeEventListener('resize', checkOrientation);
  }, []);

  if (!isPortrait) return null;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 999999,
        background: '#0b0e12',
        color: 'white',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '2em',
      }}
    >
      <div style={{ fontSize: '3em', marginBottom: '0.2em' }}>↻</div>
      <h2 style={{ fontSize: '1.5em', marginBottom: '0.5em', color: 'var(--accent)' }}>Please Rotate Your Device</h2>
      <p style={{ color: 'var(--ink-dim)', marginBottom: '1.5em', maxWidth: '300px' }}>
        PALM COAST is designed to be played in Landscape mode. Turn your phone sideways to continue playing.
      </p>
      <button 
        className="btn btn--primary"
        onClick={async () => {
          try {
            if (document.documentElement.requestFullscreen) {
              await document.documentElement.requestFullscreen();
            }
            if (screen.orientation && (screen.orientation as any).lock) {
              await (screen.orientation as any).lock('landscape');
            }
          } catch (e) {}
        }}
      >
        Force Landscape (Fullscreen)
      </button>
    </div>
  );
}


/** Moves out of the boot phase once settings have hydrated. */
function BootGate({ onReady }: { onReady: () => void }) {
  useEffect(() => {
    onReady();
  }, [onReady]);
  return null;
}

/** Genuine loader progress from three's loading manager (spec 30). */
function LoadingOverlay() {
  const { progress, item, loaded, total } = useProgress();
  return (
    <div 
      className="overlay" 
      style={{ 
        display: 'flex', 
        alignItems: 'flex-end', 
        justifyContent: 'flex-end', 
        padding: '3rem', 
        color: '#fff',
        background: '#000000',
        fontFamily: 'system-ui, -apple-system, sans-serif'
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
        <h1 
          style={{ 
            fontSize: '1.5rem', 
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            margin: '0 0 1rem 0',
            color: '#ffffff'
          }}
        >
          Loading Palm Coast... {Math.round(progress)}%
        </h1>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', fontSize: '0.8rem', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          <span>{total > 0 ? `${loaded} / ${total} Assets` : 'Preparing'}</span>
        </div>
      </div>
    </div>
  );
}

function shortName(url: string) {
  try {
    return url.split('/').slice(-2).join('/');
  } catch {
    return url;
  }
}

/**
 * Everything inside the Canvas. Suspends until materials and the character GLB
 * have loaded, which is what drives the loading screen.
 */
function GameScene({
  anisotropy,
  onReady,
  onMissionReady,
  paused,
  phase,
  fov,
  qualityKey,
  sensitivity,
  invertY,
}: {
  anisotropy: number;
  onReady: () => void;
  onMissionReady: (m: MissionSystem) => void;
  paused: boolean;
  phase: string;
  fov: number;
  qualityKey: keyof typeof QUALITY_PRESETS;
  sensitivity: number;
  invertY: boolean;
}) {
  const materials = use(getMaterials(anisotropy));
  const quality = QUALITY_PRESETS[qualityKey];
  const showColliders = useGame((s) => s.showColliders);
  const cameraMode = useGame((s) => s.cameraMode);
  const [controller, setController] = useState<CharacterController | null>(null);
  const [vehicle, setVehicle] = useState<VehicleController | null>(null);
  const [vehicleOwner, setVehicleOwner] = useState<VehicleOwner | null>(null);
  const [animator, setAnimator] = useState<Animator | null>(null);
  const [traffic, setTraffic] = useState<TrafficSystem | null>(null);
  const [police, setPolice] = useState<PoliceSystem | null>(null);
  const [pedestrians, setPedestrians] = useState<PedestrianSystem | null>(null);

  useEffect(() => {
    onReady();
  }, [onReady]);

  return (
    <>
      <InputPump sensitivity={sensitivity} invertY={invertY} paused={paused} />
      <Lighting quality={quality} />

      <Physics
        timeStep={FIXED_DT}
        interpolate
        paused={paused}
        updateLoop="follow"
        gravity={[0, -19, 0]}
        debug={showColliders}
      >
        <World materials={materials} quality={quality} />
        <Player onReady={setController} onAnimator={setAnimator} />
        <HeroVehicle onReady={setVehicle} onOwner={setVehicleOwner} />
        <VehicleSystems character={controller} vehicle={vehicle} owner={vehicleOwner} animator={animator} />
        <Traffic quality={quality} onReady={setTraffic} />
        <Pedestrians quality={quality} traffic={traffic} onReady={setPedestrians} />
        <Police quality={quality} onReady={setPolice} />
        <OffenceWatcher police={police} pedestrians={pedestrians} traffic={traffic} />
        <Mission onReady={onMissionReady} police={police} />
        <StatsProbe />
        <AudioDriver />
        {/*
          The camera lives INSIDE <Physics> because it shape-casts against the
          world to keep its boom out of walls, and useRapier() is only available
          within that provider. Mounting it last also means its useFrame runs
          after the physics step, so it follows an already-updated player.
        */}
        <CameraRig
          fov={fov}
          mode={cameraMode}
          phase={phase}
          playerCollider={controller?.collider ?? null}
          vehicle={vehicle}
          enabled={!paused}
        />
      </Physics>
    </>
  );
}

/**
 * Samples the input manager once per frame, before any system reads sim.input.
 *
 * This component is mounted FIRST inside the scene, and R3F runs priority-0
 * useFrame callbacks in subscription (mount) order, so input is always fresh by
 * the time the physics step and the camera read it. Priority is deliberately
 * left at 0: any value above 0 makes R3F hand the render loop to the caller.
 *
 * Edge-triggered flags need no end-of-frame clear - InputManager.update()
 * rewrites every one of them from consumePress() each frame, so a press that
 * did not happen this frame reads as false.
 */
function InputPump({
  sensitivity,
  invertY,
  paused,
}: {
  sensitivity: number;
  invertY: boolean;
  paused: boolean;
}) {
  useFrame((_, delta) => {
    // Clamp so a long stall (tab suspended) cannot produce a huge step (spec 35).
    sim.dt = Math.min(delta, 0.1);
    input.update(sensitivity, invertY);
    if (!paused) sim.elapsed += sim.dt;
  });
  return null;
}
