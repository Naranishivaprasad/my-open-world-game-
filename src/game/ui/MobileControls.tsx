'use client';

import React, { useRef, useEffect, useState } from 'react';
import { input } from '../input/InputManager';
import type { GameAction } from '../config/bindings';
import { sim } from '../core/sim';

import { useGame } from '../core/store';

export function MobileControls() {
  const controlMode = useGame(state => state.controlMode);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 50,
        display: 'flex',
        justifyContent: 'space-between',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      {controlMode === 'vehicle' ? <VehicleMovementArea /> : <MovementArea />}
      {controlMode === 'vehicle' ? <VehicleActionArea /> : <LookAndActionArea />}
    </div>
  );
}

function MovementArea() {
  const containerRef = useRef<HTMLDivElement>(null);
  const touchIdRef = useRef<number | null>(null);
  const [nubOffset, setNubOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const getBaseCenter = () => {
      const rect = el.getBoundingClientRect();
      return { x: 100, y: rect.height - 100 };
    };

    const handleTouchStart = (e: TouchEvent) => {
      if ((e.target as HTMLElement).tagName === 'BUTTON') return;
      e.preventDefault();
      if (touchIdRef.current !== null) return;
      
      const touch = e.changedTouches[0];
      if (!touch) return;

      const rect = el.getBoundingClientRect();
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;
      const center = getBaseCenter();
      
      // Only capture touch if it's within a reasonable distance of the joystick base
      if (Math.hypot(x - center.x, y - center.y) > 120) return;

      touchIdRef.current = touch.identifier;
      updateJoystick(x, y, center);
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (touchIdRef.current === null) return;
      let touch: Touch | undefined;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === touchIdRef.current) {
          touch = e.changedTouches[i];
          break;
        }
      }
      if (!touch) return;

      const rect = el.getBoundingClientRect();
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;
      updateJoystick(x, y, getBaseCenter());
    };

    const updateJoystick = (x: number, y: number, center: { x: number; y: number }) => {
      const dx = x - center.x;
      const dy = y - center.y;
      const maxRadius = 40;
      const dist = Math.hypot(dx, dy);

      let clampedX = dx;
      let clampedY = dy;
      if (dist > maxRadius) {
        clampedX = (dx / dist) * maxRadius;
        clampedY = (dy / dist) * maxRadius;
      }

      setNubOffset({ x: clampedX, y: clampedY });

      input.mobileMoveX = clampedX / maxRadius;
      input.mobileMoveZ = clampedY / maxRadius;
    };

    const handleTouchEnd = (e: TouchEvent) => {
      e.preventDefault();
      if (touchIdRef.current === null) return;
      let ended = false;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === touchIdRef.current) {
          ended = true;
          break;
        }
      }
      if (!ended) return;

      touchIdRef.current = null;
      setNubOffset({ x: 0, y: 0 });
      input.mobileMoveX = 0;
      input.mobileMoveZ = 0;
    };

    el.addEventListener('touchstart', handleTouchStart, { passive: false });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd, { passive: false });
    el.addEventListener('touchcancel', handleTouchEnd, { passive: false });

    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
      el.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        width: '40%',
        height: '100%',
        pointerEvents: 'auto',
        position: 'relative',
        touchAction: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 60,
          bottom: 60,
          width: 80,
          height: 80,
          borderRadius: '50%',
          background: 'rgba(255, 255, 255, 0.1)',
          border: '2px solid rgba(255, 255, 255, 0.3)',
          boxSizing: 'border-box',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 60 + 20 + nubOffset.x,
          bottom: 60 + 20 - nubOffset.y,
          width: 40,
          height: 40,
          borderRadius: '50%',
          background: 'rgba(255, 255, 255, 0.6)',
          boxSizing: 'border-box',
        }}
      />
    </div>
  );
}

function VehicleMovementArea() {
  return (
    <div style={{ width: '40%', height: '100%', pointerEvents: 'auto', position: 'relative', touchAction: 'none' }}>
      <div style={{ position: 'absolute', bottom: 40, left: 40, display: 'flex', gap: 20 }}>
        <ActionButton action="moveLeft" label="Left" size={70} />
        <ActionButton action="moveRight" label="Right" size={70} />
      </div>
    </div>
  );
}

function LookAndActionArea() {
  const lookRef = useRef<HTMLDivElement>(null);
  const lastTouchRef = useRef<{ id: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const el = lookRef.current;
    if (!el) return;

    const handleTouchStart = (e: TouchEvent) => {
      // Ensure we're not touching a button
      if ((e.target as HTMLElement).tagName === 'BUTTON' || (e.target as HTMLElement).closest('button')) return;
      e.preventDefault();
      
      // Ignore if we already track a look touch
      if (lastTouchRef.current !== null) return;
      const touch = e.changedTouches[0];
      if (!touch) return;

      lastTouchRef.current = { id: touch.identifier, x: touch.clientX, y: touch.clientY };
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (lastTouchRef.current === null) return;
      let touch: Touch | undefined;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === lastTouchRef.current.id) {
          touch = e.changedTouches[i];
          break;
        }
      }
      if (!touch) return;

      const dx = touch.clientX - lastTouchRef.current.x;
      const dy = touch.clientY - lastTouchRef.current.y;
      
      // Accumulate look delta directly in InputManager, multiplied for sensitivity
      input.mobileLookX += dx * 2.5;
      input.mobileLookY += dy * 2.5;

      lastTouchRef.current = { id: touch.identifier, x: touch.clientX, y: touch.clientY };
    };

    const handleTouchEnd = (e: TouchEvent) => {
      e.preventDefault();
      if (lastTouchRef.current === null) return;
      let ended = false;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === lastTouchRef.current.id) {
          ended = true;
          break;
        }
      }
      if (ended) {
        lastTouchRef.current = null;
      }
    };

    el.addEventListener('touchstart', handleTouchStart, { passive: false });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd, { passive: false });
    el.addEventListener('touchcancel', handleTouchEnd, { passive: false });

    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
      el.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, []);

  return (
    <div
      ref={lookRef}
      style={{
        width: '60%',
        height: '100%',
        pointerEvents: 'auto',
        position: 'relative',
        touchAction: 'none',
      }}
    >
      <div style={{ position: 'absolute', bottom: 40, right: 40, display: 'flex', gap: 10, flexDirection: 'column' }}>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <ActionButton action="interact" label="Interact" />
          <ActionButton action="enterVehicle" label="Vehicle" />
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <ActionButton action="jump" label="Jump / Brake" size={80} />
          <ActionButton action="sprint" label="Sprint" />
        </div>
      </div>
      
      <div style={{ position: 'absolute', top: 40, right: 40, display: 'flex', gap: 10 }}>
        <ActionButton action="pause" label="Pause" />
        <ActionButton action="map" label="Map" />
        <ActionButton action="cameraToggle" label="Cam" />
      </div>
    </div>
  );
}

function VehicleActionArea() {
  const lookRef = useRef<HTMLDivElement>(null);
  const lastTouchRef = useRef<{ id: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const el = lookRef.current;
    if (!el) return;

    const handleTouchStart = (e: TouchEvent) => {
      if ((e.target as HTMLElement).tagName === 'BUTTON') return;
      e.preventDefault();
      if (lastTouchRef.current !== null) return;
      const touch = e.changedTouches[0];
      if (touch) lastTouchRef.current = { id: touch.identifier, x: touch.clientX, y: touch.clientY };
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (!lastTouchRef.current) return;
      let touch: Touch | undefined;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === lastTouchRef.current.id) {
          touch = e.changedTouches[i];
          break;
        }
      }
      if (!touch) return;

      const dx = touch.clientX - lastTouchRef.current.x;
      const dy = touch.clientY - lastTouchRef.current.y;
      
      input.mobileLookX += dx * 2.5;
      input.mobileLookY += dy * 2.5;

      lastTouchRef.current = { id: touch.identifier, x: touch.clientX, y: touch.clientY };
    };

    const handleTouchEnd = (e: TouchEvent) => {
      e.preventDefault();
      if (lastTouchRef.current === null) return;
      let ended = false;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === lastTouchRef.current.id) {
          ended = true;
          break;
        }
      }
      if (ended) lastTouchRef.current = null;
    };

    el.addEventListener('touchstart', handleTouchStart, { passive: false });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd, { passive: false });
    el.addEventListener('touchcancel', handleTouchEnd, { passive: false });

    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
      el.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, []);

  return (
    <div
      ref={lookRef}
      style={{
        width: '60%',
        height: '100%',
        pointerEvents: 'auto',
        position: 'relative',
        touchAction: 'none',
      }}
    >
      <div style={{ position: 'absolute', bottom: 40, right: 40, display: 'flex', gap: 10, flexDirection: 'column' }}>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <ActionButton action="interact" label="Interact" />
          <ActionButton action="enterVehicle" label="Exit" />
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <ActionButton action="moveBack" label="Brake / Rev" size={80} />
          <ActionButton action="moveForward" label="Gas" size={80} />
        </div>
      </div>
      
      <div style={{ position: 'absolute', top: 40, right: 40, display: 'flex', gap: 10 }}>
        <ActionButton action="pause" label="Pause" />
        <ActionButton action="map" label="Map" />
        <ActionButton action="cameraToggle" label="Cam" />
      </div>
    </div>
  );
}

function ActionButton({ action, label, size = 60 }: { action: GameAction; label: string; size?: number }) {
  return (
    <button
      onPointerDown={(e) => { e.preventDefault(); input.setMobileAction(action, true); }}
      onPointerUp={(e) => { e.preventDefault(); input.setMobileAction(action, false); }}
      onPointerLeave={(e) => { e.preventDefault(); input.setMobileAction(action, false); }}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: 'rgba(255, 255, 255, 0.15)',
        border: '2px solid rgba(255, 255, 255, 0.3)',
        color: 'white',
        fontSize: '0.7em',
        fontWeight: 'bold',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        touchAction: 'none',
        pointerEvents: 'auto',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}
