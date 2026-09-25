'use client';

import React, { useRef, useEffect, useState } from 'react';
import { input } from '../input/InputManager';
import type { GameAction } from '../config/bindings';
import { sim } from '../core/sim';

export function MobileControls() {
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
      <MovementArea />
      <LookAndActionArea />
    </div>
  );
}

function MovementArea() {
  const containerRef = useRef<HTMLDivElement>(null);
  const touchIdRef = useRef<number | null>(null);
  const [basePos, setBasePos] = useState<{ x: number; y: number } | null>(null);
  const [nubPos, setNubPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      if (touchIdRef.current !== null) return;
      const touch = e.changedTouches[0];
      if (!touch) return;
      touchIdRef.current = touch.identifier;
      const rect = el.getBoundingClientRect();
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;
      setBasePos({ x, y });
      setNubPos({ x, y });
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (touchIdRef.current === null || !basePos) return;
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

      const dx = x - basePos.x;
      const dy = y - basePos.y;
      const maxRadius = 40;
      const dist = Math.hypot(dx, dy);

      let clampedX = dx;
      let clampedY = dy;
      if (dist > maxRadius) {
        clampedX = (dx / dist) * maxRadius;
        clampedY = (dy / dist) * maxRadius;
      }

      setNubPos({ x: basePos.x + clampedX, y: basePos.y + clampedY });

      // Map to -1..1
      const nx = clampedX / maxRadius;
      const ny = clampedY / maxRadius;
      input.mobileMoveX = nx;
      input.mobileMoveZ = ny;
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
      setBasePos(null);
      setNubPos(null);
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
  }, [basePos]);

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
      {basePos && (
        <div
          style={{
            position: 'absolute',
            left: basePos.x - 40,
            top: basePos.y - 40,
            width: 80,
            height: 80,
            borderRadius: '50%',
            background: 'rgba(255, 255, 255, 0.1)',
            border: '2px solid rgba(255, 255, 255, 0.3)',
            boxSizing: 'border-box',
          }}
        />
      )}
      {nubPos && (
        <div
          style={{
            position: 'absolute',
            left: nubPos.x - 20,
            top: nubPos.y - 20,
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: 'rgba(255, 255, 255, 0.6)',
            boxSizing: 'border-box',
          }}
        />
      )}
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
      e.preventDefault();
      // Ignore if we already track a look touch
      if (lastTouchRef.current !== null) return;
      const touch = e.changedTouches[0];
      if (!touch) return;
      
      // Ensure we're not touching a button
      if ((e.target as HTMLElement).tagName === 'BUTTON') return;

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
      
      // Accumulate look delta directly in InputManager
      input.mobileLookX += dx;
      input.mobileLookY += dy;

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
