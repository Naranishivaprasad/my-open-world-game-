'use client';

import { useState } from 'react';
import { useGame, DEFAULT_SETTINGS, type Settings } from '../core/store';
import { ACTION_LABELS, REBINDABLE, keyLabel } from '../config/bindings';
import { input } from '../input/InputManager';
import type { QualityPreset } from '../core/types';

/**
 * Menus, settings and error states (spec 30, 31).
 *
 * Every control here changes a value a real system reads. Keyboard focus is
 * always visible and every screen is reachable without a mouse.
 */

// -------------------------------------------------------------- start screen

export function StartScreen({ onStart }: { onStart: () => void }) {
  const hasSession = useGame((s) => s.hasSession);
  const [panel, setPanel] = useState<'main' | 'settings' | 'controls' | 'credits'>('main');

  if (panel === 'settings') return <SettingsPanel onBack={() => setPanel('main')} />;
  if (panel === 'controls') return <ControlsPanel onBack={() => setPanel('main')} />;
  if (panel === 'credits') return <CreditsPanel onBack={() => setPanel('main')} />;

  return (
    <div className="overlay" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: '0', pointerEvents: 'none' }}>
      
      {/* Left side slanted panel */}
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: '45vw', background: 'rgba(35, 45, 60, 0.65)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', clipPath: 'polygon(0 0, 100% 0, 75% 100%, 0 100%)', boxShadow: '10px 0 30px rgba(0,0,0,0.5)', pointerEvents: 'none' }} />
      
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-start', height: '100%', padding: '0 6%', width: '40vw', pointerEvents: 'auto' }}>
        
        {/* Title Area */}
        <div style={{ marginBottom: '3rem' }}>
          <h1 
            style={{ 
              fontSize: '5.5rem', 
              lineHeight: 0.9, 
              fontWeight: 900,
              margin: '0',
              fontFamily: '"Arial Black", "Impact", sans-serif',
              textTransform: 'uppercase'
            }}
          >
            <div style={{ color: '#ffffff', textShadow: '0 4px 10px rgba(0,0,0,0.3)' }}>PALM</div>
            <div style={{ 
              background: 'linear-gradient(to right, #40e0d0, #00f0ff)', 
              WebkitBackgroundClip: 'text', 
              WebkitTextFillColor: 'transparent',
              filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.3))'
            }}>COAST</div>
          </h1>
          <div style={{ width: '40px', height: '3px', background: '#00f0ff', margin: '1rem 0 0.8rem 0' }} />
          <p style={{ color: '#d1d5db', fontSize: '0.9rem', letterSpacing: '0.15em', textTransform: 'uppercase', fontWeight: 600, margin: 0 }}>
            Open World Action Sandbox
          </p>
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '320px' }}>
          
          <button 
            className="btn" 
            onClick={onStart} 
            autoFocus
            style={{ 
              background: 'transparent',
              color: '#ffffff',
              border: '2px solid #fcee0a',
              borderRadius: '8px',
              padding: '1rem 1.5rem',
              fontSize: '1.2rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              textAlign: 'left',
              display: 'flex',
              alignItems: 'center',
              gap: '1rem',
              transition: 'all 0.2s',
              cursor: 'pointer'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(252, 238, 10, 0.1)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
          >
            <span style={{ width: '20px', height: '2px', background: '#ffffff' }}></span>
            <span>Start Game</span>
          </button>

          <button 
            className="btn" 
            disabled={!hasSession} 
            title={hasSession ? undefined : 'No session yet'}
            style={{ 
              background: 'transparent',
              color: hasSession ? '#ffffff' : 'rgba(255,255,255,0.3)',
              border: hasSession ? '2px solid transparent' : '2px solid transparent',
              borderRadius: '8px',
              padding: '1rem 1.5rem',
              fontSize: '1.2rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              textAlign: 'left',
              display: 'flex',
              alignItems: 'center',
              gap: '1rem',
              transition: 'all 0.2s',
              cursor: hasSession ? 'pointer' : 'default'
            }}
            onMouseEnter={(e) => { if(hasSession) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)' }}
            onMouseLeave={(e) => { if(hasSession) e.currentTarget.style.background = 'transparent' }}
          >
            <span style={{ width: '20px', height: '2px', background: hasSession ? '#ffffff' : 'rgba(255,255,255,0.3)' }}></span>
            <span>Continue</span>
          </button>

          <button 
            className="btn" 
            onClick={() => setPanel('settings')} 
            style={{ 
              background: 'transparent',
              color: '#ffffff',
              border: '2px solid transparent',
              borderRadius: '8px',
              padding: '1rem 1.5rem',
              fontSize: '1.2rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              textAlign: 'left',
              display: 'flex',
              alignItems: 'center',
              gap: '1rem',
              transition: 'all 0.2s',
              cursor: 'pointer'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
          >
            <span style={{ width: '20px', height: '2px', background: '#ffffff' }}></span>
            <span>Settings</span>
          </button>

          <div style={{ display: 'flex', gap: '2rem', marginTop: '2rem', paddingLeft: '1.5rem' }}>
            <button className="btn" onClick={() => setPanel('credits')} style={{ background: 'transparent', border: 'none', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.1em', fontSize: '0.8rem', padding: 0, cursor: 'pointer' }}>
              Credits
            </button>
            <button className="btn" onClick={() => setPanel('controls')} style={{ background: 'transparent', border: 'none', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.1em', fontSize: '0.8rem', padding: 0, cursor: 'pointer' }}>
              Controls
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------- pause menu

export function PauseMenu({
  onResume,
  onQuit,
  onRestartMission,
  onAbandonMission,
  missionState,
}: {
  onResume: () => void;
  onQuit: () => void;
  onRestartMission?: () => void;
  onAbandonMission?: () => void;
  missionState?: string;
}) {
  const [panel, setPanel] = useState<'main' | 'settings' | 'controls'>('main');
  const [confirmAbandon, setConfirmAbandon] = useState(false);

  if (panel === 'settings') return <SettingsPanel onBack={() => setPanel('main')} />;
  if (panel === 'controls') return <ControlsPanel onBack={() => setPanel('main')} />;

  return (
    <div className="overlay overlay--scrim">
      <div className="panel panel--narrow">
        <p className="eyebrow">Paused</p>
        <h2 style={{ margin: '0.1em 0 0', fontSize: '1.6em' }}>Palm Coast</h2>
        <div className="menu-list">
          <button className="btn btn--primary btn--wide" onClick={onResume} autoFocus>
            <span>Resume</span>
            <span className="hint" style={{ color: 'inherit', opacity: 0.7 }}>
              Esc
            </span>
          </button>
          {onRestartMission && (
            <button className="btn btn--wide" onClick={onRestartMission}>
              <span>Restart mission</span>
              <span className="hint">First Delivery</span>
            </button>
          )}

          {onAbandonMission && missionState === 'active' && !confirmAbandon && (
            <button className="btn btn--wide" onClick={() => setConfirmAbandon(true)}>
              <span>Abandon mission</span>
            </button>
          )}
          {onAbandonMission && confirmAbandon && (
            <button
              className="btn btn--wide"
              style={{ borderColor: 'var(--danger)' }}
              onClick={() => {
                onAbandonMission();
                setConfirmAbandon(false);
              }}
              autoFocus
            >
              <span>Really abandon it?</span>
              <span className="hint">click to confirm</span>
            </button>
          )}

          <button className="btn btn--wide" onClick={() => setPanel('settings')}>
            <span>Settings</span>
          </button>
          <button className="btn btn--wide" onClick={() => setPanel('controls')}>
            <span>Controls</span>
          </button>
          <button className="btn btn--wide" onClick={onQuit}>
            <span>Quit to menu</span>
            <span className="hint">progress is not saved</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- settings

export function SettingsPanel({ onBack }: { onBack: () => void }) {
  const settings = useGame((s) => s.settings);
  const patch = useGame((s) => s.patchSettings);
  const reset = useGame((s) => s.resetSettings);

  const num = (key: keyof Settings, label: string, min: number, max: number, step: number, fmt?: (v: number) => string) => (
    <div className="field" key={key}>
      <label htmlFor={`set-${key}`}>{label}</label>
      <span className="field__value">{fmt ? fmt(settings[key] as number) : (settings[key] as number).toFixed(2)}</span>
      <input
        id={`set-${key}`}
        type="range"
        min={min}
        max={max}
        step={step}
        value={settings[key] as number}
        onChange={(e) => patch({ [key]: Number(e.target.value) } as Partial<Settings>)}
        style={{ gridColumn: '1 / -1' }}
      />
    </div>
  );

  const bool = (key: keyof Settings, label: string) => (
    <div className="field" key={key}>
      <label htmlFor={`set-${key}`}>{label}</label>
      <input
        id={`set-${key}`}
        type="checkbox"
        checked={settings[key] as boolean}
        onChange={(e) => patch({ [key]: e.target.checked } as Partial<Settings>)}
      />
    </div>
  );

  return (
    <div className="overlay overlay--scrim">
      <div className="panel">
        <p className="eyebrow">Settings</p>
        <h2 style={{ margin: 0, fontSize: '1.5em' }}>Preferences</h2>

        <div className="settings-grid">
          <div>
            <h2 className="section">Camera &amp; accessibility</h2>
            {num('mouseSensitivity', 'Mouse sensitivity', 0.2, 3, 0.05)}
            {bool('invertY', 'Invert vertical look')}
            {num('fov', 'Field of view', 55, 95, 1, (v) => `${v}°`)}
            {num('cameraShake', 'Camera shake', 0, 1, 0.05)}
            {num('uiScale', 'UI scale', 0.8, 1.4, 0.05, (v) => `${Math.round(v * 100)}%`)}
            {bool('holdToSprint', 'Hold to sprint')}
            {bool('subtitles', 'Subtitles')}
            {bool('reducedFlashing', 'Reduce flashing')}
          </div>

          <div>
            <h2 className="section">Graphics</h2>
            <div className="field">
              <label htmlFor="set-quality">Quality preset</label>
              <select
                id="set-quality"
                value={settings.quality}
                onChange={(e) => patch({ quality: e.target.value as QualityPreset })}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            {bool('motionBlur', 'Motion blur')}
            {bool('showFps', 'Show frame rate')}
            <p className="hint" style={{ marginTop: '0.8em' }}>
              Preset changes apply to shadows, view distance, vegetation density and render
              resolution. Some changes take effect on the next session.
            </p>

            <h2 className="section">Audio</h2>
            {num('volMaster', 'Master', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`)}
            {num('volSfx', 'Effects', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`)}
            {num('volAmbience', 'Ambience', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`)}
            {num('volMusic', 'Music', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`)}
            <p className="hint">
              Master and Effects control the synthesised engine, tyre and horn audio.
              <br />
              <span className="badge badge--warn">Not wired</span> Ambience, dialogue and music
              have no sources yet, so those two sliders are stored but unused.
            </p>
          </div>
        </div>

        <div className="btn-row">
          <button className="btn btn--primary" onClick={onBack} autoFocus>
            Back
          </button>
          <button className="btn" onClick={reset}>
            Reset to defaults
          </button>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- controls

export function ControlsPanel({ onBack }: { onBack: () => void }) {
  const bindings = input.getBindings();

  return (
    <div className="overlay overlay--scrim">
      <div className="panel">
        <p className="eyebrow">Controls</p>
        <h2 style={{ margin: 0, fontSize: '1.5em' }}>Keyboard &amp; mouse</h2>

        <div className="settings-grid">
          <div>
            <h2 className="section">On foot</h2>
            {REBINDABLE.filter((a) => !a.startsWith('debug')).map((action) => (
              <div className="field" key={action}>
                <label>{ACTION_LABELS[action]}</label>
                <span className="field__value" style={{ minWidth: '7em' }}>
                  {bindings[action].map(keyLabel).join(' / ')}
                </span>
              </div>
            ))}
          </div>
          <div>
            <h2 className="section">System</h2>
            <div className="field">
              <label>Pause / release mouse</label>
              <span className="field__value">Esc</span>
            </div>
            <div className="field">
              <label>Dev overlay</label>
              <span className="field__value">F3</span>
            </div>
            <div className="field">
              <label>Collider wireframes</label>
              <span className="field__value">F4</span>
            </div>
            <h2 className="section">Driving</h2>
            <div className="field">
              <label>Accelerate / brake &amp; reverse</label>
              <span className="field__value">W / S</span>
            </div>
            <div className="field">
              <label>Steer</label>
              <span className="field__value">A / D</span>
            </div>
            <div className="field">
              <label>Handbrake</label>
              <span className="field__value">Space</span>
            </div>
            <div className="field">
              <label>Chase / cockpit camera</label>
              <span className="field__value">V</span>
            </div>
            <div className="field">
              <label>Recover a flipped car</label>
              <span className="field__value">R</span>
            </div>
            <p className="hint" style={{ marginTop: '1em' }}>
              <span className="badge badge--warn">Not yet</span> Rebinding UI and gamepad support
              are not implemented. Bindings are remappable in code only.
            </p>
          </div>
        </div>

        <div className="btn-row">
          <button className="btn btn--primary" onClick={onBack} autoFocus>
            Back
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ credits

export function CreditsPanel({ onBack }: { onBack: () => void }) {
  return (
    <div className="overlay overlay--scrim">
      <div className="panel">
        <p className="eyebrow">Credits</p>
        <h2 style={{ margin: 0, fontSize: '1.5em' }}>Third-party assets</h2>
        <p className="hint" style={{ marginTop: '0.6em' }}>
          PALM COAST is an original work. It is not affiliated with, endorsed by, or derived from
          any commercial game. No assets were extracted from another game.
        </p>

        <h2 className="section">Character rig &amp; animation</h2>
        <p style={{ fontSize: '0.9em', margin: 0 }}>
          <strong>Universal Animation Library (Standard)</strong> by Quaternius &mdash; CC0 1.0
          Universal (public domain dedication).
          <br />
          <span className="hint">
            53-joint rig, mannequin body and 46 clips. Source: opengameart.org/content/universal-animation-library
            &middot; Licence: creativecommons.org/publicdomain/zero/1.0/
          </span>
        </p>

        <h2 className="section">Hero vehicle &mdash; attribution required</h2>
        <p style={{ fontSize: '0.9em', margin: 0 }}>
          <strong>CarConcept</strong> by Eric Chadwick / Darmstadt Graphics Group GmbH &mdash;
          licensed <strong>CC BY 4.0</strong>, from the Khronos glTF Sample Assets repository.
          <br />
          <span className="hint">
            creativecommons.org/licenses/by/4.0/ &middot;
            github.com/KhronosGroup/glTF-Sample-Assets
            <br />
            That licence excludes logos and trademarks, so the Khronos steering emblem and the
            licence plate are removed at load. The transmissive glass material was replaced with
            alpha blending for performance.
          </span>
        </p>

        <h2 className="section">Environment &amp; sky</h2>
        <p style={{ fontSize: '0.9em', margin: 0 }}>
          <strong>aristea_wreck_puresky</strong> HDRI by Poly Haven &mdash; CC0 1.0.
          <br />
          <span className="hint">polyhaven.com/a/aristea_wreck_puresky &middot; polyhaven.com/license</span>
        </p>

        <h2 className="section">Surface materials</h2>
        <p style={{ fontSize: '0.9em', margin: 0 }}>
          <strong>Asphalt033, Concrete034, PaintedPlaster017, Bricks104, Grass004,
          CorrugatedSteel005, Ground037</strong> by ambientCG (Lennart Demes) &mdash; CC0 1.0.
          <br />
          <span className="hint">ambientcg.com &middot; docs.ambientcg.com/license/</span>
        </p>

        <h2 className="section">Engine &amp; libraries</h2>
        <p className="hint" style={{ margin: 0 }}>
          three.js (MIT) &middot; React Three Fiber and Drei (MIT) &middot; Rapier physics, via
          @react-three/rapier (Apache-2.0) &middot; Next.js (MIT) &middot; Zustand (MIT)
        </p>

        <p className="hint" style={{ marginTop: '1.2em' }}>
          The hero vehicle is CC BY 4.0, which <strong>requires</strong> the attribution above.
          Everything else is CC0, a public-domain dedication that requires none &mdash; those are
          credited here anyway.
        </p>

        <div className="btn-row">
          <button className="btn btn--primary" onClick={onBack} autoFocus>
            Back
          </button>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------- misc

/**
 * Pointer lock needs a user gesture and can be refused outright (spec 35), so
 * this is an explicit, explained affordance rather than a silent failure.
 */
export function ClickToPlay({ denied, onClick }: { denied: boolean; onClick: () => void }) {
  return (
    <div
      className="overlay"
      style={{ background: 'rgba(8,11,15,0.35)', cursor: 'pointer' }}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onClick();
      }}
    >
      <div className="panel panel--narrow" style={{ textAlign: 'center', pointerEvents: 'none' }}>
        <p className="eyebrow">{denied ? 'Mouse capture blocked' : 'Ready'}</p>
        <p style={{ margin: '0.2em 0 0', fontSize: '1.15em', fontWeight: 600 }}>
          {denied ? 'Your browser refused pointer lock' : 'Click to look around'}
        </p>
        <p className="hint" style={{ marginTop: '0.7em' }}>
          {denied
            ? 'This usually happens inside an embedded preview or if the page lost focus. Open the game in its own browser tab, then click again. Movement keys still work without mouse look.'
            : 'The mouse will be captured. Press Esc at any time to release it and pause.'}
        </p>
      </div>
    </div>
  );
}

export function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="overlay overlay--scrim">
      <div className="panel panel--narrow">
        <p className="eyebrow">Something went wrong</p>
        <div className="error-box">{message}</div>
        <div className="btn-row">
          <button className="btn btn--primary" onClick={() => window.location.reload()} autoFocus>
            Reload
          </button>
        </div>
      </div>
    </div>
  );
}

export { DEFAULT_SETTINGS };
