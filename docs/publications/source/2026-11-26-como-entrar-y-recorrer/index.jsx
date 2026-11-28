import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { Reel, LENGTH } from './reel.jsx';

function Root() {
  return <Composition id="ChurchillRecorrer" component={Reel} durationInFrames={LENGTH} fps={30} width={1080} height={1920} />;
}

registerRoot(Root);
