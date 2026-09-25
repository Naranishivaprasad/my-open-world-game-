import { Showroom } from '../../game/debug/Showroom';

/**
 * Development-only vehicle showroom at /showroom.
 *
 * Iterating on vehicle geometry by hunting for a parked car in the open world
 * is slow and imprecise: you cannot control the angle, the lighting or which
 * body class you are looking at. This page lays every class out on a turntable
 * strip so a single screenshot shows the whole catalogue side by side.
 */
export default function ShowroomPage() {
  return <Showroom />;
}
