import React from 'react';
import {useCurrentFrame,interpolate,Easing} from 'remotion';
const clamp={extrapolateLeft:'clamp',extrapolateRight:'clamp'};
export function waveLine(y, phase, amplitude = 16, wavelength = 118) {
  const chunks = [];
  for (let x = -28; x <= 1120; x += 14) {
    const offset = Math.sin(x / wavelength + phase) * amplitude
      + Math.sin(x / (wavelength * 0.39) - phase * 0.67) * amplitude * 0.19;
    chunks.push(`${x},${(y + offset).toFixed(2)}`);
  }
  return 'M ' + chunks.join(' L ');
}

export function Wash() {
  const frame = useCurrentFrame();
  const surge = interpolate(frame, [47, 62, 117, 148], [2160, 1780, 160, -285], {
    ...clamp, easing: Easing.inOut(Easing.quad),
  });
  const phase = frame * 0.045;
  const back = waveLine(surge - 121, phase + 1.1, 77);
  const crest = waveLine(surge, phase, 72);
  const front = waveLine(surge + 134, phase - 0.9, 83, 143);
  return <svg className="ocean-wash" viewBox="0 0 1080 1920" aria-hidden="true">
    <defs>
      <linearGradient id="water-fill" x2="17%" x1="42%" y1="0%" y2="100%">
        <stop stopColor="#078989" /><stop offset="0.5" stopColor="#07596a" /><stop offset="1" stopColor="#062e49" />
      </linearGradient>
      <linearGradient id="water-deep" x2="15%" x1="66%" y1="0%" y2="100%">
        <stop stopColor="#198f91" /><stop offset="0.47" stopColor="#0b6274" /><stop offset="1" stopColor="#062b46" />
      </linearGradient>
      <clipPath id="ocean-edge"><path d={crest + ' L 1120,2160 L -28,2160 Z'} /></clipPath>
    </defs>
    <path d={back + ' L 1120,2160 L -28,2160 Z'} fill="#166c83" opacity=".66" />
    <path d={back} stroke="#77cbd0" strokeWidth="7" fill="none" opacity=".65" />
    <path d={crest + ' L 1120,2160 L -28,2160 Z'} fill="url(#water-fill)" />
    <path d={front + ' L 1120,2160 L -28,2160 Z'} fill="url(#water-deep)" />
    <g clipPath="url(#ocean-edge)">
      {Array.from({ length: 18 }, (_, i) => <path key={i}
        d={waveLine(surge + 53 + i * 120, phase + i * 0.9, 11 + (i % 4) * 5, 58 + i * 4)}
        stroke={i % 3 ? '#73d4d3' : '#c1fff1'} strokeWidth={i % 3 ? 2 : 4} fill="none" opacity={0.20 - (i % 4) * 0.029} />)}
    </g>
    <path d={crest} stroke="#aff4e7" strokeWidth="34" fill="none" opacity=".69" />
    <path d={crest} stroke="#e0fff7" strokeWidth="12" fill="none" />
    <path d={waveLine(surge + 24, phase - 0.09, 70)} stroke="#dcfff0" strokeWidth="5" strokeDasharray="43 15 10 20" fill="none" opacity=".9" />
    <path d={front} stroke="#8adcd7" strokeWidth="7" fill="none" opacity=".30" />
    {Array.from({ length: 27 }, (_, i) => {
      const x = (i * 139 + frame * (0.9 + i % 3 * 0.7)) % 1120;
      const y = surge + Math.sin(x / 118 + phase) * 72 - 24 - (i % 6) * 8;
      const radius = 2 + i % 5;
      return <circle key={i} cx={x} cy={y} r={radius} fill="#dcfff6" opacity={0.25 + (i % 5) * 0.10} />;
    })}
  </svg>;
}

