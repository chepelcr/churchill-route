import React, {useState,useEffect,useRef} from 'react';
import {UI_SCREEN} from '../../domain/vocabulary.generated.js';
import catalog from '../../content/pacific-railway.json';
import {railwayResult} from '../../game/railway.js';
import {useT} from '../../i18n/index.js';
import {sfx} from '../../game/audio.js';
import Slots from '../Slots.jsx';
import FitScale from '../FitScale.jsx';
import './railway.css';

const SAVE='churchill.railway.v1';
function readSave(){try{const p=JSON.parse(localStorage.getItem(SAVE));return p&&typeof p==='object'?p:{};}catch{return {};}}
const clock=s=>`${Math.floor(s/60).toString().padStart(2,'0')}:${Math.floor(s%60).toString().padStart(2,'0')}`;

export default function RailwayMode({onBack}){
  const t=useT(),frame=useRef(null),saved=useRef(readSave());
  const [phase,setPhase]=useState('levels'),[level,setLevel]=useState(catalog.levels[0]);
  const [skin,setSkin]=useState(catalog.trains.some(x=>x.id===saved.current.skin)?saved.current.skin:'classic');
  const [result,setResult]=useState(null),[attempt,setAttempt]=useState(0),[frameError,setFrameError]=useState(false);
  const back=()=>phase==='levels'?onBack():setPhase('levels');
  function start(){sfx.play('menu_select');setFrameError(false);setAttempt(n=>n+1);setPhase('playing');}
  useEffect(()=>{
    const message=event=>{
      if(event.origin!==location.origin||event.source!==frame.current?.contentWindow)return;
      if(event.data?.type==='churchill:railway:exit'){setPhase('levels');return;}
      if(event.data?.type==='churchill:railway:error'){setFrameError(true);return;}
      if(event.data?.type!=='churchill:railway:complete')return;
      const clean=railwayResult(event.data.result);if(!clean)return;
      const old=saved.current.best?.[level.id];
      saved.current={...saved.current,skin,best:{...saved.current.best,[level.id]:Number.isFinite(old)?Math.min(old,clean.elapsed):clean.elapsed}};
      try{localStorage.setItem(SAVE,JSON.stringify(saved.current));}catch{}
      setResult(clean);setPhase('results');
    };
    window.addEventListener('message',message);return()=>window.removeEventListener('message',message);
  },[level.id,skin]);
  useEffect(()=>{
    const key=e=>{if(e.key==='Escape'&&phase!=='playing'){e.preventDefault();back();}};
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  },[phase,onBack]);
  const trainPreview=train=><div className="railway-train" aria-hidden="true">{['rear','middle','front'].map(role=><img key={role} src={`/pacific-railway/assets/cars/car-${role}${train.suffix}.svg`} alt="" />)}</div>;
  const page=(title,children)=><div className="title-bg"><div className="title-shell shell-col"><div className="shell-nav"><button className="btn secondary" onClick={back}>{t(phase==='levels'?'select.back':'railway.backLevels')}</button><h1 className="title-main shell-title">{title}</h1><span className="title-pill">{t('railway.pill')}</span></div><FitScale pad={110}>{children}</FitScale></div></div>;
  const SLOTS = {
    levels: () => page(t('mode.pacific-railway'),<div className="stage-select-wrap railway-select"><div className="stage-hero glass-card"><div className="hero-top"><span className="hero-num">01</span><span className="hero-count">{t('railway.level.count')}</span></div><div className="hero-name">{t(level.nameKey)}</div><p className="hero-brief">{t(level.briefKey)}</p><div className="hero-meta"><span>✦ {t('railway.stars')}</span><span>{saved.current.best?.[level.id]?t('railway.best')+' '+clock(saved.current.best[level.id]):t('railway.first')}</span></div><button className="btn gold hero-play" onClick={()=>{setLevel(catalog.levels[0]);setPhase('trains');}}>{t('railway.chooseTrain')}</button></div></div>),
    trains: () => page(t('railway.trains'),<div className="railway-select"><div className="glass-card railway-trains"><p>{t('railway.trainHint')}</p><div className="railway-train-grid">{catalog.trains.map(train=><button key={train.id} className={'mode'+(skin===train.id?' focused':'')} aria-pressed={skin===train.id} onClick={()=>{setSkin(train.id);sfx.play('menu_move');}}>{trainPreview(train)}<strong>{t(train.nameKey)}</strong></button>)}</div><p className="hero-brief">{t('railway.controls')}</p><button className="btn gold hero-play" onClick={start}>{t('railway.depart')}</button></div></div>),
    playing: () => <div className="railway-play">{frameError?<div className="overlay"><div className="panel"><p role="alert">{t('railway.loadError')}</p><button className="btn" onClick={start}>{t('railway.again')}</button><button className="btn secondary" onClick={()=>setPhase('levels')}>{t('railway.levels')}</button></div></div>:<iframe key={attempt} ref={frame} src={`${level.runtime}?embedded=1&skin=${encodeURIComponent(skin)}`} title={t(level.nameKey)} allow="fullscreen" onLoad={()=>frame.current?.contentWindow?.focus()} onError={()=>setFrameError(true)} />}</div>,
    results: () => page(t('railway.finished'),<div className="stage-select-wrap railway-select"><div className="stage-hero glass-card"><div className="hero-name">{t(level.nameKey)}</div><div className="hero-meta"><span>✦ {result?.stars}/3</span><span>{t('railway.time')} <b>{clock(result?.elapsed||0)}</b></span><span>{t('railway.best')} <b>{clock(saved.current.best?.[level.id]||0)}</b></span></div><div className="railway-result-actions"><button className="btn gold" onClick={start}>{t('railway.again')}</button><button className="btn secondary" onClick={()=>setPhase('levels')}>{t('railway.levels')}</button><button className="btn secondary" onClick={onBack}>{t('railway.menu')}</button></div></div></div>),
  };
  const ctx = {
    levels: phase==='levels',
    trains: phase==='trains',
    playing: phase==='playing',
    results: phase==='results',
  };
  return <section className="railway-mode" aria-label={t('mode.pacific-railway')}><Slots screen={UI_SCREEN.RAILWAY} region="main" ctx={ctx} slots={SLOTS}/></section>;
}
