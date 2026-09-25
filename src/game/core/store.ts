'use client';

import { create } from 'zustand';
import type { AppPhase, CameraMode, ControlMode, LoadTask, QualityPreset } from './types';
import { DEFAULT_PRESET } from '../config/quality';

/**
 * Discrete game/UI state (spec 33). Only values that change at human rates live
 * here — never per-frame transforms, which belong in `sim`.
 */

export interface Settings {
  // Camera / accessibility (spec 31)
  mouseSensitivity: number; // 0.2 .. 3
  invertY: boolean;
  fov: number; // 55 .. 95
  cameraShake: number; // 0 .. 1
  motionBlur: boolean;
  uiScale: number; // 0.8 .. 1.4
  subtitles: boolean;
  reducedFlashing: boolean;
  holdToSprint: boolean;
  // Graphics
  quality: QualityPreset;
  showFps: boolean;
  // Audio (spec 28)
  volMaster: number;
  volSfx: number;
  volAmbience: number;
  volDialogue: number;
  volMusic: number;
}

export const DEFAULT_SETTINGS: Settings = {
  mouseSensitivity: 1,
  invertY: false,
  fov: 62,
  cameraShake: 0.6,
  motionBlur: false,
  uiScale: 1,
  subtitles: true,
  reducedFlashing: false,
  holdToSprint: true,
  quality: DEFAULT_PRESET,
  showFps: false,
  volMaster: 0.8,
  volSfx: 0.9,
  volAmbience: 0.7,
  volDialogue: 1,
  volMusic: 0.5,
};

const SETTINGS_KEY = 'palmcoast.settings.v1';

function loadSettings(): Settings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** HUD values sampled from `sim` on a throttle, so the HUD re-renders ~10x/sec, not 60x. */
export interface HudState {
  speedKph: number;
  gear: string;
  rpm01: number;
  health: number;
  promptKey: string | null;
  promptLabel: string | null;
  objective: string | null;
  wantedLevel: number;
}

interface GameStore {
  phase: AppPhase;
  controlMode: ControlMode;
  cameraMode: CameraMode;
  settings: Settings;
  settingsLoaded: boolean;
  hud: HudState;
  loadTasks: LoadTask[];
  loadProgress: number; // 0..1, derived from real tasks
  errorMessage: string | null;
  pointerLocked: boolean;
  debugOverlay: boolean;
  showColliders: boolean;
  /** Set once a session has actually begun, so "Continue" is only offered truthfully. */
  hasSession: boolean;

  setPhase: (p: AppPhase) => void;
  setControlMode: (m: ControlMode) => void;
  setCameraMode: (m: CameraMode) => void;
  patchSettings: (s: Partial<Settings>) => void;
  resetSettings: () => void;
  hydrateSettings: () => void;
  patchHud: (h: Partial<HudState>) => void;
  setLoadTasks: (t: LoadTask[]) => void;
  updateLoadTask: (id: string, patch: Partial<LoadTask>) => void;
  setError: (msg: string | null) => void;
  setPointerLocked: (v: boolean) => void;
  toggleDebugOverlay: () => void;
  toggleColliders: () => void;
  setHasSession: (v: boolean) => void;
}

export const useGame = create<GameStore>((set, get) => ({
  phase: 'boot',
  controlMode: 'foot',
  cameraMode: 'tp-foot',
  settings: DEFAULT_SETTINGS,
  settingsLoaded: false,
  hud: {
    speedKph: 0,
    gear: 'N',
    rpm01: 0,
    health: 100,
    promptKey: null,
    promptLabel: null,
    objective: null,
    wantedLevel: 0,
  },
  loadTasks: [],
  loadProgress: 0,
  errorMessage: null,
  pointerLocked: false,
  debugOverlay: false,
  showColliders: false,
  hasSession: false,

  setPhase: (phase) => set({ phase }),
  setControlMode: (controlMode) => set({ controlMode }),
  setCameraMode: (cameraMode) => set({ cameraMode }),

  patchSettings: (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* private mode / storage disabled — settings simply stay session-only */
    }
  },
  resetSettings: () => {
    set({ settings: DEFAULT_SETTINGS });
    try {
      window.localStorage.removeItem(SETTINGS_KEY);
    } catch {
      /* ignore */
    }
  },
  hydrateSettings: () => set({ settings: loadSettings(), settingsLoaded: true }),

  patchHud: (patch) => set((s) => ({ hud: { ...s.hud, ...patch } })),

  setLoadTasks: (loadTasks) => set({ loadTasks, loadProgress: deriveProgress(loadTasks) }),
  updateLoadTask: (id, patch) =>
    set((s) => {
      const loadTasks = s.loadTasks.map((t) => (t.id === id ? { ...t, ...patch } : t));
      return { loadTasks, loadProgress: deriveProgress(loadTasks) };
    }),

  setError: (errorMessage) => set({ errorMessage, phase: errorMessage ? 'error' : get().phase }),
  setPointerLocked: (pointerLocked) => set({ pointerLocked }),
  toggleDebugOverlay: () => set((s) => ({ debugOverlay: !s.debugOverlay })),
  toggleColliders: () => set((s) => ({ showColliders: !s.showColliders })),
  setHasSession: (hasSession) => set({ hasSession }),
}));

/** Real progress: mean of per-task progress. No invented percentages (spec 30). */
function deriveProgress(tasks: LoadTask[]): number {
  if (tasks.length === 0) return 0;
  const sum = tasks.reduce((acc, t) => acc + (t.done ? 1 : Math.min(1, Math.max(0, t.progress))), 0);
  return sum / tasks.length;
}
