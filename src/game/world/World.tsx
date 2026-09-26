'use client';

import * as THREE from 'three';
import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useRapier } from '@react-three/rapier';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { buildCity, type CityBuild, type PropInstance } from './buildCity';
import type { GeometryChunk } from './meshBuilder';
import { isOnCarriageway } from './roadGraph';
import { MaterialLibrary } from './materials';
import {
  makeAcUnitGeometry,
  makeBenchGeometry,
  makeBinGeometry,
  makeBollardGeometry,
  makeConeGeometry,
  makeHydrantGeometry,
  makePalmGeometry,
  makePineTreeGeometry,
  makeGrassGeometry,
  makeShrubGeometry,
  makeStreetlightGeometry,
  makeUtilityPoleGeometry,
} from './propGeometry';
import { VEHICLE_KEYS, makeVehicleGeometry, type VehicleKey } from './vehicleGeometry';
import { parkedVehicles, headingToRotY, rotYToHeading } from '../vehicle/parkedVehicles';
import { SignalLights } from './SignalLights';
import * as signals from './trafficSignals';
import { getParkedHero } from '../vehicle/takeover';
import { GROUND_HALF, PROMENADE_X, WORLD_HALF } from '../config/world';
import { Sea } from './Sea';
import type { QualitySettings } from '../config/quality';
import { DEBUG_HOOKS, sim } from '../core/sim';

/**
 * Renders the static city and registers its collision.
 *
 * The build runs once inside a useMemo keyed on the seed, so a React re-render
 * never rearranges the city (spec 33).
 */
export function World({
  materials,
  quality,
  onBuilt,
}: {
  materials: MaterialLibrary;
  quality: QualitySettings;
  onBuilt?: (build: CityBuild) => void;
}) {
  const city = useMemo(() => buildCity(), []);

  // Dev-only: the world tests assert that pedestrians keep off the carriageway.
  useEffect(() => {
    if (!DEBUG_HOOKS || typeof window === 'undefined') return;
    const w = window as unknown as { __PALM__?: Record<string, unknown> };
    w.__PALM__ = { ...(w.__PALM__ ?? {}), roadGraph: { isOnCarriageway } };
  }, []);

  useEffect(() => {
    onBuilt?.(city);
  }, [city, onBuilt]);

  // Dispose the generated geometry when the world unmounts. Materials belong to
  // the library and are disposed with it, not here (spec 7, 35).
  useEffect(() => {
    return () => {
      for (const chunks of Object.values(city.geometry)) {
        for (const chunk of chunks) chunk.geometry.dispose();
      }
    };
  }, [city]);

  return (
    <group name="city">
      <StaticColliders city={city} />

      {/*
        Each surface class is drawn as a set of spatial chunks rather than one
        giant mesh, so three can frustum-cull the districts behind the player
        (spec 34). Materials are still shared across every chunk.

        The pavement is tinted down: the ambientCG concrete albedo under a high
        sun with ACES tone mapping blew out to near-white.
      */}
      <ChunkedSurface chunks={city.geometry.ground} material={materials.get('grass')} cast={false} />
      <ChunkedSurface
        chunks={city.geometry.road}
        material={materials.get('asphalt', { normalScale: 0.7 })}
        cast={false}
      />
      {/*
        Only surfaces that contribute a real silhouette cast shadows. Every
        shadow-casting chunk is drawn a SECOND time into the shadow map, so
        kerbs, road paint and sand casting shadows nobody can see was costing
        roughly half the draw calls in a downtown view.
      */}
      <ChunkedSurface
        chunks={city.geometry.sidewalk}
        material={materials.get('concrete', { tint: '#b9b4ab', normalScale: 0.6 })}
        cast={false}
      />
      <ChunkedSurface chunks={city.geometry.markings} material={useMarkingMaterial(materials)} cast={false} />
      <ChunkedSurface
        chunks={city.geometry.facade}
        material={materials.get('plaster', { vertexColors: true, normalScale: 0.8 })}
      />
      <ChunkedSurface
        chunks={city.geometry.roof}
        material={materials.get('concrete', { vertexColors: true, roughness: 0.95 })}
        cast={false}
      />
      <ChunkedSurface
        chunks={city.geometry.metal}
        material={materials.get('corrugated', { vertexColors: true, roughness: 0.55, metalness: 0.55 })}
      />
      <ChunkedSurface
        chunks={city.geometry.glass}
        material={useGlassMaterial(materials)}
        cast={false}
        receive={false}
      />
      <ChunkedSurface
        chunks={city.geometry.accent}
        material={materials.get('plaster', { vertexColors: true, roughness: 0.75 })}
      />
      <ChunkedSurface
        chunks={city.geometry.sand}
        material={materials.get('sand', { tint: '#cbb489', roughness: 0.97 })}
        cast={false}
      />

      <Sea />

      <Props city={city} quality={quality} />
      <ParkedVehicles quality={quality} />
      <SignalLights quality={quality} />
      <Vegetation city={city} quality={quality} />
      <Buildings city={city} quality={quality} />
      <MilkTrucks city={city} />
      <ParkedFerraris city={city} />
      <CarConcepts city={city} />
      <NPCModels />
    </group>
  );
}

function NPCModels() {
  const soldier = useGLTF('/models/vendor/soldier.glb');
  const robot = useGLTF('/models/vendor/robot.glb');

  const mixer1 = useMemo(() => new THREE.AnimationMixer(soldier.scene), [soldier]);
  const mixer2 = useMemo(() => new THREE.AnimationMixer(robot.scene), [robot]);

  useEffect(() => {
    if (soldier.animations.length > 0) {
      const action = mixer1.clipAction(soldier.animations[0]);
      action.play();
    }
    if (robot.animations.length > 0) {
      const action = mixer2.clipAction(robot.animations[3] || robot.animations[0]); // Usually Idle or Walking
      action.play();
    }
  }, [mixer1, mixer2, soldier.animations, robot.animations]);

  useFrame((_, dt) => {
    mixer1.update(dt);
    mixer2.update(dt);
  });

  return (
    <group name="npc-models">
      <primitive object={soldier.scene} position={[88, 0.9, 10]} scale={1.2} />
      <primitive object={robot.scene} position={[132, 0.9, -65]} scale={1.2} />
    </group>
  );
}

useGLTF.preload('/models/vendor/soldier.glb');
useGLTF.preload('/models/vendor/robot.glb');

/**
 * Draws one surface class as a set of independently cullable chunk meshes.
 *
 * Every chunk shares the same material instance, so this costs draw calls but
 * no extra shader compiles or texture binds.
 */
function ChunkedSurface({
  chunks,
  material,
  cast = true,
  receive = true,
}: {
  chunks: GeometryChunk[];
  material: THREE.Material;
  cast?: boolean;
  receive?: boolean;
}) {
  return (
    <>
      {chunks.map((chunk, i) => (
        <mesh
          key={i}
          geometry={chunk.geometry}
          material={material}
          castShadow={cast}
          receiveShadow={receive}
        />
      ))}
    </>
  );
}

// ------------------------------------------------------------------ materials

function useMarkingMaterial(materials: MaterialLibrary) {
  return useMemo(
    () =>
      materials.own(
        'road-markings',
        () =>
          new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.82,
            metalness: 0,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2,
          }),
      ),
    [materials],
  );
}

/**
 * Window glazing, which lights up after dark (spec 10).
 *
 * One material covers every pane in the city, so a single emissive value
 * turns the whole skyline on at dusk and off at dawn. The emissive colour is
 * a warm interior light, deliberately uneven against the cool night sky.
 */
function useGlassMaterial(materials: MaterialLibrary) {
  const material = useMemo(
    () =>
      materials.own(
        'window-glass',
        () =>
          /*
           * Shop glazing. At metalness 0.55 the glass was almost pure
           * reflection, and any pane facing away from the bright side of the
           * sky rendered as a flat black hole. Backing the metalness off and
           * lifting the base colour keeps a reflection while leaving enough
           * diffuse for the pane to read as glass.
           */
          new THREE.MeshStandardMaterial({
            vertexColors: true,
            color: '#8f9ba8',
            roughness: 0.18,
            metalness: 0.22,
            envMapIntensity: 1.35,
            emissive: new THREE.Color('#ffd9a0'),
            emissiveIntensity: 0,
          }),
      ),
    [materials],
  );

  useFrame(() => {
    // Vertex colours tint the panes dark, so the emissive has to be strong to
    // read as a lit window rather than a slightly less black one.
    material.emissiveIntensity = sim.time.darkness * 1.6;
  });

  return material;
}

// ------------------------------------------------------------------ collision

/**
 * Creates every static collider imperatively against the Rapier world.
 *
 * Hundreds of fixed cuboids as React components would cost real reconciliation
 * time for no benefit - none of them ever change (spec 33).
 */
function StaticColliders({ city }: { city: CityBuild }) {
  const { world, rapier } = useRapier();

  useEffect(() => {
    const handles: number[] = [];

    /*
     * One large slab whose TOP surface is exactly y = 0: the carriageway plane.
     *
     * It stops at the promenade. Running it to the world edge put a flat floor
     * over the beach and the sea, so the sand sloped away underneath it and
     * the player walked on grass out above the water.
     */
    const landHalfX = (GROUND_HALF + PROMENADE_X) / 2;
    const groundBody = world.createRigidBody(
      rapier.RigidBodyDesc.fixed().setTranslation(PROMENADE_X - landHalfX, -20, 0),
    );
    const groundCol = world.createCollider(
      rapier.ColliderDesc.cuboid(landHalfX, 20, GROUND_HALF).setFriction(1.0),
      groundBody,
    );
    handles.push(groundCol.handle);

    // Everything else: kerbs, buildings, poles, canopies.
    const body = world.createRigidBody(rapier.RigidBodyDesc.fixed());
    // Parked vehicles need their collider handle kept, so one can be released
    // individually when the player drives that car away (spec 17).
    const parkedHandles = new Map<string, number>();
    for (const c of city.colliders) {
      const col = world.createCollider(
        rapier.ColliderDesc.cuboid(c.hx, c.hy, c.hz).setTranslation(c.x, c.y, c.z).setFriction(0.9),
        body,
      );
      handles.push(col.handle);
      if (c.parked) parkedHandles.set(`${c.parked.key}:${c.parked.index}`, col.handle);
    }

    // Seed the registry from the generated layout. From here on the registry -
    // not the city build - is the source of truth for what is parked where.
    parkedVehicles.clear();
    if (DEBUG_HOOKS && typeof window !== 'undefined') {
      const w = window as unknown as { __PALM__?: Record<string, unknown> };
      w.__PALM__ = { ...(w.__PALM__ ?? {}), parked: parkedVehicles, parkedHero: getParkedHero, signals };
    }
    for (const key of VEHICLE_KEYS) {
      city.props.parkedVehicles[key].forEach((inst, index) => {
        parkedVehicles.add({
          key,
          x: inst.x,
          y: inst.y,
          z: inst.z,
          heading: rotYToHeading(inst.rotY),
          colour: inst.color ?? '#d8d5cf',
          colliderHandle: parkedHandles.get(`${key}:${index}`) ?? null,
        });
      });
    }

    return () => {
      parkedVehicles.clear();
      // Remove bodies (which removes their colliders) on teardown.
      try {
        world.removeRigidBody(body);
        world.removeRigidBody(groundBody);
      } catch {
        /* world already disposed */
      }
    };
  }, [world, rapier, city]);

  return null;
}

// --------------------------------------------------------------------- props

const PROP_MATERIAL = {
  roughness: 0.62,
  metalness: 0.2,
};

function Props({ city, quality }: { city: CityBuild; quality: QualitySettings }) {
  const geos = useMemo(
    () => ({
      streetlight: makeStreetlightGeometry(),
      utilityPole: makeUtilityPoleGeometry(),
      bin: makeBinGeometry(),
      bench: makeBenchGeometry(),
      hydrant: makeHydrantGeometry(),
      bollard: makeBollardGeometry(),
      cone: makeConeGeometry(),
      acUnit: makeAcUnitGeometry(),
    }),
    [],
  );

  useEffect(() => {
    const list = Object.values(geos);
    return () => list.forEach((g) => g.dispose());
  }, [geos]);

  const material = useMemo(
    () => new THREE.MeshStandardMaterial({ vertexColors: true, ...PROP_MATERIAL }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);

  return (
    <group name="props">
      {(Object.keys(geos) as (keyof typeof geos)[]).map((key) => (
        <InstancedProp
          key={key}
          geometry={geos[key]}
          material={material}
          instances={city.props[key]}
          castShadow={quality.shadowsEnabled}
        />
      ))}
    </group>
  );
}

/**
 * Parked vehicles, one InstancedMesh per body class (spec 34).
 *
 * Grouping by class is what lets the city show saloons, vans, pickups and
 * bikes at once while still costing one draw call per class rather than one
 * per vehicle.
 */
function ParkedVehicles({ quality }: { quality: QualitySettings }) {
  const geos = useMemo(() => {
    const out = {} as Record<VehicleKey, THREE.BufferGeometry>;
    for (const k of VEHICLE_KEYS) out[k] = makeVehicleGeometry(k);
    return out;
  }, []);

  useEffect(() => {
    const list = Object.values(geos);
    return () => list.forEach((g) => g.dispose());
  }, [geos]);

  const material = useMemo(
    () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.3 }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);

  // Re-read the registry whenever it changes: a car driven away disappears,
  // and a car the player abandons appears, without either going through React
  // state that the physics step would have to reach into.
  const version = useSyncExternalStore(
    (fn) => parkedVehicles.subscribe(fn),
    () => parkedVehicles.version,
    () => parkedVehicles.version,
  );

  const byKey = useMemo(() => {
    void version;
    const out = {} as Record<VehicleKey, PropInstance[]>;
    for (const k of VEHICLE_KEYS) out[k] = [];
    for (const v of parkedVehicles.all()) {
      out[v.key].push({ x: v.x, y: v.y, z: v.z, rotY: headingToRotY(v.heading), scale: 1, color: v.colour });
    }
    return out;
  }, [version]);

  return (
    <group name="parked-vehicles">
      {VEHICLE_KEYS.map((key) => (
        <InstancedProp
          key={key}
          geometry={geos[key]}
          material={material}
          instances={byKey[key]}
          castShadow={quality.shadowsEnabled}
        />
      ))}
    </group>
  );
}

function Buildings({ city, quality }: { city: CityBuild; quality: QualitySettings }) {
  const tokyo = useGLTF('/models/vendor/tokyo_building.glb');

  return (
    <group name="buildings-tokyo">
      {city.buildings?.tokyo.map((inst, i) => (
        <primitive
          key={i}
          object={tokyo.scene.clone()}
          position={[inst.x, inst.y, inst.z]}
          rotation={[0, inst.rotY, 0]}
          scale={inst.scale}
        />
      ))}
    </group>
  );
}

useGLTF.preload('/models/vendor/tokyo_building.glb');

function MilkTrucks({ city }: { city: CityBuild }) {
  const model = useGLTF('/models/vendor/milk_truck.glb');

  return (
    <group name="milk-trucks">
      {city.props.parkedMilkTrucks?.map((inst, i) => (
        <primitive
          key={i}
          object={model.scene.clone()}
          position={[inst.x, inst.y, inst.z]}
          rotation={[0, inst.rotY, 0]}
          scale={inst.scale * 1.5}
        />
      ))}
    </group>
  );
}

function ParkedFerraris({ city }: { city: CityBuild }) {
  const model = useGLTF('/models/vendor/hero_car.glb');
  return (
    <group name="parked-ferraris">
      {city.props.parkedFerraris?.map((inst, i) => (
        <primitive
          key={i}
          object={model.scene.clone()}
          position={[inst.x, inst.y, inst.z]}
          rotation={[0, inst.rotY, 0]}
          scale={inst.scale * 1.5}
        />
      ))}
    </group>
  );
}

function CarConcepts({ city }: { city: CityBuild }) {
  const model = useGLTF('/models/vendor/car_concept.glb');
  return (
    <group name="car-concepts">
      {city.props.parkedCarConcepts?.map((inst, i) => (
        <primitive
          key={i}
          object={model.scene.clone()}
          position={[inst.x, inst.y + 0.55, inst.z]}
          rotation={[0, inst.rotY, 0]}
          scale={inst.scale}
        />
      ))}
    </group>
  );
}

useGLTF.preload('/models/vendor/hero_car.glb');
useGLTF.preload('/models/vendor/car_concept.glb');

useGLTF.preload('/models/vendor/milk_truck.glb');

function Vegetation({ city, quality }: { city: CityBuild; quality: QualitySettings }) {
  const geos = useMemo(() => ({
    palm: makePalmGeometry(),
    pine: makePineTreeGeometry(),
    grass: makeGrassGeometry(),
    shrub: makeShrubGeometry(),
  }), []);
  useEffect(() => {
    const list = Object.values(geos);
    return () => list.forEach((g) => g.dispose());
  }, [geos]);

  const material = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.88,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    // Restrained wind: sway grows with height so trunks stay put and fronds move
    // (spec 9, spec 27 - coordinated, not a screen effect).
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = windUniform;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           float swayAmount = smoothstep(1.0, 7.0, transformed.y) * 0.16;
           float phase = uTime * 1.1 + float(gl_InstanceID) * 0.7;
           transformed.x += sin(phase) * swayAmount;
           transformed.z += cos(phase * 0.83) * swayAmount * 0.7;`,
        );
    };
    return mat;
  }, []);
  useEffect(() => () => material.dispose(), [material]);

  // One shared uniform drives every instance, updated outside React.
  useFrame((_, dt) => {
    windUniform.value += dt;
  });

  const density = quality.vegetationDensity;
  const palms = useMemo(
    () => city.vegetation.palm.filter((_, i) => i % 100 < density * 100),
    [city, density],
  );
  const pines = useMemo(
    () => city.vegetation.pine.filter((_, i) => i % 100 < density * 100),
    [city, density],
  );
  const grasses = useMemo(
    () => city.vegetation.grass.filter((_, i) => i % 100 < density * 100),
    [city, density],
  );
  const shrubs = useMemo(
    () => city.vegetation.shrub.filter((_, i) => i % 100 < density * 100),
    [city, density],
  );

  return (
    <group name="vegetation">
      <InstancedProp geometry={geos.palm} material={material} instances={palms} castShadow={quality.shadowsEnabled} />
      <InstancedProp geometry={geos.pine} material={material} instances={pines} castShadow={quality.shadowsEnabled} />
      <InstancedProp geometry={geos.grass} material={material} instances={grasses} castShadow={false} />
      <InstancedProp geometry={geos.shrub} material={material} instances={shrubs} castShadow={false} />
    </group>
  );
}

const windUniform = { value: 0 };

function InstancedProp({
  geometry,
  material,
  instances,
  castShadow,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  instances: PropInstance[];
  castShadow: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    let tinted = false;
    instances.forEach((inst, i) => {
      pos.set(inst.x, inst.y, inst.z);
      q.setFromAxisAngle(up, inst.rotY);
      scl.setScalar(inst.scale);
      m.compose(pos, q, scl);
      mesh.setMatrixAt(i, m);
      // Per-instance tint multiplies the baked vertex colour, so white body
      // panels take the paint colour while glass and tyres stay dark.
      if (inst.color) {
        col.set(inst.color);
        mesh.setColorAt(i, col);
        tinted = true;
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (tinted && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [instances]);

  if (instances.length === 0) return null;

  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, instances.length]}
      castShadow={castShadow}
      receiveShadow
      frustumCulled
    />
  );
}

/** Convenience export for systems that need the world extent. */
export const WORLD_BOUNDS = WORLD_HALF;
