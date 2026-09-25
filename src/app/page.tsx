'use client';

import dynamic from 'next/dynamic';

/**
 * The game is strictly browser-only: WebGL, Rapier WASM and pointer lock all
 * need a real document. Loading it with ssr:false keeps it out of server
 * execution entirely (spec 3).
 */
const GameRoot = dynamic(() => import('@/game/GameRoot'), {
  ssr: false,
  loading: () => (
    <div className="overlay overlay--scrim">
      <div className="panel panel--narrow" style={{ textAlign: 'center' }}>
        <p className="eyebrow">Palm Coast</p>
        <p className="subtitle">Starting engine&hellip;</p>
      </div>
    </div>
  ),
});

export default function Page() {
  return <GameRoot />;
}
