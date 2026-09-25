'use client';

import * as THREE from 'three';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useBeforePhysicsStep, useRapier } from '@react-three/rapier';
import type { VehicleController } from './VehicleController';
import { VehicleOwner, type DrivenKind } from './VehicleOwner';
import { getParkedHero } from './takeover';
import { HERO_BUILD, VEHICLE_MODEL, WHEEL } from '../config/vehicle';
import { VEHICLE_TYPES, makeVehicleBodyGeometry, makeVehicleWheelGeometry } from '../world/vehicleGeometry';
import { HERO_VEHICLE_SPAWN } from '../config/world';
import { FIXED_DT } from '../character/Player';
import { DEBUG_HOOKS, sim } from '../core/sim';

/**
 * The player's hero vehicle: physics chassis, four driven wheel visuals,
 * working lights and a steering wheel that follows the road wheels (spec 15, 18, 19).
 *
 * ASSET NOTE - this model is CC-BY-4.0, and that licence explicitly EXCLUDES
 * logos and trademarks. The Khronos steering emblem and the licence plate are
 * therefore removed at load. See ASSETS.md.
 *
 * WHEEL HANDLING - the four wheel pivots in the GLB carry baked matrices with
 * arbitrary rotations. Rather than fight them, each wheel is re-parented into a
 * fresh pivot that the suspension drives, keeping the artist's own orientation
 * on the mesh underneath.
 */
export function HeroVehicle({
  onReady,
  onOwner,
}: {
  onReady?: (v: VehicleController) => void;
  onOwner?: (o: VehicleOwner) => void;
}) {
  const { world, rapier } = useRapier();
  const gltf = useGLTF(VEHICLE_MODEL.url, false);

  const carRef = useRef<THREE.Group>(null);
  /** The GLB shell, which outlives being driven: it stays parked. */
  const heroRef = useRef<THREE.Group>(null);
  const ownerRef = useRef<VehicleOwner | null>(null);

  /**
   * Which shell to draw. Held in React state, not just on the owner, because
   * swapping vehicles changes what is rendered and therefore has to re-render.
   */
  const [kind, setKind] = useState<DrivenKind>('hero');

  const rig = useMemo(() => buildRig(gltf.scene), [gltf.scene]);

  useEffect(() => () => rig.dispose(), [rig]);

  useEffect(() => {
    const owner = new VehicleOwner(world, rapier, HERO_VEHICLE_SPAWN);
    ownerRef.current = owner;
    onOwner?.(owner);
    onReady?.(owner.current);

    // A swap disposes the old controller and builds a new one, so everything
    // holding a reference has to be handed the replacement.
    const off = owner.onSwap((ctl) => {
      setKind(owner.kind);
      onReady?.(ctl);
    });

    if (DEBUG_HOOKS && typeof window !== 'undefined') {
      const w = window as unknown as { __PALM__?: Record<string, unknown> };
      w.__PALM__ = {
        ...(w.__PALM__ ?? {}),
        vehicle: owner.current,
        vehicleOwner: owner,
        teleportCar: (x: number, y: number, z: number, heading: number) =>
          owner.current.teleport(x, y, z, heading),
      };
    }

    return () => {
      off();
      owner.dispose();
      ownerRef.current = null;
    };
  }, [world, rapier, onReady, onOwner]);

  // Keep the debug handle pointing at the live controller after a swap.
  useEffect(() => {
    if (!DEBUG_HOOKS || typeof window === 'undefined') return;
    const owner = ownerRef.current;
    if (!owner) return;
    const w = window as unknown as { __PALM__?: Record<string, unknown> };
    w.__PALM__ = { ...(w.__PALM__ ?? {}), vehicle: owner.current };
  }, [kind]);

  useBeforePhysicsStep(() => {
    const owner = ownerRef.current;
    if (!owner) return;
    // Structural changes first, while the world is definitely not borrowed.
    owner.applyPendingSwap();
    owner.current.update(FIXED_DT);
  });

  const proc = useProceduralShell(kind);

  useFrame(() => {
    const ctl = ownerRef.current?.current;
    const car = carRef.current;
    if (!ctl || !car) return;

    // The renderer only READS the chassis transform (spec 16).
    const t = ctl.body.translation();
    const r = ctl.body.rotation();
    car.position.set(t.x, t.y, t.z);
    car.quaternion.set(r.x, r.y, r.z, r.w);

    const heroShell = kind === 'hero';

    // The hero car follows the chassis while it is the one being driven, and
    // otherwise sits wherever the player left it.
    const hero = heroRef.current;
    if (hero) {
      if (heroShell) {
        hero.position.copy(car.position);
        hero.quaternion.copy(car.quaternion);
      } else {
        const parked = getParkedHero();
        if (parked) {
          hero.position.set(parked.at.x, parked.at.y, parked.at.z);
          hero.rotation.set(0, parked.at.heading + Math.PI, 0);
        }
        hero.visible = !!parked;
      }
    }

    // --- wheels: suspension travel, steer, spin ---
    const pivots = heroShell ? rig.wheelPivots : proc.wheelPivots;
    for (let i = 0; i < pivots.length; i++) {
      const pivot = pivots[i]!;
      // A two-wheeler has four PHYSICS wheels on a narrow virtual track but
      // only two real ones, so its pivots read the front-left and rear-left
      // wheels and sit on the centreline.
      const wheelIndex = proc.twoWheeled ? i * 2 : i;
      const state = ctl.wheelStates[wheelIndex]!;
      const cfg = ctl.build.wheels[wheelIndex]!;

      const suspension = state.suspension || WHEEL.suspensionRestLength;
      // The GLB group is rotated PI about Y, so body-space X and Z mirror into
      // model space. The procedural shells have that rotation baked into their
      // geometry instead, so they use the connection point as-is.
      const sign = heroShell ? -1 : 1;
      const x = proc.twoWheeled ? 0 : sign * cfg.connection.x;
      pivot.position.set(x, cfg.connection.y - suspension, sign * cfg.connection.z);

      Q_STEER.setFromAxisAngle(AXIS_Y, state.steering);
      Q_SPIN.setFromAxisAngle(AXIS_X, state.rotation);
      pivot.quaternion.copy(Q_STEER).multiply(Q_SPIN);
    }

    if (!heroShell) return;

    // --- steering wheel follows the road wheels (spec 18) ---
    if (rig.steeringPivot) {
      const lock = Math.PI * 2 * VEHICLE_MODEL.steeringWheelTurns;
      const frac = ctl.steer / 0.58; // normalise against max low-speed angle
      // About the rim's OWN axis, on top of its resting orientation.
      Q_SPIN.setFromAxisAngle(AXIS_Y, -frac * lock * 0.5);
      rig.steeringPivot.quaternion.copy(rig.steeringRest).multiply(Q_SPIN);
    }

    // --- lights (spec 19) ---
    const braking = ctl.input.throttle < -0.01 || ctl.input.handbrake;
    const reversing = ctl.currentGear === 'R';
    rig.setTailIntensity(braking ? 9 : reversing ? 6 : ctl.isEngineOn ? 1.4 : 0);
    rig.setHeadIntensity(sim.vehicle.headlights ? 7 : 0);
  });

  return (
    <>
      {/* The driven chassis. Empty while the hero car is the one being driven,
          because the GLB shell below is drawn at the same transform instead. */}
      <group ref={carRef} name="hero-vehicle">
        {kind !== 'hero' && (
          <>
            <mesh geometry={proc.body} material={proc.material} castShadow receiveShadow />
            {proc.wheelPivots.map((p, i) => (
              <primitive key={i} object={p} />
            ))}
          </>
        )}
      </group>

      <group ref={heroRef} name="hero-shell">
        <group rotation-y={VEHICLE_MODEL.yawOffset}>
          <primitive object={rig.root} />
          {rig.wheelPivots.map((p, i) => (
            <primitive key={i} object={p} />
          ))}
        </group>
      </group>
    </>
  );
}

/**
 * Geometry and pivots for a driven procedural vehicle.
 *
 * Rebuilt whenever the body class changes, and disposed with it - one shell is
 * alive at a time, so there is nothing to pool.
 */
function useProceduralShell(kind: DrivenKind) {
  const shell = useMemo(() => {
    if (kind === 'hero') {
      return { body: null as THREE.BufferGeometry | null, wheel: null as THREE.BufferGeometry | null };
    }
    return {
      body: makeVehicleBodyGeometry(kind),
      wheel: makeVehicleWheelGeometry(kind),
    };
  }, [kind]);

  const material = useMemo(
    () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.32 }),
    [],
  );

  const twoWheeled = kind !== 'hero' && VEHICLE_TYPES[kind].isBike;

  const wheelPivots = useMemo(() => {
    if (!shell.wheel) return [] as THREE.Group[];
    return (twoWheeled ? [0, 1] : [0, 1, 2, 3]).map(() => {
      const g = new THREE.Group();
      const m = new THREE.Mesh(shell.wheel!, material);
      m.castShadow = true;
      g.add(m);
      return g;
    });
  }, [shell.wheel, material, twoWheeled]);

  useEffect(
    () => () => {
      shell.body?.dispose();
      shell.wheel?.dispose();
    },
    [shell],
  );
  useEffect(() => () => material.dispose(), [material]);

  return { body: shell.body!, material, wheelPivots, twoWheeled };
}

// ---------------------------------------------------------------------- rig

interface Rig {
  root: THREE.Group;
  wheelPivots: THREE.Group[];
  steeringPivot: THREE.Group | null;
  /** Pivot orientation with the wheel centred. */
  steeringRest: THREE.Quaternion;
  setHeadIntensity: (v: number) => void;
  setTailIntensity: (v: number) => void;
  dispose: () => void;
}

/**
 * Prepares the loaded model once: strips trademarked geometry, re-parents the
 * wheels, isolates light materials, and builds a steering pivot.
 */
function buildRig(scene: THREE.Object3D): Rig {
  const root = scene.clone(true) as THREE.Group;
  const owned: (THREE.Material | THREE.BufferGeometry)[] = [];

  // Only the exterior shell and wheels cast shadows. The 40-odd interior
  // meshes contribute nothing to the silhouette and would double the car's
  // shadow-pass cost for no visible gain (spec 34).
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const n = mesh.name ?? '';
    const exterior = n.startsWith('Body') || n.startsWith('Wheel');
    mesh.castShadow = exterior;
    mesh.receiveShadow = true;
  });

  // --- performance: replace transmissive glass ---
  //
  // The GLB's "Glass" material uses KHR_materials_transmission, and three.js
  // implements transmission by rendering the whole scene into a separate
  // render target EVERY frame. Measured in-browser: that one material cost
  // roughly half the frame rate. Plain alpha blending is visually very close
  // here and costs nothing extra (spec 34).
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const swapped = mats.map((m) => {
      const phys = m as THREE.MeshPhysicalMaterial;
      if (!phys.transmission) return m;
      const flat = new THREE.MeshStandardMaterial({
        color: phys.color,
        roughness: 0.08,
        metalness: 0.1,
        transparent: true,
        opacity: 0.32,
        envMapIntensity: 1.6,
        depthWrite: false,
      });
      flat.name = m.name;
      owned.push(flat);
      return flat;
    });
    mesh.material = Array.isArray(mesh.material) ? swapped : swapped[0]!;
  });

  // --- licence compliance: remove logos and trademarks ---
  for (const name of VEHICLE_MODEL.hiddenNodes) {
    const node = root.getObjectByName(name);
    if (node) node.visible = false;
  }
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (mats.some((m) => VEHICLE_MODEL.hiddenMaterials.includes(m.name))) mesh.visible = false;
  });

  /*
   * --- re-parent each wheel into a fresh pivot ---
   *
   * THE FRONT WHEELS ARE BAKED TURNED. Read straight out of the GLB, the rear
   * wheel nodes' first matrix column is (1, 0, 0) - square to the car - while
   * the front wheels' is (0.866, -0.500, 0), which is 30 degrees of steer
   * frozen into the model by whoever posed it.
   *
   * Keeping "the artist's orientation" therefore kept that 30 degrees, and the
   * pivot's own steer angle was applied ON TOP of it, so the front wheels sat
   * skewed at rest and splayed right out at full lock.
   *
   * Each front wheel is given its own side's REAR orientation instead, which
   * is square. The residual roll baked into the rears is harmless: a wheel
   * frozen at an arbitrary roll angle looks identical.
   */
  const squareFor: Record<string, string> = {
    WheelFrontL: 'WheelRearL',
    WheelFrontR: 'WheelRearR',
  };

  const wheelPivots: THREE.Group[] = [];
  for (const cfg of HERO_BUILD.wheels) {
    const pivot = new THREE.Group();
    pivot.name = `${cfg.name}_pivot`;
    const node = root.getObjectByName(cfg.name);
    if (node) {
      const squareSource = squareFor[cfg.name];
      if (squareSource) {
        const ref = root.getObjectByName(squareSource);
        if (ref) node.quaternion.copy(ref.quaternion);
      }
      node.position.set(0, 0, 0);
      pivot.add(node);

      /*
       * Centre the wheel's geometry on the pivot, which IS the suspension
       * connection point.
       *
       * A wheel node is a group whose rim, disc and pad sit at their own
       * offsets inside it, so zeroing the node's position does not put the
       * wheel itself at the connection point. Measured: the front wheels ended
       * up 16 cm higher than the rears (centre y 0.678 against 0.518) even
       * though all four suspension points are at the same height.
       */
      pivot.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(node);
      node.position.sub(bounds.getCenter(new THREE.Vector3()));
    } else {
      console.warn(`[vehicle] wheel node "${cfg.name}" not found in GLB`);
    }
    wheelPivots.push(pivot);
  }

  // --- steering wheel pivot ---
  let steeringPivot: THREE.Group | null = null;
  /** The pivot's orientation at rest, which the steer angle is applied on top of. */
  const steeringRest = new THREE.Quaternion();
  const steerNodes = VEHICLE_MODEL.steeringWheelNodes
    .map((n) => root.getObjectByName(n))
    .filter((n): n is THREE.Object3D => !!n);

  if (steerNodes.length > 0) {
    /*
     * The pivot is MEASURED from the loaded geometry, not typed in.
     *
     * The rim's nodes carry baked matrices and sit under two different
     * parents, and their meshes are centred on their own local origins - so
     * subtracting a hand-authored offset from each node's position moved the
     * geometry and left the axis of rotation nowhere near the rim. At full
     * lock the wheel swung out through the side of the car.
     *
     * Instead: put a pivot at the rim's real centre, give it the rim's own
     * orientation so its local Y is the column axis, and use attach() rather
     * than add() - attach preserves each child's world transform, so nothing
     * moves when it is re-parented.
     */
    root.updateMatrixWorld(true);

    const bounds = new THREE.Box3();
    for (const n of steerNodes) bounds.expandByObject(n);
    const centre = bounds.getCenter(new THREE.Vector3());

    steeringPivot = new THREE.Group();
    steeringPivot.name = 'steering_pivot';
    root.add(steeringPivot);

    steeringPivot.position.copy(root.worldToLocal(centre.clone()));

    // The rim is a disc in its own XZ plane, so its local Y is the axis it
    // turns about. Copying its orientation lets the frame loop simply rotate
    // the pivot about Y.
    const rimWorld = new THREE.Quaternion();
    steerNodes[0]!.getWorldQuaternion(rimWorld);
    const rootWorld = new THREE.Quaternion();
    root.getWorldQuaternion(rootWorld);
    steeringPivot.quaternion.copy(rootWorld.invert().multiply(rimWorld));
    steeringPivot.updateMatrixWorld(true);

    for (const n of steerNodes) steeringPivot.attach(n);
    steeringRest.copy(steeringPivot.quaternion);
  }

  // --- isolate light materials so emissive changes do not leak ---
  const headMats: THREE.MeshStandardMaterial[] = [];
  const tailMats: THREE.MeshStandardMaterial[] = [];

  const collect = (names: string[], into: THREE.MeshStandardMaterial[]) => {
    for (const name of names) {
      const node = root.getObjectByName(name);
      if (!node) continue;
      node.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || !mesh.material) return;
        const src = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as
          | THREE.MeshStandardMaterial
          | undefined;
        if (!src) return;
        const clone = src.clone();
        owned.push(clone);
        mesh.material = clone;
        into.push(clone);
      });
    }
  };
  collect(VEHICLE_MODEL.lightNodes.head, headMats);
  collect(VEHICLE_MODEL.lightNodes.tail, tailMats);

  const setIntensity = (mats: THREE.MeshStandardMaterial[], colour: THREE.ColorRepresentation) => (v: number) => {
    for (const m of mats) {
      m.emissive.set(colour);
      m.emissiveIntensity = v;
    }
  };

  return {
    root,
    wheelPivots,
    steeringPivot,
    steeringRest,
    setHeadIntensity: setIntensity(headMats, '#fff4e0'),
    setTailIntensity: setIntensity(tailMats, '#ff2a12'),
    dispose: () => {
      for (const o of owned) o.dispose();
    },
  };
}

const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const Q_STEER = new THREE.Quaternion();
const Q_SPIN = new THREE.Quaternion();

useGLTF.preload(VEHICLE_MODEL.url, false);
