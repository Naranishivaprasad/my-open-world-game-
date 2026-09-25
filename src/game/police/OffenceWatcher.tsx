'use client';

import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { PoliceSystem } from './PoliceSystem';
import type { PedestrianSystem } from '../traffic/PedestrianSystem';
import type { TrafficSystem } from '../traffic/TrafficSystem';
import { POLICE } from '../config/police';
import { DEBUG_HOOKS, sim } from '../core/sim';

/**
 * Turns things that happen in the world into reported offences (spec 23).
 *
 * The key rule the brief sets is that police must not be omniscient, so an
 * offence only escalates the wanted level if somebody actually saw it: a
 * civilian close enough to notice, or an officer who already has line of sight.
 * Flatten a pedestrian down a deserted alley and nothing happens.
 */
export function OffenceWatcher({
  police,
  pedestrians,
  traffic,
}: {
  police: PoliceSystem | null;
  pedestrians: PedestrianSystem | null;
  traffic: TrafficSystem | null;
}) {
  /** Ids already reported, so one collision is not counted every frame. */
  const seenPeds = useRef(new Set<number>());
  const seenCars = useRef(new Set<number>());

  useEffect(() => {
    seenPeds.current.clear();
    seenCars.current.clear();
  }, [police]);

  /*
   * Dev-only: let the driving tests quiet the world.
   *
   * Once traffic exists, a test that needs a clear straight to measure
   * acceleration or steering will sooner or later find a car in the way, which
   * makes the driving suite non-deterministic. This is a test affordance, not
   * a gameplay feature, and is stripped from production builds.
   */
  useEffect(() => {
    if (!DEBUG_HOOKS || typeof window === 'undefined') return;
    const w = window as unknown as { __PALM__?: Record<string, unknown> };
    w.__PALM__ = {
      ...(w.__PALM__ ?? {}),
      setPopulation: (trafficCount: number, pedCount: number) => {
        traffic?.setTargetCount(trafficCount);
        pedestrians?.setTargetCount(pedCount);
        if (trafficCount === 0) traffic?.removeAll();
        if (pedCount === 0) pedestrians?.removeAll();
        police?.setEnabled(trafficCount > 0 || pedCount > 0);
      },
    };
  }, [police, pedestrians, traffic]);

  useFrame(() => {
    if (!police) return;

    /** Was there a witness near this spot? */
    const witnessed = (x: number, z: number) => {
      if (police.units.some((u) => u.hasSight)) return true;
      if (!pedestrians) return false;
      return pedestrians.peds.some(
        (p) =>
          p.state !== 'knocked' && Math.hypot(p.x - x, p.z - z) < POLICE.witnessRange,
      );
    };

    // --- pedestrians knocked down ---
    if (pedestrians) {
      for (const p of pedestrians.peds) {
        if (p.state !== 'knocked' || seenPeds.current.has(p.id)) continue;
        seenPeds.current.add(p.id);
        police.reportOffence('hitPedestrian', witnessed(p.x, p.z), p.x, p.z);
      }
      // Keep the set from growing without bound as pedestrians recycle.
      if (seenPeds.current.size > 200) seenPeds.current.clear();
    }

    // --- traffic knocked out of its lane by the player ---
    if (traffic) {
      const vx = sim.vehicle.position.x;
      const vz = sim.vehicle.position.z;
      for (const a of traffic.agents) {
        if (a.knockedFor <= 0 || seenCars.current.has(a.id)) continue;
        // Only count it if the player's car was actually near the impact.
        if (Math.hypot(a.x - vx, a.z - vz) > 12) continue;
        seenCars.current.add(a.id);
        police.reportOffence('ramVehicle', witnessed(a.x, a.z), a.x, a.z);
      }
      if (seenCars.current.size > 200) seenCars.current.clear();
    }
  });

  return null;
}
