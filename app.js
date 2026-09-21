/* setLang dla PL/EN */
function toggleMore(btn){
  const extra = btn.nextElementSibling;
  const isOpen = extra.classList.toggle('open');
  btn.classList.toggle('open', isOpen);
  const pl = btn.querySelector('.lang-pl');
  const en = btn.querySelector('.lang-en');
  if(pl) pl.textContent = isOpen ? 'Zwiń ▲' : 'Czytaj więcej ▾';
  if(en) en.textContent = isOpen ? 'Show less ▲' : 'Read more ▾';
}

function shareApp(){
  const url = 'https://viasudetica.eu/';
  const title = 'Wielka Korona Sudetów';
  const text = 'cześć, zapraszam cię do odkrywania Sudetów. Poznaj najwybitniejsze szczyty Sudetów po stronie polskiej, czeskiej i niemieckiej i zdobądź trzy sudeckie korony.';
  if(navigator.share){
    navigator.share({title, text, url}).catch(()=>{});
  } else {
    navigator.clipboard.writeText(url).then(()=>{
      const btn = document.getElementById('share-btn');
      const orig = btn.innerHTML;
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> <span>Skopiowano!</span>';
      setTimeout(()=>{ btn.innerHTML = orig; }, 2000);
    }).catch(()=>{ prompt('Skopiuj link:', url); });
  }
}

function setLang(l){
  document.getElementById('btn-pl').classList.toggle('active',l==='pl');
  document.getElementById('btn-en').classList.toggle('active',l==='en');
  document.querySelectorAll('.lang-pl').forEach(el=>el.style.display=l==='pl'?'':'none');
  document.querySelectorAll('.lang-en').forEach(el=>el.style.display=l==='en'?'':'none');
}

let GRUPY_GEOJSON;
/* ═══════════════════════════════════════════
   DATA
═══════════════════════════════════════════ */

/* ═══════════════════════════════════════════
   STATE
═══════════════════════════════════════════ */
/* Śnieżnik i Ještěd przeniesione z WKS[0]/[1] do KS[8]/[9] (v1.1). Zapisany
   wcześniej postęp wskazuje wciąż na stare indeksy WKS, które teraz są
   zupełnie innymi szczytami — bez tej migracji stary "zdobyty" Śnieżnik
   pokazywałby jako zdobyty np. Suchy Szczyt. Migracja jednorazowa,
   zabezpieczona flagą schemaV2 (żeby nie przesunąć indeksów po raz drugi). */
function migratePeakTiers(s){
  if(s.schemaV2) return s;
  const oldWks = s.wks || [];
  const newWks = [];
  const addToKs = [];
  oldWks.forEach(i=>{
    if(i===0) addToKs.push(8);       // Śnieżnik: był WKS[0], teraz KS[8]
    else if(i===1) addToKs.push(9);  // Ještěd: był WKS[1], teraz KS[9]
    else newWks.push(i-2);           // reszta przesuwa się o 2 w dół
  });
  s.wks = newWks;
  s.ks = Array.from(new Set([...(s.ks||[]), ...addToKs]));
  s.schemaV2 = true;
  return s;
}
/* Okole przeniesione z KS[6] na koniec WKS (nowy WKS[23]) (v1.2). Ten sam
   powód co wyżej — stare "zdobyte" Okole wskazywałoby teraz na Biskupią Kopę.
   Zakładamy, że migratePeakTiers (schemaV2) już się wykonała, więc tu KS ma
   jeszcze starą, 10-elementową numerację sprzed usunięcia Okole. Dopisanie
   Okole na KOŃCU WKS (a nie na początek, jak przy poprzedniej migracji)
   oznacza, że reszta WKS nie przesuwa się wcale — trzeba tylko dopisać nowy
   indeks, jeśli Okole było zdobyte. */
function migrateOkoleToWks(s){
  if(s.schemaV3) return s;
  const oldKs = s.ks || [];
  const newKs = [];
  let okoleConquered = false;
  oldKs.forEach(i=>{
    if(i===6) okoleConquered = true;   // Okole: był KS[6]
    else if(i>6) newKs.push(i-1);      // reszta KS za Okole przesuwa się o 1 w dół
    else newKs.push(i);
  });
  s.ks = newKs;
  if(okoleConquered){
    const wks = s.wks || [];
    if(!wks.includes(23)) wks.push(23); // Okole: teraz WKS[23] (dopisane na końcu)
    s.wks = wks;
  }
  s.schemaV3 = true;
  return s;
}
/* Biskupia Kopa: KS[6] -> koniec DKS (nowy DKS[25]). Słoneczna: WKS[9] -> koniec
   KS (nowy KS[8], liczony PO usunięciu Biskupiej Kopy z KS) (v1.3). Zakładamy,
   że migratePeakTiers i migrateOkoleToWks już się wykonały — numeracja KS/WKS
   tutaj to stan zaraz PRZED tą zmianą (KS 9 elementów z Biskupią Kopą na [6],
   WKS 24 elementy ze Słoneczną na [9]). Oba przesunięcia liczone niezależnie,
   bo dotyczą różnych tablic. */
function migrateV4(s){
  if(s.schemaV4) return s;
  const oldKs = s.ks || [];
  const newKs = [];
  let biskupiaKopaConquered = false;
  oldKs.forEach(i=>{
    if(i===6) biskupiaKopaConquered = true;   // Biskupia Kopa: był KS[6]
    else if(i>6) newKs.push(i-1);             // reszta KS za nią przesuwa się o 1 w dół
    else newKs.push(i);
  });
  const oldWks = s.wks || [];
  const newWks = [];
  let slonecznaConquered = false;
  oldWks.forEach(i=>{
    if(i===9) slonecznaConquered = true;      // Słoneczna: była WKS[9]
    else if(i>9) newWks.push(i-1);            // reszta WKS za nią przesuwa się o 1 w dół
    else newWks.push(i);
  });
  if(biskupiaKopaConquered){
    const dks = s.dks || [];
    if(!dks.includes(25)) dks.push(25);       // Biskupia Kopa: teraz DKS[25]
    s.dks = dks;
  }
  if(slonecznaConquered && !newKs.includes(8)) newKs.push(8); // Słoneczna: teraz KS[8]
  s.ks = newKs;
  s.wks = newWks;
  s.schemaV4 = true;
  return s;
}
/* Słoneczna: KS[8] -> koniec WKS (nowy WKS[30]) (v1.4). Była ostatnim elementem
   KS, więc jej usunięcie nie przesuwa żadnych innych indeksów KS. Dopisanie na
   KOŃCU WKS (a nie na początek) oznacza, że reszta WKS wcale się nie przesuwa. */
function migrateV5(s){
  if(s.schemaV5) return s;
  const oldKs = s.ks || [];
  const newKs = [];
  let slonecznaConquered = false;
  oldKs.forEach(i=>{
    if(i===8) slonecznaConquered = true;      // Słoneczna: była KS[8]
    else newKs.push(i);
  });
  if(slonecznaConquered){
    const wks = s.wks || [];
    if(!wks.includes(30)) wks.push(30);       // Słoneczna: teraz WKS[30]
    s.wks = wks;
  }
  s.ks = newKs;
  s.schemaV5 = true;
  return s;
}
/* Jawornik Wielki: usunięty z DKS (był DKS[0]) (v1.5). Był PIERWSZYM elementem,
   więc wszystkie pozostałe indeksy DKS przesuwają się o 1 w dół. Zdobycie
   Jawornika Wielkiego po prostu przepada — szczyt nie istnieje już w żadnym
   poziomie, więc nie ma dokąd go przenieść (inaczej niż przy Słonecznej). */
function migrateV6(s){
  if(s.schemaV6) return s;
  const oldDks = s.dks || [];
  const newDks = [];
  oldDks.forEach(i=>{
    if(i===0) return;                         // Jawornik Wielki: był DKS[0], usunięty
    else newDks.push(i-1);                    // reszta DKS przesuwa się o 1 w dół
  });
  s.dks = newDks;
  s.schemaV6 = true;
  return s;
}
/* Spitzberg: usunięty z DKS (był DKS[17]) (v1.6). Nie był ani pierwszym, ani
   ostatnim elementem, więc wszystkie indeksy DKS powyżej 17 przesuwają się o 1
   w dół. Zdobycie Spitzbergu po prostu przepada — szczyt nie istnieje już w
   żadnym poziomie, więc nie ma dokąd go przenieść (analogicznie do Jawornika
   Wielkiego w migrateV6). */
function migrateV7(s){
  if(s.schemaV7) return s;
  const oldDks = s.dks || [];
  const newDks = [];
  oldDks.forEach(i=>{
    if(i===17) return;                        // Spitzberg: był DKS[17], usunięty
    else if(i>17) newDks.push(i-1);           // reszta DKS powyżej niego przesuwa się o 1 w dół
    else newDks.push(i);
  });
  s.dks = newDks;
  s.schemaV7 = true;
  return s;
}
/* Restrukturyzacja WKS/DKS pod nowe kryterium Wielkiej Korony — wybitność
   ≥350 m lub izolacja >14 km (v1.7). Naraz: 12 szczytów WKS→DKS, oraz usunięcie
   łącznie 9 szczytów DKS (3 o wybitności <50 m, 6 z pasm już reprezentowanych
   w KS/WKS). Zbyt wiele niezależnych ruchów, żeby wyrazić to przesunięciami
   indeksów jak w migrateV2–V7 — mapowanie budowane wprost po nazwie szczytu,
   ze stanu tablic WKS(31)/DKS(24) sprzed tej zmiany (czyli stanu PO migrateV7)
   na stan obecny WKS(17)/DKS(27). null = szczyt usunięty, zdobycie przepada
   (analogicznie do Jawornika Wielkiego w migrateV6). KS nie ruszony. */
function migrateV8(s){
  if(s.schemaV8) return s;
  const WKS_TO_NEW = [{t:'wks',i:0},{t:'wks',i:1},{t:'wks',i:2},{t:'wks',i:3},{t:'wks',i:4},null,null,{t:'dks',i:20},{t:'wks',i:5},{t:'wks',i:6},{t:'dks',i:21},{t:'dks',i:22},{t:'dks',i:23},{t:'dks',i:24},{t:'wks',i:7},{t:'dks',i:25},{t:'wks',i:8},{t:'wks',i:9},{t:'wks',i:10},{t:'wks',i:11},null,null,{t:'wks',i:12},{t:'wks',i:13},null,null,{t:'wks',i:14},null,{t:'wks',i:15},null,{t:'wks',i:16}];
  const DKS_TO_NEW = [{t:'dks',i:0},{t:'dks',i:1},{t:'dks',i:2},{t:'dks',i:3},{t:'dks',i:4},{t:'dks',i:5},{t:'dks',i:6},{t:'dks',i:7},{t:'dks',i:8},{t:'dks',i:9},null,{t:'dks',i:10},null,{t:'dks',i:11},{t:'dks',i:12},{t:'dks',i:13},{t:'dks',i:14},{t:'dks',i:15},{t:'dks',i:16},{t:'dks',i:17},null,{t:'dks',i:18},null,{t:'dks',i:19}];
  const newWks = new Set();
  const newDks = new Set();
  (s.wks||[]).forEach(i=>{
    const dest = WKS_TO_NEW[i];
    if(!dest) return;
    (dest.t==='wks'?newWks:newDks).add(dest.i);
  });
  (s.dks||[]).forEach(i=>{
    const dest = DKS_TO_NEW[i];
    if(!dest) return;
    (dest.t==='wks'?newWks:newDks).add(dest.i);
  });
  s.wks = Array.from(newWks);
  s.dks = Array.from(newDks);
  s.schemaV8 = true;
  return s;
}
function loadState(){
  let s;
  try{
    s = JSON.parse(localStorage.getItem('korona_state3')||'{"ks":[],"wks":[],"dks":[],"unlocked_wks":false,"unlocked_dks":false}');
  }catch(e){
    s = {ks:[],wks:[],dks:[],unlocked_wks:false,unlocked_dks:false};
  }
  s = migratePeakTiers(s);
  s = migrateOkoleToWks(s);
  s = migrateV4(s);
  s = migrateV5(s);
  s = migrateV6(s);
  s = migrateV7(s);
  s = migrateV8(s);
  saveState(s);
  return s;
}
function saveState(s){
  try{localStorage.setItem('korona_state3',JSON.stringify(s));}catch(e){}
}

let STATE = loadState();
let currentTab = 'ks';
let ksMarkers = [], wksMarkers = [], dksMarkers = [];
let openPopupIdx = null, openPopupType = null;
const ksLayer = L.layerGroup();
const wksLayer = L.layerGroup();
const dksLayer = L.layerGroup();
const peaksVisible = {ks:true, wks:false, dks:false};

/* ═══════════════════════════════════════════
   MAP
═══════════════════════════════════════════ */
const map = L.map('map',{center:[50.35,16.1],zoom:7});

const MAPY_API_KEY = 'MqLkbBzesZfdJ8ALzwnbBzqbqCy5lNZNX1FjuT2pUS0';
const CARTO_API_KEY = 'cb1_3jva_1_cfb8b0b71c38c6a042eae66f';
const baseStandardLayer = L.tileLayer(`https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=${CARTO_API_KEY}`,{
  attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
  subdomains:'abcd',
  maxZoom:19
});
const baseOutdoorLayer = L.tileLayer(`https://api.mapy.com/v1/maptiles/outdoor/256/{z}/{x}/{y}?apikey=${MAPY_API_KEY}`,{
  minZoom:0, maxZoom:19,
  attribution:'<a href="https://api.mapy.com/copyright" target="_blank">&copy; Seznam.cz a.s. a další</a>'
});
const MapyLogoControl = L.Control.extend({
  options:{position:'bottomleft'},
  onAdd:function(){
    const container = L.DomUtil.create('div','mapy-logo-control');
    const link = L.DomUtil.create('a','',container);
    link.setAttribute('href','https://mapy.com/');
    link.setAttribute('target','_blank');
    link.setAttribute('rel','noopener');
    link.innerHTML = '<img src="https://api.mapy.com/img/api/logo.svg" width="90" alt="Mapy.com">';
    L.DomEvent.disableClickPropagation(link);
    return container;
  }
});
const mapyLogoControl = new MapyLogoControl();

function applyBasemap(which){
  if(which==='outdoor'){
    if(map.hasLayer(baseStandardLayer)) map.removeLayer(baseStandardLayer);
    if(!map.hasLayer(baseOutdoorLayer)) baseOutdoorLayer.addTo(map);
    mapyLogoControl.addTo(map);
  } else {
    if(map.hasLayer(baseOutdoorLayer)) map.removeLayer(baseOutdoorLayer);
    if(!map.hasLayer(baseStandardLayer)) baseStandardLayer.addTo(map);
    map.removeControl(mapyLogoControl);
  }
  document.querySelectorAll('.basemap-btn').forEach(b=>b.classList.toggle('active', b.dataset.basemap===which));
}
window.setBasemap = function(which){
  try{ localStorage.setItem('korona_basemap', which); }catch(e){}
  applyBasemap(which);
};
let savedBasemap = 'standard';
try{ savedBasemap = localStorage.getItem('korona_basemap') || 'standard'; }catch(e){}
applyBasemap(savedBasemap);

const COLOR_KS  = '#D4A017';
const COLORS_WKS = {Zachodnie:'#3D7ABF',Środkowe:'#3D8C5A',Wschodnie:'#C97A2A'};
const COLOR_DKS = '#7C3AED';

function markerSize(alt,type){
  if(type==='ks'){
    if(alt>=1400) return 20;
    if(alt>=900)  return 17;
    return 14;
  }
  if(type==='wks'){
    if(alt>=1400) return 17;
    if(alt>=900)  return 14;
    if(alt>=700)  return 12;
    return 10;
  }
  if(alt>=700) return 12;
  if(alt>=500) return 10;
  return 9;
}

function makeIcon(p, type, conquered){
  const sz = markerSize(p.alt, type);
  let col;
  if(conquered){
    col = type==='ks' ? '#F5C542' : type==='wks' ? '#22C55E' : '#A78BFA';
  } else {
    col = type==='ks' ? COLOR_KS : type==='wks' ? (COLORS_WKS[p.strefa]||'#3D7ABF') : COLOR_DKS;
  }
  const border = conquered ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.25)';
  const inner = conquered ? `<span style="font-size:${sz*0.55}px;line-height:1;color:#fff">✓</span>` : '';
  const shape = type==='ks' ? '4px' : '50%';
  return L.divIcon({
    className:'',
    html:`<div style="width:${sz}px;height:${sz}px;background:${col};border-radius:${shape};border:2px solid ${border};box-shadow:0 2px 8px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:transform .15s" onmouseover="this.style.transform='scale(1.3)'" onmouseout="this.style.transform='scale(1)'">${inner}</div>`,
    iconSize:[sz,sz],iconAnchor:[sz/2,sz/2],popupAnchor:[0,-sz/2-4]
  });
}

function buildPopup(p, type, idx){
  const arr = type==='ks'?STATE.ks:type==='wks'?STATE.wks:STATE.dks;
  const conq = arr.includes(idx);
  const iz = p.izol!==undefined?(p.izol%1===0?p.izol:p.izol.toFixed(1)):null;
  let btnHtml;
  if(conq){
    btnHtml=`<button class="pop-btn unconquer" onclick="togglePeak('${type}',${idx})">✗ Usuń zdobycie</button>`;
  } else {
    btnHtml=`<button class="pop-btn conquer" onclick="togglePeak('${type}',${idx})">⛰ Zdobyty!</button>`;
  }
  const lvl = type==='ks'?'🏆 Korona':type==='wks'?'⛰ Wielka Korona':'💎 Diamentowa';
  return `<div class="pop-inner">
    <div class="pop-name">${p.name}</div>
    <div class="pop-sub">${p.cz&&p.cz!=='—'?p.cz+' · ':''}${p.pasmo}</div>
    <div class="pop-stats">
      <div class="pop-stat"><div class="pop-sl">Poziom</div><div class="pop-sv">${lvl}</div></div>
      <div class="pop-stat"><div class="pop-sl">Wysokość</div><div class="pop-sv">${p.alt} m</div></div>
      ${p.prom?`<div class="pop-stat"><div class="pop-sl">Wybitność</div><div class="pop-sv">${p.prom} m</div></div>`:''}
      ${iz?`<div class="pop-stat"><div class="pop-sl">Izolacja</div><div class="pop-sv">${iz} km</div></div>`:''}
      <div class="pop-stat"><div class="pop-sl">Kraj</div><div class="pop-sv">${p.kraj}</div></div>
    </div>
    ${p.note?`<div class="pop-note">${p.note}</div>`:''}
    ${btnHtml}
  </div>`;
}


/* Leaflet's built-in autoPan czasem nie zdąży przesunąć mapy zanim popup
   zostanie zmierzony (wyścig z layoutem) — domiar i korekta na pewno. */
function ensurePopupVisible(marker){
  setTimeout(()=>{
    if(!marker.isPopupOpen()) return;
    const popup = marker.getPopup();
    const popupEl = popup && popup.getElement();
    const mapEl = document.getElementById('map');
    if(!popupEl || !mapEl) return;
    const pr = popupEl.getBoundingClientRect();
    const mr = mapEl.getBoundingClientRect();
    const margin = 10;
    const above = (mr.top + margin) - pr.top;
    const below = pr.bottom - (mr.bottom - margin);
    let dy = 0;
    if(above > 0) dy = -above;
    else if(below > 0) dy = below;
    if(dy) map.panBy([0, dy], {animate:false});
  }, 30);
}

function placeMarkers(){
  ksLayer.clearLayers(); wksLayer.clearLayers(); dksLayer.clearLayers();
  ksMarkers=[]; wksMarkers=[]; dksMarkers=[];

  KS.forEach((p,i)=>{
    const conq = STATE.ks.includes(i);
    const m = L.marker([p.lat,p.lng],{icon:makeIcon(p,'ks',conq),zIndexOffset:200})
      .bindPopup(buildPopup(p,'ks',i),{maxWidth:250,minWidth:220})
      .addTo(ksLayer);
    m.on('popupopen',()=>{openPopupIdx=i;openPopupType='ks';ensurePopupVisible(m);});
    ksMarkers.push(m);
  });

  WKS.forEach((p,i)=>{
    const conq = STATE.wks.includes(i);
    const m = L.marker([p.lat,p.lng],{icon:makeIcon(p,'wks',conq),zIndexOffset:100})
      .bindPopup(buildPopup(p,'wks',i),{maxWidth:250,minWidth:220})
      .addTo(wksLayer);
    m.on('popupopen',()=>{openPopupIdx=i;openPopupType='wks';ensurePopupVisible(m);});
    wksMarkers.push(m);
  });

  DKS.forEach((p,i)=>{
    const conq = STATE.dks.includes(i);
    const m = L.marker([p.lat,p.lng],{icon:makeIcon(p,'dks',conq)})
      .bindPopup(buildPopup(p,'dks',i),{maxWidth:250,minWidth:220})
      .addTo(dksLayer);
    m.on('popupopen',()=>{openPopupIdx=i;openPopupType='dks';ensurePopupVisible(m);});
    dksMarkers.push(m);
  });

  if(peaksVisible.ks)  ksLayer.addTo(map);
  if(peaksVisible.wks) wksLayer.addTo(map);
  if(peaksVisible.dks) dksLayer.addTo(map);
}

window.togglePeaksLayer = function(type){
  const layer = type==='ks'?ksLayer:type==='wks'?wksLayer:dksLayer;
  peaksVisible[type] = !peaksVisible[type];
  if(peaksVisible[type]) layer.addTo(map); else map.removeLayer(layer);
  const btn = document.getElementById('peaks-'+type+'-btn');
  const btnEn = document.getElementById('peaks-'+type+'-btn-en');
  if(btn) btn.classList.toggle('active', peaksVisible[type]);
  if(btnEn) btnEn.classList.toggle('active', peaksVisible[type]);
};

/* ═══════════════════════════════════════════
   TOGGLE PEAK
═══════════════════════════════════════════ */
window.togglePeak = function(type, idx){
  const fb = window._fb;
  if(fb && !fb.auth.currentUser){
    showAuthOverlay(function(){ window.togglePeak(type, idx); });
    return;
  }
  const arr = STATE[type];
  const pos = arr.indexOf(idx);
  if(pos===-1) arr.push(idx);
  else arr.splice(pos,1);
  saveState(STATE);

  const data = type==='ks'?KS:type==='wks'?WKS:DKS;
  const markers = type==='ks'?ksMarkers:type==='wks'?wksMarkers:dksMarkers;
  const p = data[idx];
  const conq = arr.includes(idx);
  markers[idx].setIcon(makeIcon(p,type,conq));
  markers[idx].setPopupContent(buildPopup(p,type,idx));

  updateUI();
  saveUserState();
};

/* ═══════════════════════════════════════════
   UI UPDATE
═══════════════════════════════════════════ */
function updateUI(){
  const ksDone  = STATE.ks.length;
  const wksDone = STATE.wks.length;
  const dksDone = STATE.dks.length;

  document.getElementById('ks-done').textContent  = ksDone;
  document.getElementById('wks-done').textContent = wksDone;
  document.getElementById('dks-done').textContent = dksDone;
  document.getElementById('ks-bar').style.width   = (ksDone/8*100)+'%';
  document.getElementById('wks-bar').style.width  = (wksDone/17*100)+'%';
  document.getElementById('dks-bar').style.width  = (dksDone/27*100)+'%';

  // Achievements
  const setAch = (id, earned, cls='earned') => {
    const el = document.getElementById(id);
    if(!el) return;
    el.classList.toggle(cls, earned);
  };
  setAch('ach-1',    ksDone>=1);
  setAch('ach-ks',   ksDone===8);
  setAch('ach-wks1', wksDone>=1,   'wks-earned');
  setAch('ach-wks',  wksDone===14, 'wks-earned');
  setAch('ach-dks1', dksDone>=1,   'dk-earned');
  setAch('ach-dks',  dksDone===27, 'dk-earned');

  // Unlock WKS
  if(ksDone===8 && !STATE.unlocked_wks){
    STATE.unlocked_wks = true;
    saveState(STATE);
    unlockLevel('wks');
  }
  // Unlock DKS
  if(wksDone===14 && !STATE.unlocked_dks && STATE.unlocked_wks){
    STATE.unlocked_dks = true;
    saveState(STATE);
    unlockLevel('dks');
  }

  document.getElementById('wks-prog-block').style.opacity = STATE.unlocked_wks ? '1' : '0.35';
  document.getElementById('dks-prog-block').style.opacity = STATE.unlocked_dks ? '1' : '0.35';

  renderList('ks');
  renderList('wks');
  renderList('dks');
}

function unlockLevel(type){
  if(type==='wks'){
    document.getElementById('tab-wks').classList.remove('locked');
    wksMarkers.forEach(m=>m.setOpacity(1));
    document.getElementById('unlock-title').textContent = 'Korona Sudetów zdobyta!';
    document.getElementById('unlock-sub').innerHTML = 'Ukończyłeś wszystkie <strong>8 szczytów</strong> Korony Sudetów.<br><br>Odblokowano <strong>Wielką Koronę Sudetów</strong> — 17 szczytów!';
    document.getElementById('unlock-close-btn').textContent = 'Zaczynam Wielką Koronę →';
    document.getElementById('unlock-close-btn').onclick = function(){ closeUnlock('wks'); };
  } else {
    document.getElementById('tab-dks').classList.remove('locked');
    dksMarkers.forEach(m=>m.setOpacity(1));
    document.getElementById('unlock-title').textContent = 'Wielka Korona zdobyta!';
    document.getElementById('unlock-sub').innerHTML = 'Ukończyłeś <strong>14 szczytów</strong> Wielkiej Korony Sudetów.<br><br>Odblokowano <strong>Diamentową Koronę Sudetów</strong> — 27 szczytów!';
    document.getElementById('unlock-close-btn').textContent = 'Zaczynam Diamentową Koronę →';
    document.getElementById('unlock-close-btn').onclick = function(){ closeUnlock('dks'); };
  }
  document.getElementById('unlock-overlay').classList.add('show');
}

window.closeUnlock = function(tab){
  document.getElementById('unlock-overlay').classList.remove('show');
  switchTab(tab||'wks');
};

/* ═══════════════════════════════════════════
   TABS
═══════════════════════════════════════════ */
window.switchTab = function(tab){
  currentTab = tab;
  ['ks','wks','dks'].forEach(t=>{
    document.getElementById('tab-'+t).classList.toggle('active', tab===t);
    document.getElementById('list-'+t).style.display = tab===t?'block':'none';
  });
};

/* ═══════════════════════════════════════════
   SIDEBAR LIST
═══════════════════════════════════════════ */
function renderList(type){
  const el = document.getElementById('list-'+type);
  const data = type==='ks'?KS:type==='wks'?WKS:DKS;
  const stateArr = STATE[type];
  const col = type==='ks'?COLOR_KS:type==='dks'?COLOR_DKS:null;
  el.innerHTML = data.map((p,i)=>{
    const conq = stateArr.includes(i);
    const c = col||(COLORS_WKS[p.strefa]||'#3D7ABF');
    return `<div class="peak-row ${conq?'conquered':''} ${type==='dks'?'dk-peak':''}"
      onclick="focusPeak('${type}',${i})">
      <div class="pr-check" style="border-color:${conq?'':c}">${conq?'✓':''}</div>
      <div class="pr-info">
        <div class="pr-name">${p.name}</div>
        <div class="pr-sub">${p.pasmo}</div>
        <div class="pr-elev">${p.alt} m n.p.m.</div>
      </div>
    </div>`;
  }).join('');
}

window.focusPeak = function(type, idx){
  if(!peaksVisible[type]) window.togglePeaksLayer(type);
  const data = type==='ks'?KS:type==='wks'?WKS:DKS;
  const markers = type==='ks'?ksMarkers:type==='wks'?wksMarkers:dksMarkers;
  const p = data[idx];
  map.flyTo([p.lat,p.lng],13,{duration:0.8});
  setTimeout(()=>markers[idx].openPopup(),900);
};

/* ═══════════════════════════════════════════
   PEAKS TABLE (filter · sort · jump to map)
═══════════════════════════════════════════ */
window.jumpToPeak = function(type, idx){
  const mapSection = document.getElementById('map-section');
  if(mapSection) mapSection.scrollIntoView({behavior:'smooth', block:'start'});
  setTimeout(()=>window.focusPeak(type, idx), 500);
};

let peaksFilter = 'all';
let peaksSortKey = null, peaksSortDir = 1;

function renderPeaksRows(){
  const tbody = document.getElementById('peaks-tbody');
  if(!tbody) return;
  const rows = Array.from(tbody.querySelectorAll('tr'));
  rows.forEach(r=>{
    const show = peaksFilter==='all' || r.dataset.level===peaksFilter;
    r.classList.toggle('hidden', !show);
  });
  const visible = rows.filter(r=>!r.classList.contains('hidden'));
  if(peaksSortKey){
    visible.sort((a,b)=>{
      const va = a.dataset[peaksSortKey], vb = b.dataset[peaksSortKey];
      const na = parseFloat(va), nb = parseFloat(vb);
      const cmp = (!isNaN(na) && !isNaN(nb)) ? (na-nb) : String(va).localeCompare(String(vb),'pl');
      return cmp * peaksSortDir;
    });
    visible.forEach(r=>tbody.appendChild(r));
  }
  visible.forEach((r,i)=>{
    const rankCell = r.querySelector('.peak-rank');
    if(rankCell) rankCell.textContent = i+1;
  });
  const countEl = document.getElementById('peaks-count');
  const countElEn = document.getElementById('peaks-count-en');
  if(countEl) countEl.textContent = visible.length;
  if(countElEn) countElEn.textContent = visible.length;
}

window.filterPeaksTable = function(level){
  peaksFilter = level;
  document.querySelectorAll('.filter-pill').forEach(p=>p.classList.toggle('active', p.dataset.filter===level));
  renderPeaksRows();
};

function initPeaksTable(){
  document.querySelectorAll('#peaks-table thead th[data-sort]').forEach(th=>{
    th.addEventListener('click', ()=>{
      const key = th.dataset.sort;
      if(peaksSortKey===key) peaksSortDir *= -1; else { peaksSortKey = key; peaksSortDir = 1; }
      renderPeaksRows();
    });
  });
}

/* ═══════════════════════════════════════════
   RESET
═══════════════════════════════════════════ */
window.resetAll = function(){
  if(!confirm('Zresetować cały postęp? Tej operacji nie można cofnąć.')) return;
  STATE = {ks:[],wks:[],dks:[],unlocked_wks:false,unlocked_dks:false};
  saveState(STATE);
  document.getElementById('tab-wks').classList.add('locked');
  document.getElementById('tab-dks').classList.add('locked');
  placeMarkers();
  updateUI();
  renderList('wks');
  renderList('dks');
  switchTab('ks');
};

/* ═══════════════════════════════════════════
   INIT
═══════════════════════════════════════════ */
placeMarkers();
updateUI();
renderList('ks');
renderList('wks');
renderList('dks');
initPeaksTable();

if(STATE.unlocked_dks) document.getElementById('tab-dks').classList.remove('locked');
// Naprawia renderowanie kafelków gdy mapa była ukryta podczas inicjalizacji
setTimeout(()=>{ map.invalidateSize(); }, 300);
setTimeout(()=>{ map.invalidateSize(); }, 800);

// Odśwież mapę gdy użytkownik doscrolluje do sekcji mapy
const mapSection = document.getElementById('map-section');
if(mapSection){
  const mapObs = new IntersectionObserver((entries)=>{
    entries.forEach(e=>{ if(e.isIntersecting) map.invalidateSize(); });
  }, {threshold:0.1});
  mapObs.observe(mapSection);
}



const GRUPY_HUE={1:275,2:205,3:175,4:42,5:16,6:355,7:130,8:33};
const PASMO_GROUP={'Pogórze Zachodniołużyckie':1,'Płaskowyż Budziszyński':1,'Pogórze Wschodniołużyckie':1,'Kotlina Żytawska':1,'Góry Łużyckie':1,'Pogórze Łużyckie':1,'Karkonosze':2,'Kotlina Jeleniogórska':2,'Góry Izerskie':2,'Podgórze Karkonoskie':2,'Grzbiet Jesztedzko-Kozakowski':2,'Rudawy Janowickie':2,'Góry Kaczawskie':2,'Pogórze Izerskie':3,'Pogórze Kaczawskie':3,'Kotlina Kamiennogórska':4,'Góry Kamienne':4,'Góry Wałbrzyskie':4,'Pogórze Wałbrzyskie':4,'Góry Sowie':4,'Góry Stołowe':4,'Obniżenie Ścinawki (Kotlina Broumovska)':4,'Obniżenie Nowej Rudy':4,'Kotlina Kłodzka':4,'Góry Bardzkie':4,'Góry Orlickie':5,'Góry Bystrzyckie':5,'Pogórze Orlickie':5,'Zábřežská vrchovina':5,'Rów Górnej Nysy':5,'Mohelnicka brázda':5,'Masyw Śnieżnika':6,'Góry Złote':6,'Wysoki Jesionik':6,'Sokoli Grzbiet':6,'Pogórze Żulowskie':6,'Pogórze Burgrabickie':6,'Góry Złotogórskie':6,'Hanušovická vrchovina':6,'Niski Jesionik':7,'Góry Opawskie':7,'Pogórze Opawskie':7,'Pogórze Witkowskie':7,'Pogórze Trszickie':7,'Wzgórza Niemczańsko-Strzelińskie':8,'Masyw Ślęży':8,'Równina Świdnicka':8,'Obniżenie Podsudeckie':8,'Wzgórza Strzegomskie':8};
const PASMO_LEVEL={'Karkonosze':'h','Góry Izerskie':'h','Grzbiet Jesztedzko-Kozakowski':'h','Góry Łużyckie':'h','Góry Kaczawskie':'h','Góry Kamienne':'h','Góry Wałbrzyskie':'h','Góry Sowie':'h','Góry Stołowe':'h','Góry Orlickie':'h','Góry Bystrzyckie':'h','Masyw Śnieżnika':'h','Góry Złote':'h','Wysoki Jesionik':'h','Góry Opawskie':'h','Masyw Ślęży':'h','Góry Bardzkie':'m','Niski Jesionik':'m','Podgórze Karkonoskie':'m','Rudawy Janowickie':'m','Pogórze Izerskie':'m','Pogórze Kaczawskie':'m','Pogórze Wałbrzyskie':'m','Pogórze Zachodniołużyckie':'m','Pogórze Wschodniołużyckie':'m','Pogórze Łużyckie':'m','Płaskowyż Budziszyński':'m','Zábřežská vrchovina':'m','Pogórze Orlickie':'m','Sokoli Grzbiet':'m','Góry Złotogórskie':'m','Hanušovická vrchovina':'m','Pogórze Burgrabickie':'m','Pogórze Żulowskie':'m','Pogórze Witkowskie':'m','Pogórze Trszickie':'m','Pogórze Opawskie':'m','Wzgórza Strzegomskie':'m','Wzgórza Niemczańsko-Strzelińskie':'m','Kotlina Żytawska':'l','Kotlina Jeleniogórska':'l','Kotlina Kamiennogórska':'l','Obniżenie Ścinawki (Kotlina Broumovska)':'l','Obniżenie Nowej Rudy':'l','Rów Górnej Nysy':'l','Kotlina Kłodzka':'l','Mohelnicka brázda':'l','Równina Świdnicka':'l','Obniżenie Podsudeckie':'l'};
const GRUPY_COLORS={1:{name:'Sudety Łużyckie',fill:'#8338EC',stroke:'#5F20B0'},2:{name:'Sudety Zachodnie',fill:'#0077B6',stroke:'#005A8E'},3:{name:'Pogórze Zachodniosudeckie',fill:'#06B49A',stroke:'#048870'},4:{name:'Sudety Środkowe',fill:'#E9C46A',stroke:'#C4983A'},5:{name:'Sudety Orlickie',fill:'#E76F51',stroke:'#BF4E30'},6:{name:'Sudety Wschodnie',fill:'#C1121F',stroke:'#8B0D16'},7:{name:'Sudety Kulmowe',fill:'#4CAF50',stroke:'#2E7D32'},8:{name:'Przedgórze Sudeckie',fill:'#FF9F1C',stroke:'#C97800'}};
function stripHoles(f){if(!f||!f.geometry)return f;if(f.geometry.type==='Polygon')f.geometry.coordinates=[f.geometry.coordinates[0]];else if(f.geometry.type==='MultiPolygon')f.geometry.coordinates=f.geometry.coordinates.map(p=>[p[0]]);return f;}
function computeGrupy(){const gu={};for(let g=1;g<=8;g++){const mb=PASMA_GEOJSON.features.filter(f=>PASMO_GROUP[f.properties.name]===g);if(!mb.length)continue;let u=JSON.parse(JSON.stringify(mb[0]));for(let i=1;i<mb.length;i++){let member=JSON.parse(JSON.stringify(mb[i]));try{const buf=turf.buffer(member,0.01,{units:'kilometers'});if(buf){buf.properties=member.properties;member=buf;}}catch(e){}try{u=turf.union(u,member);}catch(e){}}u.properties={name:GRUPY_COLORS[g].name,id:g};gu[g]=stripHoles(u);}const res=[];for(let g=1;g<=8;g++){if(gu[g])res.push(gu[g]);}return{type:'FeatureCollection',features:res};}
GRUPY_GEOJSON=computeGrupy();
PASMA_GEOJSON.features.forEach(f=>{if(f.geometry.type==='Polygon'){f.geometry.coordinates=[f.geometry.coordinates[0]];}else if(f.geometry.type==='MultiPolygon'){f.geometry.coordinates=f.geometry.coordinates.map(p=>[p[0]]);}});const pasmaLayer=L.geoJSON(PASMA_GEOJSON,{style:f=>{const n=f.properties.name;const g=PASMO_GROUP[n]||0;const lv=PASMO_LEVEL[n]||'m';const hue=GRUPY_HUE[g]||0;const [sf,lf]=lv==='h'?[62,36]:lv==='m'?[38,56]:[28,68];return{fillColor:`hsl(${hue},${sf}%,${lf}%)`,fillOpacity:lv==='h'?0.28:lv==='m'?0.18:0.16,color:`hsl(${hue},${sf+12}%,${lf-14}%)`,weight:lv==='h'?1.5:1.2,opacity:0.7};},onEachFeature:(f,l)=>{l.bindTooltip(f.properties.name,{sticky:true,className:'pasmo-tooltip',direction:'top',offset:[0,-4]});l.on('mouseover',function(){this.setStyle({fillOpacity:0.28,weight:2,opacity:0.85});});l.on('mouseout',function(){pasmaLayer.resetStyle(this);});}});
let grupyVisible=false;
const grupyLayer=L.geoJSON(GRUPY_GEOJSON,{style:f=>{const c=GRUPY_COLORS[f.properties.id]||{fill:'#888',stroke:'#555'};return{fillColor:c.fill,fillOpacity:0.07,color:c.stroke,weight:2.5,opacity:0.85,dashArray:'8,5'};},onEachFeature:(f,l)=>{l.bindTooltip('<b>'+f.properties.name+'</b>',{sticky:true,className:'pasmo-tooltip',direction:'top',offset:[0,-4]});l.on('mouseover',function(){this.setStyle({fillOpacity:0.18,weight:3.5});});l.on('mouseout',function(){grupyLayer.resetStyle(this);});}});
window.toggleGrupy=function(){grupyVisible=!grupyVisible;if(grupyVisible){grupyLayer.addTo(map);document.getElementById('grupy-btn').classList.add('active');}else{map.removeLayer(grupyLayer);document.getElementById('grupy-btn').classList.remove('active');}document.getElementById('grupy-legend').style.display=grupyVisible?'flex':'none';};
let sudetyOutline=null; /* computed lazily on first toggle */
const sudetyLayer=L.geoJSON(sudetyOutline,{style:{fillColor:'transparent',fillOpacity:0,color:'#C0392B',weight:2.5,opacity:0.9,dashArray:'10,6'}});
let sudetyVisible=false;
window.toggleSudety=function(){if(!sudetyOutline){let u=GRUPY_GEOJSON.features[0];for(let i=1;i<GRUPY_GEOJSON.features.length;i++){try{u=turf.union(u,GRUPY_GEOJSON.features[i]);}catch(e){}}sudetyOutline=stripHoles(u);sudetyLayer.addData(sudetyOutline);}sudetyVisible=!sudetyVisible;if(sudetyVisible){sudetyLayer.addTo(map);document.getElementById('sudety-btn').classList.add('active');document.getElementById('sudety-btn-en').classList.add('active');}else{map.removeLayer(sudetyLayer);document.getElementById('sudety-btn').classList.remove('active');document.getElementById('sudety-btn-en').classList.remove('active');}};
let pasmaVisible=false;
toggleSudety();
window.togglePasma=function(){pasmaVisible=!pasmaVisible;if(pasmaVisible){pasmaLayer.addTo(map);document.getElementById('pasma-btn').classList.add('active');document.getElementById('pasma-btn-en').classList.add('active');}else{map.removeLayer(pasmaLayer);document.getElementById('pasma-btn').classList.remove('active');document.getElementById('pasma-btn-en').classList.remove('active');};};
const obs=new IntersectionObserver(e=>{e.forEach(x=>{if(x.isIntersecting)x.target.classList.add('visible');});},{threshold:0.1});
document.querySelectorAll('.fade-in').forEach(el=>obs.observe(el));

/* ═══════════════════════════════════════════
   AUTH
═══════════════════════════════════════════ */
let _pendingAction = null;

function showAuthOverlay(pendingFn){
  _pendingAction = pendingFn || null;
  document.getElementById('auth-err').textContent = '';
  document.getElementById('auth-overlay').classList.remove('hidden');
}

function hideAuthOverlay(){
  document.getElementById('auth-overlay').classList.add('hidden');
  _pendingAction = null;
}
window.hideAuthOverlay = hideAuthOverlay;

window.authTab = function(tab){
  document.getElementById('auth-login').style.display = tab==='login'?'':'none';
  document.getElementById('auth-reg').style.display   = tab==='reg'?'':'none';
  document.getElementById('at-login').classList.toggle('on', tab==='login');
  document.getElementById('at-reg').classList.toggle('on', tab==='reg');
  document.getElementById('auth-err').textContent = '';
};

window.doLogin = async function(){
  const email = document.getElementById('li-email').value.trim();
  const pass  = document.getElementById('li-pass').value;
  const err   = document.getElementById('auth-err');
  const btn   = document.querySelector('#auth-login .auth-btn');
  err.textContent = '';
  btn.disabled = true;
  try {
    const {auth, signInWithEmailAndPassword} = window._fb;
    await signInWithEmailAndPassword(auth, email, pass);
  } catch(e) {
    err.textContent = friendlyError(e.code);
    btn.disabled = false;
  }
};

window.doRegister = async function(){
  const name  = document.getElementById('re-name').value.trim();
  const email = document.getElementById('re-email').value.trim();
  const pass  = document.getElementById('re-pass').value;
  const err   = document.getElementById('auth-err');
  const btn   = document.querySelector('#auth-reg .auth-btn');
  err.textContent = '';
  btn.disabled = true;
  try {
    const {auth, createUserWithEmailAndPassword, updateProfile} = window._fb;
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    if(name) await updateProfile(cred.user, {displayName: name});
  } catch(e) {
    err.textContent = friendlyError(e.code);
    btn.disabled = false;
  }
};

function friendlyError(code){
  const map = {
    'auth/invalid-email':          'Niepoprawny adres email.',
    'auth/user-not-found':         'Nie znaleziono konta z tym adresem.',
    'auth/wrong-password':         'Błędne hasło.',
    'auth/email-already-in-use':   'Ten adres jest już zajęty.',
    'auth/weak-password':          'Hasło musi mieć minimum 6 znaków.',
    'auth/invalid-credential':     'Niepoprawny email lub hasło.',
    'auth/too-many-requests':      'Zbyt wiele prób. Spróbuj za chwilę.',
  };
  return map[code] || 'Wystąpił błąd. Spróbuj ponownie.';
}

window.doSignOut = async function(){
  const {auth, signOut} = window._fb;
  await signOut(auth);
};

function showFeedbackOverlay(){
  document.getElementById('fb-form-view').style.display = '';
  document.getElementById('fb-ok-view').style.display = 'none';
  document.getElementById('fb-message').value = '';
  document.getElementById('fb-email').value = '';
  document.getElementById('fb-err').textContent = '';
  document.getElementById('fb-submit-btn').disabled = false;
  document.getElementById('feedback-overlay').classList.remove('hidden');
}
window.showFeedbackOverlay = showFeedbackOverlay;

function hideFeedbackOverlay(){
  document.getElementById('feedback-overlay').classList.add('hidden');
}
window.hideFeedbackOverlay = hideFeedbackOverlay;

window.submitFeedback = async function(){
  const message = document.getElementById('fb-message').value.trim();
  const email   = document.getElementById('fb-email').value.trim();
  const err     = document.getElementById('fb-err');
  const btn     = document.getElementById('fb-submit-btn');
  err.textContent = '';
  if(!message){
    err.textContent = 'Wpisz treść wiadomości.';
    return;
  }
  btn.disabled = true;
  try {
    const fb = window._fb;
    const user = fb.auth.currentUser;
    const ref = fb.doc(fb.collection(fb.db, 'feedback'));
    await fb.setDoc(ref, {
      message,
      email: email || null,
      userId: user ? user.uid : null,
      displayName: user ? (user.displayName || user.email) : null,
      createdAt: fb.serverTimestamp()
    });
    document.getElementById('fb-form-view').style.display = 'none';
    document.getElementById('fb-ok-view').style.display = '';
  } catch(e){
    console.warn('Zapis zgłoszenia nieudany', e);
    err.textContent = 'Nie udało się wysłać. Spróbuj ponownie.';
    btn.disabled = false;
  }
};

const navBtnStyle = 'background:none;border:1px solid rgba(255,255,255,0.25);color:#E6EDF3;border-radius:6px;padding:0.3rem 0.75rem;cursor:pointer;font-size:0.82rem;display:flex;align-items:center;gap:0.4rem;transition:background 0.2s;font-family:inherit;white-space:nowrap';

function renderUserBar(user){
  const bar = document.getElementById('user-bar');
  const navBar = document.getElementById('user-bar-nav');
  if(user){
    bar.innerHTML = `<span class="ub-name">Hej, <strong>${user.displayName || user.email}</strong></span>
      <button class="ub-btn rank" onclick="openRanking()">🏆 Ranking</button>
      <button class="ub-btn" onclick="doSignOut()">Wyloguj</button>`;
    if(navBar) navBar.innerHTML = `<button style="${navBtnStyle}" onclick="doSignOut()">Wyloguj (${user.displayName || user.email})</button>`;
  } else {
    bar.innerHTML = `<button class="ub-btn" onclick="showAuthOverlay()">Zaloguj się</button>`;
    if(navBar) navBar.innerHTML = `<button style="${navBtnStyle}" onclick="showAuthOverlay()"><span class="lang-pl">Zaloguj się</span><span class="lang-en" style="display:none">Log in</span></button>`;
  }
}

async function saveUserState(){
  const fb = window._fb;
  if(!fb) return;
  const user = fb.auth.currentUser;
  if(!user) return;
  try {
    await fb.setDoc(fb.doc(fb.db, 'users', user.uid), {
      ks: STATE.ks,
      wks: STATE.wks,
      dks: STATE.dks,
      unlocked_wks: STATE.unlocked_wks,
      unlocked_dks: STATE.unlocked_dks,
      schemaV2: STATE.schemaV2 || false,
      schemaV3: STATE.schemaV3 || false,
      schemaV4: STATE.schemaV4 || false,
      schemaV5: STATE.schemaV5 || false,
      schemaV6: STATE.schemaV6 || false,
      schemaV7: STATE.schemaV7 || false,
      schemaV8: STATE.schemaV8 || false,
      updatedAt: fb.serverTimestamp(),
      displayName: user.displayName || user.email
    }, {merge: true});
  } catch(e){ console.warn('Zapis do Firebase nieudany', e); }
}

async function loadUserState(user){
  const fb = window._fb;
  if(!fb) return;
  try {
    const snap = await fb.getDoc(fb.doc(fb.db, 'users', user.uid));
    if(snap.exists()){
      const d = snap.data();
      STATE.ks  = d.ks  || [];
      STATE.wks = d.wks || [];
      STATE.dks = d.dks || [];
      STATE.unlocked_wks = d.unlocked_wks || false;
      STATE.unlocked_dks = d.unlocked_dks || false;
      STATE.schemaV2 = d.schemaV2 || false;
      STATE.schemaV3 = d.schemaV3 || false;
      STATE.schemaV4 = d.schemaV4 || false;
      STATE.schemaV5 = d.schemaV5 || false;
      STATE.schemaV6 = d.schemaV6 || false;
      STATE.schemaV7 = d.schemaV7 || false;
      STATE.schemaV8 = d.schemaV8 || false;
      const wasAlreadyMigrated = STATE.schemaV2 && STATE.schemaV3 && STATE.schemaV4 && STATE.schemaV5 && STATE.schemaV6 && STATE.schemaV7 && STATE.schemaV8;
      STATE = migratePeakTiers(STATE);
      STATE = migrateOkoleToWks(STATE);
      STATE = migrateV4(STATE);
      STATE = migrateV5(STATE);
      STATE = migrateV6(STATE);
      STATE = migrateV7(STATE);
      STATE = migrateV8(STATE);
      saveState(STATE);
      if(!wasAlreadyMigrated) saveUserState(); // odeślij skorygowane dane z powrotem do chmury
      placeMarkers();
      updateUI();

      if(STATE.unlocked_dks) document.getElementById('tab-dks').classList.remove('locked');
    }
  } catch(e){ console.warn('Odczyt z Firebase nieudany', e); }
}

/* ═══════════════════════════════════════════
   RANKING
═══════════════════════════════════════════ */
let _rankTab = 'all';

window.openRanking = async function(){
  document.getElementById('ranking-overlay').classList.remove('hidden');
  await loadRanking();
};

window.closeRanking = function(){
  document.getElementById('ranking-overlay').classList.add('hidden');
};

window.rankTab = function(tab){
  _rankTab = tab;
  document.getElementById('rt-all').classList.toggle('on', tab==='all');
  document.getElementById('rt-wk').classList.toggle('on',  tab==='wk');
  document.getElementById('rt-dk').classList.toggle('on',  tab==='dk');
  document.getElementById('rt-dk').classList.toggle('dk',  tab==='dk');
  loadRanking();
};

async function loadRanking(){
  const fb = window._fb;
  const el = document.getElementById('rank-content');
  el.innerHTML = '<div class="rank-loading">Ładowanie...</div>';
  try {
    const snap = await fb.getDocs(fb.collection(fb.db,'users'));
    let rows = [];
    snap.forEach(d=>{
      const u = d.data();
      if(_rankTab==='wk'  && (u.wks||[]).length<17) return;
      if(_rankTab==='dk'  && (u.dks||[]).length<27) return;
      rows.push(u);
    });
    rows.sort((a,b)=>{
      const aks=(a.ks||[]).length,   bks=(b.ks||[]).length;
      const awks=(a.wks||[]).length, bwks=(b.wks||[]).length;
      const adks=(a.dks||[]).length, bdks=(b.dks||[]).length;
      return (bdks-adks)||(bwks-awks)||(bks-aks);
    });
    if(!rows.length){ el.innerHTML='<div class="rank-empty">Brak wyników w tej kategorii.</div>'; return; }
    const medals=['🥇','🥈','🥉'];
    el.innerHTML=`<table class="rank-table"><thead><tr>
      <th>#</th><th>Zdobywca</th><th>KS</th><th>WKS</th><th>DKS</th>
    </tr></thead><tbody>${rows.map((u,i)=>`<tr>
      <td class="rank-medal">${medals[i]||i+1}</td>
      <td><div class="rank-name">${u.displayName||'Anonimowy'}</div></td>
      <td>${(u.ks||[]).length}/8 ${(u.ks||[]).length===8?'<span class="rank-crown wk">🏆</span>':''}</td>
      <td>${(u.wks||[]).length}/17 ${(u.wks||[]).length===17?'<span class="rank-crown wk">👑</span>':''}</td>
      <td>${(u.dks||[]).length}/27 ${(u.dks||[]).length===27?'<span class="rank-crown dk">💎</span>':''}</td>
    </tr>`).join('')}</tbody></table>`;
  } catch(e){ el.innerHTML='<div class="rank-empty">Błąd ładowania rankingu.</div>'; }
}

/* ═══════════════════════════════════════════
   FIREBASE AUTH LISTENER
═══════════════════════════════════════════ */
renderUserBar(null); // pokaż przycisk od razu, nie czekając na (wolne lub zablokowane) połączenie z Firebase
(function waitForFb(){
  if(!window._fb){ setTimeout(waitForFb, 100); return; }
  window._fb.onAuthStateChanged(window._fb.auth, async function(user){
    if(user){
      hideAuthOverlay();
      renderUserBar(user);
      await loadUserState(user);
      if(_pendingAction){ _pendingAction(); _pendingAction = null; }
    } else {
      renderUserBar(null);
    }
  });
})();

