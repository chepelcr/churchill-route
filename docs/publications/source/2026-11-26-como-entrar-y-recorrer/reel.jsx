import React from 'react';
import { AbsoluteFill, Html5Audio, Html5Video, Img, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { BrandEndLink, BrandReveal as Enter, BrandSignature, BrandSubtitle, BrandWaves } from './public/brand/remotion.jsx';
import './reel.css';

const shots = [
  { id: 'faro', length: 117 },
  { id: 'menu', length: 126 },
  { id: 'paseo', length: 144 },
  { id: 'catedral', length: 81 },
  { id: 'litoperez', length: 81 },
  { id: 'faro-noche', length: 108 },
];

export const LENGTH = shots.reduce((total, { length }) => total + length, 0);

function RouteMark() {
  return <BrandSignature style={{ fontSize: 27, marginBottom: 32 }} />;
}

function Footage({ id, children }) {
  return <>
    <Html5Video className="footage" src={staticFile(id + '.mp4')} muted />
    <AbsoluteFill className={`shade shade--${id}`} />
    {children}
  </>;
}

function Menu() {
  const frame = useCurrentFrame();
  const city = frame >= 63;
  return <>
    <Html5Video className="footage menu-background" src={staticFile('paseo.mp4')} muted />
    <AbsoluteFill className="menu-veil" />
    <div className="header">
      <RouteMark />
      <Enter delay={2}>
        <div className="overline">1 / ABRÍ EL JUEGO</div>
        <h2 className="domain">churchill.<br />jcampos.dev</h2>
      </Enter>
    </div>
    <div className="menu-visual">
      <div className="phone">
        <Img src={staticFile(city ? 'ciudad.jpg' : 'menu.jpg')} />
      </div>
      <div className="menu-instruction"><b>{city ? 'La ciudad' : 'Recorrer'}</b><span>{city ? '2 DE 2' : '1 DE 2'}</span></div>
    </div>
    <div className="lower"><Enter delay={10}><BrandSubtitle className="small-note">En el cel, giralo de lado.</BrandSubtitle></Enter></div>
  </>;
}

function Place({ name }) {
  return <div className="place"><Enter className="place-name"><i aria-hidden="true" />{name}</Enter></div>;
}

function Scene({ id }) {
  if (id === 'menu') return <Menu />;
  if (id === 'faro') return <Footage id={id}>
    <div className="header">
      <RouteMark />
      <Enter delay={4}><h1>¿Le damos<br /><em>una vuelta?</em></h1></Enter>
    </div>
    <Place name="El Faro · La Punta" />
  </Footage>;
  if (id === 'paseo') return <Footage id={id}>
    <div className="header">
      <Enter delay={3}><div className="overline">2 / ELEGÍ TU VEHÍCULO</div><h2>Y arrancá.</h2></Enter>
    </div>
    <Place name="Paseo de los Turistas" />
  </Footage>;
  if (id === 'catedral') return <Footage id={id}><Place name="Catedral de Puntarenas" /></Footage>;
  if (id === 'litoperez') return <Footage id={id}><Place name="Estadio Lito Pérez" /></Footage>;
  return <Footage id={id}>
    <BrandWaves opacity={0.24} />
    <div className="header">
      <RouteMark />
      <Enter delay={6}><h2>Nos vemos<br /><em>en el puerto.</em></h2></Enter>
    </div>
    <div className="lower"><Enter delay={13}>
      <BrandEndLink><span className="end-arrow" aria-hidden="true">↗</span></BrandEndLink>
      <BrandSubtitle className="small-note">Enlace en el perfil</BrandSubtitle>
    </Enter></div>
  </Footage>;
}

function Cut({ boundaries }) {
  const frame = useCurrentFrame();
  const boundary = boundaries.find((start) => frame >= start - 4 && frame <= start + 4);
  if (boundary === undefined) return null;
  const ratio = (frame - boundary + 4) / 8;
  return <div className="wipe" style={{ transform: `rotate(-14deg) translateY(${(ratio - 0.5) * 2640}px)` }} />;
}

export function Reel() {
  const starts = shots.map((_shot, index) => shots.slice(0, index).reduce((total, shot) => total + shot.length, 0));
  return <AbsoluteFill className="composition">
    {shots.map(({ id, length }, index) =>
      <Sequence key={id} name={id} from={starts[index]} durationInFrames={length}><Scene id={id} /></Sequence>
    )}
    <Cut boundaries={[starts[1], starts[2], starts[5]]} />
    <Html5Audio src={staticFile('radio.m4a')} />
  </AbsoluteFill>;
}
