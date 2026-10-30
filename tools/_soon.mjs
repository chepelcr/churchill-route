let chromium; try{({chromium}=await import("playwright"))}catch{process.exit(0)}
const b=await chromium.launch().catch(()=>null); if(!b)process.exit(0);
const page=await b.newPage({viewport:{width:1280,height:720}});
await page.addInitScript(()=>{try{
  localStorage.setItem("churchill_intro_seen_v1","1");
  // EVERYTHING cleared, so the ordinary ladder lock cannot hide an MVP "soon"
  localStorage.setItem("churchill_progress_v1", JSON.stringify({
    unlocked:["faro","carmen","paseo","centro","playitas","cocal","mata","caldera"],
    clearedStages:["s1","s2","s3","s4","s5","s6","s7","s8"], best:0, coins:0,
    owned:["bici","scooter","tuktuk","panga"]}));
}catch(e){}});
await page.goto("http://localhost:8799/",{waitUntil:"load"});
await page.waitForFunction(()=>!!window.Game && !document.querySelector(".boot-screen"),{timeout:90000});
await page.waitForTimeout(1000);
console.log(await page.evaluate(()=>{
  const S=window.WORLD2D.STAGES, D=window.WORLD2D.DISTRICTS;
  return JSON.stringify({
    stages:S.map(s=>`${s.num} ${s.id} ${s.district}`),
    districts:D.map(d=>d.id),
  },null,1);
}));
await page.getByText("STORY",{exact:false}).first().click({timeout:2000}).catch(()=>{});
await page.waitForTimeout(900);
const cards=[];
for(let i=0;i<8;i++){
  cards.push(await page.evaluate(()=>({
    num:document.querySelector(".hero-num")?.innerText,
    name:document.querySelector(".hero-name")?.innerText,
    badge:document.querySelector(".hero-badge")?.innerText||"",
    play:document.querySelector(".hero-play")?.innerText,
    disabled:document.querySelector(".hero-play")?.disabled})));
  await page.keyboard.press("ArrowRight"); await page.waitForTimeout(220);
}
console.log("cards:"); for(const c of cards) console.log("  ", JSON.stringify(c));
await b.close();
