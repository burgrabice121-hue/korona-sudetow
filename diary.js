/* ═══════════════════════════════════════════════════════════
   diary.js — pamiętnik zdobywania: wejścia na szczyty.
   Dane: Firestore users/{uid}/visits/{visitId}  (reguły: firestore.rules).
   Jedno wejście = jeden dokument; na szczyt można wejść wiele razy.
   Szczyt wskazuje pole `peakId` = `id` z peaks-data.js (NIE indeks w tablicy).
   Wspólny dla viasudetica.eu i wielkakoronasudetow.pl; ładowany po app.js.
═══════════════════════════════════════════════════════════ */
(function(){
'use strict';

var MAX_NOTE = 5000, MAX_COMP = 20, MAX_COMP_LEN = 60, MAX_LINK = 500, MAX_PLACE = 100;
var MAX_KM = 1000, MAX_ASCENT = 10000;
// MAX_PHOTOS: własne zdjęcia; wejście wspólne (partners = liczba współuczestników z przyjętych zaproszeń)
// mieści dodatkowo po MAX_PHOTOS zdjęć od każdego (ext) — jak reguła validVisit i functions/sync.js
var MAX_PHOTOS = 6, MAX_PARTNERS = 21, PHOTO_MAX_PX = 1600, THUMB_MAX_PX = 320, MAX_SRC_BYTES = 30*1024*1024;
var urlCache = {};     // ścieżka w Storage -> adres do pokazania

/* Udostępnianie wejść uczestnikom (zaproszenia, kolekcja invites/). Plan:
   session-logs/2026-10-15-udostepnianie-zdobycia-plan.md. Włączone 2026-10-15 po wdrożeniu funkcji
   serwera (functions/) i reguł; awaryjne wyłączenie u siebie: localStorage korona_invites = '0'. */
var INVITES_ON = true;
try{ if(localStorage.getItem('korona_invites')==='0') INVITES_ON = false; }catch(e){}
var MAX_INVITES = 20, INVITE_DAYS = 30;
var EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;
var incoming = [];     // zaproszenia do mnie (oczekujące)
var sent = [];         // zaproszenia wysłane dla wejścia w formularzu
var linked = [];       // przyjęte zaproszenie, z którego pochodzi wejście w formularzu (strona odbiorcy)
var offersIn = [];     // propozycje zmian we wspólnych wejściach, do mnie (oczekujące)

var visits = {};       // visitId -> dane wejścia (z polem peakId)
var hiddenVisits = {}; // wejścia na szczyty Korony Pogórzy (przed premierą, bez administratora): nie pokazywane
var loadOk = false;    // true tylko po udanym odczycie (inaczej nie pozwalamy zapisywać "na ślepo")
var loadPromise = null;
var loadedAt = 0;      // kiedy ostatnio wczytano wejścia (odświeżanie po powrocie na kartę)
var cur = null;        // stan formularza
var curSig = '';       // podpis formularza do wykrywania niezapisanych zmian
var listTab = 'all';
/* Książka osób (P37, functions/people.js): byUid {uid: jak nazywam tę osobę}, alias {pnorm(imię): uid}.
   Towarzysze w wejściach zostają tekstem; książka mówi, które napisy to to samo konto i jak je pokazać.
   Konta łączy serwer przy przyjęciu zaproszenia; tu tylko odczyt, zmiana nazw, dopinanie pisowni, rozłączanie. */
var people = {byUid:{}, alias:{}};
var pending = null;    // imię prawie takie jak istniejące: {name, near} — czeka na „Tak / Nie, inna osoba”
var peopleOpen = false;
var compFilter = null;   // personKey towarzysza wybranego w „Moje wejścia”: lista pokazuje tylko wspólne wejścia

/* ── CSS (ładowany obok diary.js, także na drugiej domenie) ── */
(function injectCss(){
  try{
    var src = document.currentScript && document.currentScript.src;
    var href = src ? src.replace(/diary\.js(\?.*)?$/, 'diary.css$1') : 'diary.css';
    var l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = href;
    document.head.appendChild(l);
  }catch(e){}
})();

/* ── pomocnicze ── */
function $(id){ return document.getElementById(id); }
function esc(s){
  return String(s==null?'':s).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}
/* polska liczba mnoga: 1 szczyt, 2–4 szczyty, 5 szczytów (12–14 też „szczytów”) */
function plural(n, one, few, many){
  var d = n % 10, t = n % 100;
  return n===1 ? one : (d>=2 && d<=4 && (t<12 || t>14)) ? few : many;
}
function fmtDate(iso){
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso||'');
  return m ? m[3]+'.'+m[2]+'.'+m[1] : '';
}
/* data wejścia do pokazania; orientacyjna (dateApprox) z „ok.” */
function fmtVisitDate(v){ return v && v.date ? (v.dateApprox ? 'ok. ' : '') + fmtDate(v.date) : ''; }
function fmtNum(n){ return String(n).replace('.', ','); }
function todayIso(){
  var d = new Date();
  function p(n){ return (n<10?'0':'')+n; }
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());
}
function fb(){ return window._fb; }
function curUser(){ var f = fb(); return f && f.auth && f.auth.currentUser; }
function tierArr(type){ return type==='ks'?KS:type==='wks'?WKS:type==='kps'?KPS:DKS; }
function tierLabel(type){ return type==='ks'?'KS':type==='wks'?'WKS':type==='kps'?'KPS':'DKS'; }
/* Korona Pogórzy Sudeckich (2026-11-13): do premiery tylko dla administratorów (app.js kpsVisible) */
function kpsOn(){ return typeof window.kpsVisible==='function' && window.kpsVisible(); }
function tiersShown(){ return kpsOn() ? ['ks','wks','dks','kps'] : ['ks','wks','dks']; }
/* krótka nazwa jak w górnym pasku — tam, gdzie mieści się zamiast skrótu (zakładki, podtytuł) */
function tierShort(type){ return type==='ks'?'Korona':type==='wks'?'Wielka':type==='kps'?'Pogórza':'Diamentowa'; }
/* pełna nazwa: dla osób nowych na portalu (okno zaproszenia) i w podpowiedzi do skrótu */
function tierName(type){ return type==='ks'?'Korona Sudetów':type==='wks'?'Wielka Korona Sudetów':type==='kps'?'Korona Pogórzy Sudeckich':'Diamentowa Korona Sudetów'; }
function visitsCol(f, uid){ return f.collection(f.db,'users',uid,'visits'); }
function peopleRef(f, uid){ return f.doc(f.db,'people',uid); }

/* ── osoby: klucz porównania jak norm() w functions/people.js (zmieniać razem) ── */
function pnorm(s){
  return String(s==null?'':s).toLowerCase().replace(/ł/g,'l').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/\./g,' ').replace(/\s+/g,' ').trim();
}
function personOf(name){ var u = people.alias[pnorm(name)]; return u && people.byUid[u] ? u : null; }
function shownName(name){
  var u = personOf(name);
  return u ? people.byUid[u] : (spelled[pnorm(name)] || String(name).replace(/\s+/g,' ').trim());
}
/* osoba bez konta: jedna pisownia w całym pamiętniku — najczęstsza, przy remisie dłuższa,
   a potem z polskimi znakami i wielką literą („Zośka” przed „Zoska”, „Ania” przed „ania”) */
var spelled = {};
function indexSpellings(){
  var cnt = {};
  Object.keys(visits).forEach(function(id){
    visits[id].companions.forEach(function(c){
      var n = c.replace(/\s+/g,' ').trim(), k = pnorm(n);
      if(!k) return;
      (cnt[k] = cnt[k] || {})[n] = (cnt[k][n] || 0) + 1;
    });
  });
  var rich = function(x){ return (x.match(/[^\x00-\x7f]/g)||[]).length*2 + (x.match(/[A-ZĄĆĘŁŃÓŚŹŻ]/g)||[]).length; };
  spelled = {};
  Object.keys(cnt).forEach(function(k){
    spelled[k] = Object.keys(cnt[k]).sort(function(a, b){
      return cnt[k][b] - cnt[k][a] || b.length - a.length || rich(b) - rich(a) || (a < b ? -1 : 1);
    })[0];
  });
}
function personKey(name){ var u = personOf(name); return u ? 'u:'+u : 'n:'+pnorm(name); }
/* towarzysze do pokazania: pisownia z książki, każda osoba raz */
function shownList(arr){
  var seen = {}, out = [];
  (arr||[]).forEach(function(c){
    var k = personKey(c);
    if(!pnorm(c) || seen[k]) return;
    seen[k] = 1; out.push(shownName(c));
  });
  return out;
}
/* etykieta jak cleanLabel() w functions/people.js */
function cleanLabel(s){ return String(s==null?'':s).replace(/[@\/:<>\\]/g,' ').replace(/\s+/g,' ').trim().slice(0, MAX_COMP_LEN); }
/* wszystkie osoby z wejść i książki: {key, uid, name, c (liczba wejść), spell (pisownie w wejściach)} */
function peopleEntries(){
  var map = {};
  Object.keys(visits).forEach(function(id){
    var seen = {};
    visits[id].companions.forEach(function(c){
      if(!pnorm(c)) return;
      var k = personKey(c);
      var e = map[k] || (map[k] = {key:k, uid:k.indexOf('u:')===0 ? k.slice(2) : null, name:shownName(c), c:0, spell:{}});
      e.spell[c.replace(/\s+/g,' ').trim()] = 1;
      if(!seen[k]){ seen[k] = 1; e.c++; }
    });
  });
  Object.keys(people.byUid).forEach(function(u){
    if(!map['u:'+u]) map['u:'+u] = {key:'u:'+u, uid:u, name:people.byUid[u], c:0, spell:{}};
  });
  return Object.keys(map).map(function(k){ return map[k]; });
}
function lev1(a, b){                                // odległość edycyjna <= 1
  if(a===b) return true;
  var la = a.length, lb = b.length;
  if(Math.abs(la-lb) > 1) return false;
  var i = 0; while(i < la && i < lb && a[i]===b[i]) i++;
  if(la===lb) return a.slice(i+1)===b.slice(i+1);
  return la > lb ? a.slice(i+1)===b.slice(i) : a.slice(i)===b.slice(i+1);
}
/* osoba o prawie takim imieniu: jedna litera różnicy albo „Ania” obok „Ania K.” */
function nearName(name){
  var k = pnorm(name), hit = null;
  if(k.length < 3) return null;
  peopleEntries().some(function(e){
    var n = pnorm(e.name);
    if(n===k || n.length < 3) return false;
    if(lev1(k, n) || n.indexOf(k+' ')===0 || k.indexOf(n+' ')===0){ hit = e.name; return true; }
    return false;
  });
  return hit;
}
function loadPeople(f, user){
  return f.getDoc(peopleRef(f, user.uid)).then(function(s){
    var d = s.exists() ? s.data() : {};
    people = {byUid: d.byUid && typeof d.byUid==='object' ? d.byUid : {}, alias: d.alias && typeof d.alias==='object' ? d.alias : {}};
  }).catch(function(e){ people = {byUid:{}, alias:{}}; console.warn('Odczyt książki osób nieudany', e); });
}
/* nazwa zastępcza konta („Uczestnik z 17.10.2026”) ustępuje imieniu, pod którym ta osoba jest w wejściach
   (autor 2026-11-23); jak isPlaceholder() w functions/people.js. Zwraca true, gdy coś zmieniono. */
function isPlaceholder(s){ return /^uczestnik( wycieczki| z \d{2}\.\d{2}\.\d{4})?$/i.test(cleanLabel(s)); }
function upgradePlaceholders(){
  var cnt = {}, changed = false;
  Object.keys(visits).forEach(function(id){
    visits[id].companions.forEach(function(c){
      var n = cleanLabel(c), u = people.alias[pnorm(n)];
      if(!u || !people.byUid[u] || !isPlaceholder(people.byUid[u]) || !pnorm(n) || isPlaceholder(n)) return;
      (cnt[u] = cnt[u] || {})[n] = (cnt[u][n] || 0) + 1;
    });
  });
  Object.keys(cnt).forEach(function(u){
    var best = Object.keys(cnt[u]).sort(function(a, b){ return cnt[u][b] - cnt[u][a] || b.length - a.length || (a < b ? -1 : 1); })[0];
    if(best){ people.byUid[u] = best; changed = true; }
  });
  return changed;
}
function savePeople(){
  var f = fb(), user = curUser();
  if(!f || !user) return Promise.reject(new Error('no user'));
  return f.setDoc(peopleRef(f, user.uid), {byUid:people.byUid, alias:people.alias, updatedAt:f.serverTimestamp()});
}

function normalize(id, d){
  d = d || {};
  var comp = Array.isArray(d.companions) ? d.companions.filter(function(x){ return typeof x==='string' && x; }) : [];
  return {
    id: id,
    peakId: typeof d.peakId==='string' ? d.peakId : '',
    date: typeof d.date==='string' ? d.date : null,
    dateApprox: d.dateApprox===true && typeof d.date==='string',
    note: typeof d.note==='string' ? d.note : '',
    companions: comp,
    from: typeof d.from==='string' ? d.from : null,
    to: typeof d.to==='string' ? d.to : null,
    km: typeof d.km==='number' ? d.km : null,
    ascent: typeof d.ascent==='number' ? d.ascent : null,
    link: typeof d.link==='string' ? d.link : null,
    track: typeof d.track==='string' && d.track ? d.track : null,
    photos: normalizePhotos(d.photos),
    partners: typeof d.partners==='number' && d.partners%1===0 ? Math.min(Math.max(d.partners, 0), MAX_PARTNERS) : 0,
    updatedAtMs: d.updatedAt && typeof d.updatedAt.toMillis==='function' ? d.updatedAt.toMillis() : 0
  };
}

/* zdjęcia: { id, lat?, lng?, t? } (dawniej sam napis z id); lat/lng z EXIF, t = "RRRR-MM-DDTGG:MM" */
function normalizePhotos(arr){
  if(!Array.isArray(arr)) return [];
  var out = [];
  arr.forEach(function(x){
    var ph = typeof x==='string' ? {id:x} : (x && typeof x==='object' ? x : null);
    if(!ph || typeof ph.id!=='string' || !/^[A-Za-z0-9_]{1,40}$/.test(ph.id)) return;
    var r = {id: ph.id};
    if(typeof ph.lat==='number' && typeof ph.lng==='number' && Math.abs(ph.lat)<=90 && Math.abs(ph.lng)<=180){ r.lat = ph.lat; r.lng = ph.lng; }
    if(typeof ph.t==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(ph.t)) r.t = ph.t;
    // zdjęcie współuczestnika (kopiuje serwer): ext = id zaproszenia łączącego wejścia
    if((typeof ph.ext==='string' && /^[A-Za-z0-9]{1,40}$/.test(ph.ext)) || ph.ext===true) r.ext = ph.ext;
    out.push(r);
  });
  return out.slice(0, MAX_PHOTOS*(1+MAX_PARTNERS));
}
function photoRecord(p){
  var r = {id: p.id};
  if(typeof p.lat==='number' && typeof p.lng==='number'){ r.lat = p.lat; r.lng = p.lng; }
  if(p.t) r.t = p.t;
  if(p.ext) r.ext = p.ext;
  return r;
}
/* ile jeszcze własnych zdjęć można dodać w formularzu */
function photoRoom(){
  if(!cur) return 0;
  var own = cur.photos.filter(function(p){ return !p.ext; }).length;
  return Math.max(0, Math.min(MAX_PHOTOS - own, MAX_PHOTOS*(1+cur.partners) - cur.photos.length));
}

/* ── EXIF: współrzędne GPS i czas wykonania (czytane z oryginału, zapisywane osobno od pliku) ── */
var exifrPromise = null;
function loadExifr(){
  if(window.exifr) return Promise.resolve(window.exifr);
  if(!exifrPromise){
    exifrPromise = new Promise(function(res){
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/lite.umd.js';
      s.onload = function(){ res(window.exifr || null); };
      s.onerror = function(){ res(null); };
      document.head.appendChild(s);
    });
  }
  return exifrPromise;
}
function pad2(n){ return (n<10?'0':'')+n; }
function readMeta(file){
  return loadExifr().then(function(ex){
    if(!ex) return {};
    return ex.parse(file, {tiff:true, exif:true, gps:true, ifd0:false, mergeOutput:true}).then(function(m){
      var out = {};
      if(m && typeof m.latitude==='number' && typeof m.longitude==='number'){
        out.lat = Math.round(m.latitude*1e5)/1e5; out.lng = Math.round(m.longitude*1e5)/1e5;
      }
      var d = m && (m.DateTimeOriginal || m.CreateDate);
      if(d instanceof Date && !isNaN(d)){
        out.t = d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate())+'T'+pad2(d.getHours())+':'+pad2(d.getMinutes());
      }
      return out;
    });
  }).catch(function(){ return {}; });
}
/* ── P56: ślady tras (plik GPX zapisany przy wejściu, trasa z linku Mapy.cz liczona przy rysowaniu) ── */
var MAX_TRACK_PTS = 1500, MAX_TRACK_CHARS = 30000, MAX_GPX_BYTES = 15e6;
// klucz REST API Mapy.com (developer.mapy.com, ograniczony do domen strony); pusty = trasy z linków
// rysowane w przybliżeniu (linia przez punkty z linku), z kluczem — przebieg wyznaczony jak na Mapy.cz
var MAPY_KEY = '';

/* zapis śladu: „encoded polyline” (precyzja 1e-5, jak Google/OSRM/Mapy.com format=polyline) */
function encTrack(pts){
  var out = '', pLat = 0, pLng = 0;
  function enc(v){
    v = v < 0 ? ~(v << 1) : (v << 1);
    var s = '';
    while(v >= 0x20){ s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
    return s + String.fromCharCode(v + 63);
  }
  pts.forEach(function(p){
    var la = Math.round(p[0]*1e5), ln = Math.round(p[1]*1e5);
    out += enc(la - pLat) + enc(ln - pLng); pLat = la; pLng = ln;
  });
  return out;
}
function decTrack(str){
  var pts = [], i = 0, lat = 0, lng = 0;
  function dec(){
    var r = 0, sh = 0, b;
    do { if(i >= str.length) throw new Error('track'); b = str.charCodeAt(i++) - 63; r |= (b & 0x1f) << sh; sh += 5; } while(b >= 0x20);
    return (r & 1) ? ~(r >> 1) : (r >> 1);
  }
  try { while(i < str.length){ lat += dec(); lng += dec(); pts.push([lat/1e5, lng/1e5]); } } catch(e){ return []; }
  return pts;
}
function distM(a, b){
  var R = 6371000, r = Math.PI/180, dLa = (b[0]-a[0])*r, dLn = (b[1]-a[1])*r;
  var h = Math.sin(dLa/2)*Math.sin(dLa/2) + Math.cos(a[0]*r)*Math.cos(b[0]*r)*Math.sin(dLn/2)*Math.sin(dLn/2);
  return 2*R*Math.asin(Math.min(1, Math.sqrt(h)));
}
/* upraszczanie (Douglas–Peucker, bez rekurencji) z tolerancją rosnącą, aż zmieści się w MAX_TRACK_PTS */
function simplifyTrack(pts){
  if(pts.length <= MAX_TRACK_PTS) return pts;
  var k = Math.cos(pts[0][0]*Math.PI/180), M = 111320;
  var xy = pts.map(function(p){ return [p[1]*k*M, p[0]*M]; });
  function run(tol){
    var keep = new Uint8Array(pts.length), stack = [[0, pts.length-1]], t2 = tol*tol;
    keep[0] = keep[pts.length-1] = 1;
    while(stack.length){
      var s = stack.pop(), a = s[0], b = s[1], ax = xy[a][0], ay = xy[a][1], dx = xy[b][0]-ax, dy = xy[b][1]-ay, L = dx*dx+dy*dy, best = -1, bi = -1;
      for(var j = a+1; j < b; j++){
        var px = xy[j][0]-ax, py = xy[j][1]-ay, t = L ? Math.max(0, Math.min(1, (px*dx+py*dy)/L)) : 0;
        var ex = px - t*dx, ey = py - t*dy, d = ex*ex+ey*ey;
        if(d > best){ best = d; bi = j; }
      }
      if(bi > 0 && best > t2){ keep[bi] = 1; stack.push([a, bi], [bi, b]); }
    }
    return pts.filter(function(_, i){ return keep[i]; });
  }
  var tol = 3, out = run(tol);
  while(out.length > MAX_TRACK_PTS){ tol *= 1.5; out = run(tol); }
  return out;
}
/* GPX → trasy: każda <trk> (a bez nich <rte>) osobno — eksport folderu z Mapy.cz ma wiele tras w jednym pliku */
function gpxTracks(text){
  var doc = new DOMParser().parseFromString(text, 'application/xml');
  if(doc.getElementsByTagName('parsererror').length) throw new Error('Plik nie jest poprawnym GPX.');
  var groups = doc.getElementsByTagNameNS('*', 'trk'), tag = 'trkpt';
  if(!groups.length){ groups = doc.getElementsByTagNameNS('*', 'rte'); tag = 'rtept'; }
  var out = [];
  for(var g = 0; g < groups.length; g++){
    var nodes = groups[g].getElementsByTagNameNS('*', tag), pts = [], eles = [], time = null;
    for(var i = 0; i < nodes.length; i++){
      var n = nodes[i], la = parseFloat(n.getAttribute('lat')), ln = parseFloat(n.getAttribute('lon'));
      if(!isFinite(la) || !isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) continue;
      pts.push([la, ln]);
      var e = n.getElementsByTagNameNS('*', 'ele')[0], ev = e ? parseFloat(e.textContent) : NaN;
      eles.push(isFinite(ev) ? ev : null);
      if(!time){ var t = n.getElementsByTagNameNS('*', 'time')[0]; if(t) time = t.textContent; }
    }
    if(pts.length < 2) continue;
    var nm = null;
    for(var c = 0; c < groups[g].childNodes.length; c++){ var ch = groups[g].childNodes[c]; if(ch.localName==='name'){ nm = ch.textContent.trim(); break; } }
    var st = trackStats(pts, eles, time);
    st.name = nm || ''; st.raw = pts;
    out.push(st);
  }
  if(!out.length) throw new Error('W pliku nie ma śladu trasy.');
  return out;
}
/* najbliższa odległość śladu od punktu (m); co kilka punktów, potem dokładnie przy najbliższym miejscu */
function trackNear(pts, ll){
  var best = Infinity, bi = 0, step = pts.length > 3000 ? 5 : 1;
  for(var i = 0; i < pts.length; i += step){ var d = distM(pts[i], ll); if(d < best){ best = d; bi = i; } }
  for(var j = Math.max(0, bi - step); j < Math.min(pts.length, bi + step + 1); j++) best = Math.min(best, distM(pts[j], ll));
  return best;
}
/* jedna trasa z pliku (formularz wejścia): przy kilku trasach ta, która przechodzi koło szczytu (z tą datą, gdy jest) */
function parseGpx(text, peak, date){
  var trs = gpxTracks(text);
  if(trs.length===1 || !peak) return trs[0];
  var ll = [peak.lat, peak.lng], near = trs.filter(function(t){ return trackNear(t.raw, ll) <= 400; });
  if(!near.length) throw new Error('W pliku jest '+trs.length+' tras, ale żadna nie przechodzi przez '+peak.name+'. Użyj „Wgraj ślady GPX” w „Moje wejścia”.');
  var same = date ? near.filter(function(t){ return t.date===date; }) : [];
  return (same[0] || near[0]);
}
function trackStats(pts, eles, time){
  var m = 0; for(var j = 1; j < pts.length; j++) m += distM(pts[j-1], pts[j]);
  // podejście: suma wzrostów z progiem 5 m (szum GPS/barometru nie sumuje się)
  var asc = 0, ref = null, hasEle = false;
  eles.forEach(function(e){
    if(e===null) return; hasEle = true;
    if(ref===null){ ref = e; return; }
    if(e > ref + 5){ asc += e - ref; ref = e; } else if(e < ref - 5) ref = e;
  });
  var d = time ? new Date(time) : null, date = null;
  if(d && !isNaN(d)) date = d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate());
  return {pts: simplifyTrack(pts), km: Math.round(m/100)/10, ascent: hasEle ? Math.round(asc) : null, date: date};
}

/* link Mapy.cz / Mapy.com z zaplanowaną trasą: punkty z parametru rc (kodowanie SMap.Coords) */
var MAPY_ABC = '0ABCD2EFGH4IJKLMN6OPQRST8UVWXYZ-1abcd3efgh5ijklmn7opqrst9uvwxyz.';
function mapyCoords(str){
  var s = String(str||'').trim().split('').reverse(), out = [], c = [0, 0], k = 0;
  function num(n){ var v = 0; while(n){ if(!s.length) throw new Error('rc'); var r = MAPY_ABC.indexOf(s.pop()); if(r!==-1){ v = v*64 + r; n--; } } return v; }
  try {
    while(s.length){
      var r = num(1);
      if((48 & r)===48) c[k] = ((r - 48) & 15)*16777216 + num(4);
      else if((32 & r)===32) c[k] += (15 & r)*4096 + num(2) - 32768;
      else c[k] += (31 & r)*64 + num(1) - 1024;
      if(k) out.push([180*c[1]/0x10000000 - 90, 360*c[0]/0x10000000 - 180]);
      k = (k + 1) % 2;
    }
  } catch(e){ return []; }
  return out.filter(function(p){ return Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180; });
}
/* {kind:'route', pts, via} dla trasy; {kind:'short'} dla krótkiego linku (nie da się go odczytać w przeglądarce) */
function mapyLink(link){
  var u; try { u = new URL(link); } catch(e){ return null; }
  if(!/(^|\.)mapy\.(cz|com)$/i.test(u.hostname)) return null;
  if(/^\/s\//.test(u.pathname)) return {kind:'short'};
  var pts = mapyCoords(u.searchParams.get('rc'));
  if(pts.length < 2) return null;
  // rwp=„n;punkty” — uproszczony przebieg odcinka przed n-tym punktem trasy (bywa w linku, nie zawsze)
  var via = {};
  u.searchParams.getAll('rwp').forEach(function(x){
    var m = /^(\d+);(.+)$/.exec(x); if(m) via[+m[1]] = mapyCoords(m[2]);
  });
  return {kind:'route', pts: pts, via: via};
}
function mapyApprox(r){
  var out = [];
  r.pts.forEach(function(p, i){ if(via(i)) out = out.concat(via(i)); out.push(p); });
  function via(i){ return i && r.via[i] && r.via[i].length ? r.via[i] : null; }
  return out;
}
/* przebieg z REST API Mapy.com (z kluczem); wynik w localStorage, żeby nie pytać przy każdym otwarciu */
var routeMem = {};
function mapyRoute(link, r){
  if(!MAPY_KEY) return Promise.resolve(null);
  var key = 'korona_route_' + hashStr(link);
  if(routeMem[key]) return Promise.resolve(routeMem[key]);
  try { var c = localStorage.getItem(key); if(c){ routeMem[key] = decTrack(c); return Promise.resolve(routeMem[key]); } } catch(e){}
  var pts = r.pts, mid = pts.slice(1, -1);
  if(mid.length > 15){ var step = mid.length/15; mid = Array.from({length:15}, function(_, i){ return mid[Math.floor(i*step)]; }); }
  var ll = function(p){ return p[1].toFixed(6)+','+p[0].toFixed(6); };
  var q = 'start='+ll(pts[0])+'&end='+ll(pts[pts.length-1])+(mid.length ? '&waypoints='+mid.map(ll).join(';') : '')+
          '&routeType=foot_hiking&format=polyline&lang=pl&apikey='+encodeURIComponent(MAPY_KEY);
  return fetch('https://api.mapy.com/v1/routing/route?'+q).then(function(res){ return res.ok ? res.json() : null; }).then(function(j){
    var g = j && j.geometry, enc = typeof g==='string' ? g : g && typeof g.geometry==='string' ? g.geometry : null;
    var out = enc ? decTrack(enc) : (g && g.geometry && Array.isArray(g.geometry.coordinates) ? g.geometry.coordinates.map(function(c){ return [c[1], c[0]]; }) : null);
    if(!out || out.length < 2) return null;
    out = simplifyTrack(out);
    routeMem[key] = out;
    try { localStorage.setItem(key, encTrack(out)); } catch(e){}
    return out;
  }).catch(function(){ return null; });
}
function hashStr(s){ var h = 5381; for(var i = 0; i < s.length; i++) h = ((h*33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); }

/* warstwa „Moje trasy” na mapie (app.js: map); przycisk w grupie „Warstwy” dokładany skryptem */
var trackLayer = null, tracksOn = true, trackGen = 0;
try { tracksOn = localStorage.getItem('korona_tracks_off')!=='1'; } catch(e){}
var TRACK_COLORS = {ks:'#D4A017', wks:'#3D7ABF', dks:'#A78BFA', kps:'#7FB069'};
function peakRef(peakId){
  var types = ['ks','wks','dks','kps'];
  for(var t = 0; t < types.length; t++){
    var arr; try { arr = tierArr(types[t]); } catch(e){ arr = null; }
    if(!arr) continue;
    for(var i = 0; i < arr.length; i++) if(arr[i].id===peakId) return {type:types[t], idx:i, p:arr[i]};
  }
  return null;
}
function trackPopup(v, ref){
  var bits = [];
  if(v.date) bits.push(fmtVisitDate(v));
  if(v.km!=null) bits.push(fmtNum(v.km)+' km');
  if(v.ascent!=null) bits.push('↑ '+v.ascent+' m');
  return '<div class="dy-trk-pop"><b>'+esc(ref.p.name)+'</b>'+(bits.length ? '<div>'+esc(bits.join(' · '))+'</div>' : '')+
    (v.track ? '' : '<div class="muted">Trasa z linku Mapy.cz</div>')+
    '<button type="button" class="pop-btn diary has" onclick="Diary.openVisit(\''+ref.type+'\','+ref.idx+',\''+v.id+'\')">📖 Otwórz wejście</button></div>';
}
function drawTracks(){
  if(typeof map==='undefined' || typeof L==='undefined') return;
  var gen = ++trackGen;
  if(!trackLayer) trackLayer = L.layerGroup();
  trackLayer.clearLayers();
  var user = curUser(), n = 0;
  if(user && loadOk){
    Object.keys(visits).forEach(function(k){
      var v = visits[k], ref = peakRef(v.peakId);
      if(!ref || (ref.type==='kps' && !kpsOn())) return;
      var col = TRACK_COLORS[ref.type] || '#3D7ABF';
      var add = function(pts, approx){
        if(gen!==trackGen || !pts || pts.length < 2) return;
        L.polyline(pts, {color:'#fff', weight:6, opacity:.55, interactive:false}).addTo(trackLayer);
        L.polyline(pts, {color:col, weight:3.5, opacity:.95, dashArray: approx ? '7,6' : null})
          .bindPopup(trackPopup(v, ref), {maxWidth:240}).addTo(trackLayer);
      };
      if(v.track){ add(decTrack(v.track), false); n++; return; }
      var r = v.link ? mapyLink(v.link) : null;
      if(!r || r.kind!=='route') return;
      n++;
      mapyRoute(v.link, r).then(function(full){ add(full || mapyApprox(r), !full); });
    });
  }
  if(tracksOn && n) trackLayer.addTo(map); else map.removeLayer(trackLayer);
  tracksButton(n);
}
function tracksButton(n){
  var isEn = !!($('btn-en') && $('btn-en').classList.contains('active'));
  [['pasma-btn','tracks-btn','Moje trasy',false],['pasma-btn-en','tracks-btn-en','My routes',true]].forEach(function(x){
    var b0 = $(x[0]), b = $(x[1]);
    if(n && b0 && !b){
      b = document.createElement('button'); b.id = x[1]; b.type = 'button';
      b.className = 'grupy-toggle-btn chk tracks-btn ' + (x[3] ? 'lang-en' : 'lang-pl');
      b.title = 'Trasy z Twoich wejść: pliki GPX i linki do tras z Mapy.cz';
      b.textContent = x[2];
      b.onclick = toggleTracks;
      b0.insertAdjacentElement('afterend', b);
    }
    if(!n && b){ b.remove(); return; }
    if(b){ b.classList.toggle('active', tracksOn); b.style.display = (x[3] ? isEn : !isEn) ? '' : 'none'; }
  });
}
function toggleTracks(){
  tracksOn = !tracksOn;
  try { tracksOn ? localStorage.removeItem('korona_tracks_off') : localStorage.setItem('korona_tracks_off', '1'); } catch(e){}
  drawTracks();
}

function mapLink(lat, lng){
  return 'https://mapy.cz/turisticka?x='+lng+'&y='+lat+'&z=16&source=coor&id='+lng+'%2C'+lat;
}

/* ── zdjęcia: ścieżki w Storage i zmniejszanie w przeglądarce ── */
function photoPath(uid, visitId, photoId, thumb){
  return 'users/'+uid+'/visits/'+visitId+'/'+photoId+(thumb?'_t':'')+'.jpg';
}
function newPhotoId(){
  return 'p'+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
}
function photoUrl(uid, visitId, photoId, thumb){
  var f = fb(), path = photoPath(uid, visitId, photoId, thumb);
  if(urlCache[path]) return Promise.resolve(urlCache[path]);
  if(!f || !f.getDownloadURL) return Promise.reject(new Error('no storage'));
  return f.getDownloadURL(f.sRef(f.storage, path)).then(function(u){ return (urlCache[path] = u); });
}
function decodeImage(file){
  var viaImg = function(){
    return new Promise(function(res, rej){
      var u = URL.createObjectURL(file), im = new Image();
      im.onload = function(){ URL.revokeObjectURL(u); res(im); };
      im.onerror = function(){ URL.revokeObjectURL(u); rej(new Error('decode')); };
      im.src = u;
    });
  };
  if(window.createImageBitmap){
    return createImageBitmap(file, {imageOrientation:'from-image'}).catch(viaImg);
  }
  return viaImg();
}
/* JPEG o dłuższym boku <= maxPx; kodowanie przez canvas usuwa EXIF (w tym GPS) */
function renderJpeg(src, maxPx, quality){
  var w = src.width || src.naturalWidth, h = src.height || src.naturalHeight;
  var s = Math.min(1, maxPx/Math.max(w,h));
  var c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w*s)); c.height = Math.max(1, Math.round(h*s));
  var g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0,0,c.width,c.height);
  g.drawImage(src, 0, 0, c.width, c.height);
  return new Promise(function(res, rej){
    c.toBlob(function(b){ b ? res(b) : rej(new Error('encode')); }, 'image/jpeg', quality);
  });
}
function processPhoto(file){
  return decodeImage(file).then(function(img){
    return renderJpeg(img, PHOTO_MAX_PX, 0.82).then(function(full){
      return renderJpeg(img, THUMB_MAX_PX, 0.75).then(function(thumb){
        if(img.close) img.close();
        return {full:full, thumb:thumb};
      });
    });
  });
}

/* wejścia na dany szczyt: chronologicznie, bez daty na końcu */
function visitsOf(peakId){
  return Object.keys(visits).map(function(k){ return visits[k]; })
    .filter(function(v){ return v.peakId===peakId; })
    .sort(function(a,b){
      if(a.date && b.date) return a.date<b.date ? -1 : a.date>b.date ? 1 : (a.id<b.id?-1:1);
      if(a.date) return -1;
      if(b.date) return 1;
      return a.id<b.id ? -1 : 1;
    });
}

/* ── odczyt / czyszczenie ── */
function load(user){
  var f = fb();
  if(!f || !user) return Promise.resolve();
  loadOk = false;
  loadPromise = Promise.all([f.getDocs(visitsCol(f, user.uid)), loadPeople(f, user)]).then(function(res){
    var snap = res[0], next = {}, kpsIds = {};
    if(!kpsOn() && typeof KPS!=='undefined') KPS.forEach(function(p){ kpsIds[p.id] = 1; });
    hiddenVisits = {};
    // wejścia na szczyty Korony Pogórzy przed jej premierą: zostają w bazie, ale pamiętnik ich nie pokazuje
    // (ani w liście, ani w licznikach osób i miejsc) — poza administratorami
    snap.forEach(function(d){ var v = normalize(d.id, d.data()); (kpsIds[v.peakId] ? hiddenVisits : next)[d.id] = v; });
    visits = next;
    indexSpellings();
    if(upgradePlaceholders()) savePeople().catch(function(e){ console.warn('Zapis nazw osób nieudany', e); });
    loadOk = true;
    loadedAt = Date.now();
    refreshAll();
    // zaproszenia przed propozycjami zmian: okno zaproszenia ma pierwszeństwo
    Promise.resolve(loadInvites(user)).then(function(){ loadOffers(user); });
    handleLinkInvite(user);
  }).catch(function(e){
    console.warn('Odczyt wejść nieudany', e);
  });
  return loadPromise;
}

function clear(){
  visits = {}; hiddenVisits = {}; loadOk = false; loadPromise = null; cur = null; incoming = []; sent = []; linked = []; offersIn = [];
  people = {byUid:{}, alias:{}}; spelled = {}; pending = null; peopleOpen = false; compFilter = null;
  // niezalogowany z linkiem z maila: poproś o logowanie; po nim load() -> handleLinkInvite() otworzy zaproszenie
  if(INVITES_ON && pendingLink()) askLogin();
  closeForm(); closeList();
  refreshAll();
}

function refreshAll(){
  if(typeof placeMarkers==='function') placeMarkers();
  drawTracks();
  var lo = $('diary-list-overlay');
  if(lo && !lo.classList.contains('hidden')) renderList();
}

function refreshPopup(type, idx){
  var markers = type==='ks'?ksMarkers:type==='wks'?wksMarkers:dksMarkers;
  var m = markers[idx];
  if(m) m.setPopupContent(buildPopup(tierArr(type)[idx], type, idx));
}

/* ── przycisk w popupie szczytu (wywoływany z buildPopup) ── */
function popupBtn(p, type, idx, conq){
  if(!conq || !p.id) return '';
  var vs = visitsOf(p.id);
  var label;
  if(!vs.length) label = '📖 Dodaj wejście';
  else {
    var last = vs.filter(function(v){ return v.date; }).pop();
    label = '📖 Wejścia ('+vs.length+')' + (last ? ' · '+fmtVisitDate(last) : '');
  }
  return '<button class="pop-btn diary'+(vs.length?' has':'')+'" onclick="Diary.open(\''+type+'\','+idx+')">'+esc(label)+'</button>';
}

/* ── DOM (budowany raz) ── */
function ensureDom(){
  if($('diary-overlay')) return;
  var wrap = document.createElement('div');
  wrap.innerHTML =
  '<div id="diary-overlay" class="hidden" role="dialog" aria-modal="true" aria-labelledby="dy-title">'+
    '<div class="dy-box">'+
      '<div class="dy-hdr"><div><div class="dy-title" id="dy-title"></div><div class="dy-sub" id="dy-sub"></div></div>'+
        '<button class="dy-close" id="dy-x" title="Zamknij">✕</button></div>'+
      '<div class="dy-visits" id="dy-visits"></div>'+
      '<div class="dy-body"><div class="dy-grid">'+
        '<div class="dy-field c4"><label for="dy-date">Data wejścia</label><input type="date" id="dy-date">'+
          '<label class="dy-approx" title="Zaznacz, gdy nie pamiętasz dokładnego dnia (np. wejścia sprzed lat). Odznacz, gdy ustalisz dokładną datę.">'+
          '<input type="checkbox" id="dy-date-approx"> data orientacyjna</label></div>'+
        '<div class="dy-field c4 m6"><label for="dy-from">Skąd</label><input type="text" id="dy-from" list="dy-places" maxlength="'+MAX_PLACE+'" placeholder="np. Karpacz" autocomplete="off"></div>'+
        '<div class="dy-field c4 m6"><label for="dy-to">Dokąd</label><input type="text" id="dy-to" list="dy-places" maxlength="'+MAX_PLACE+'" placeholder="np. Śnieżka" autocomplete="off"></div>'+
        '<div class="dy-field c3 m6"><label for="dy-km">Dystans (km)</label><input type="text" id="dy-km" inputmode="decimal" placeholder="12,5" autocomplete="off"></div>'+
        '<div class="dy-field c3 m6"><label for="dy-asc">Podejście (m)</label><input type="text" id="dy-asc" inputmode="numeric" placeholder="800" autocomplete="off"></div>'+
        '<div class="dy-field c6"><label for="dy-link">Link (Strava, Mapy.cz, album…)</label><input type="url" id="dy-link" maxlength="'+MAX_LINK+'" placeholder="https://"></div>'+
        '<div class="dy-field c12"><label>Trasa na mapie</label>'+
          '<div class="dy-trk"><span class="dy-trk-info" id="dy-trk-info"></span>'+
          '<button type="button" class="dy-btn ghost" id="dy-trk-add">Dodaj plik GPX</button>'+
          '<button type="button" class="dy-btn ghost" id="dy-trk-del" hidden>Usuń ślad</button></div>'+
          '<input type="file" id="dy-trk-file" accept=".gpx,application/gpx+xml" hidden></div>'+
        '<div class="dy-field c12"><label for="dy-comp-in">Towarzysze</label>'+
          '<div class="dy-comp" id="dy-comp"><span id="dy-chips"></span>'+
          '<input type="text" id="dy-comp-in" maxlength="'+MAX_COMP_LEN+'" placeholder="Imię i Enter" autocomplete="off"></div>'+
          '<div class="dy-suggest" id="dy-suggest"></div></div>'+
        '<div class="dy-field c12" id="dy-share" hidden><label for="dy-share-in">Udostępnij uczestnikom (e-mail)</label>'+
          '<div class="dy-share-row"><input type="email" id="dy-share-in" maxlength="254" placeholder="adres@przyklad.pl" autocomplete="off">'+
          '<select id="dy-share-who" title="Kto to z listy towarzyszy? Połączy tę osobę z jej kontem."></select>'+
          '<button type="button" class="dy-btn ghost" id="dy-share-go">Wyślij zaproszenie</button></div>'+
          '<div class="dy-share-hint" id="dy-share-hint"></div><div class="dy-share-list" id="dy-share-list"></div></div>'+
        '<div class="dy-field c12"><label>Zdjęcia <span class="dy-count" id="dy-ph-count"></span>'+
          '<button type="button" class="dy-ph-edit" id="dy-ph-edit" hidden>Edytuj</button></label>'+
          '<div class="dy-photos" id="dy-photos"></div>'+
          '<input type="file" id="dy-ph-file" accept="image/*" multiple hidden></div>'+
        '<div class="dy-field c12"><label for="dy-note">Wspomnienie <span class="dy-count" id="dy-count"></span></label>'+
          '<textarea id="dy-note" rows="3" maxlength="'+MAX_NOTE+'" placeholder="Pogoda, widoki, co się działo…"></textarea></div>'+
      '</div><datalist id="dy-places"></datalist></div>'+
      '<div class="dy-foot"><button class="dy-btn danger" id="dy-del">Usuń wejście</button>'+
        '<span class="dy-err" id="dy-err"></span>'+
        '<button class="dy-btn ghost" id="dy-cancel">Anuluj</button><button class="dy-btn primary" id="dy-save">Zapisz</button></div>'+
    '</div></div>'+
  '<div id="diary-list-overlay" class="hidden" role="dialog" aria-modal="true" aria-labelledby="dl-title">'+
    '<div class="dy-box dy-wide">'+
      '<div class="dy-hdr"><div class="dy-title" id="dl-title">📖 Moje wejścia</div>'+
        '<button class="dy-close" id="dl-x" title="Zamknij">✕</button></div>'+
      '<div class="dy-body"><div id="dl-invites"></div><div class="dl-stats" id="dl-stats"></div><div class="dl-comps" id="dl-comps" hidden></div><div class="dp-box" id="dl-people" hidden></div>'+
        '<div class="dl-gpx"><button type="button" class="dy-btn ghost" id="dl-gpx-btn">🗺 Wgraj ślady GPX</button>'+
          '<span>Jeden lub wiele plików (np. eksport folderu z Mapy.cz) — trasy same dopasują się do wejść po dacie i szczycie.</span>'+
          '<input type="file" id="dl-gpx-file" accept=".gpx,application/gpx+xml" multiple hidden>'+
          '<details class="dl-gpx-help"><summary>Jak przenieść trasy z Mapy.com?</summary><ol>'+
            '<li>Nagrane aktywności w Mapy.com dodawaj do jednego folderu (np. „Korona Sudetów”).</li>'+
            '<li>Co jakiś czas wyeksportuj cały folder: w folderze menu <b>⋮ → Eksportuj</b> — jeden plik GPX.</li>'+
            '<li>Tutaj kliknij <b>Wgraj ślady GPX</b> i wybierz ten plik. Trasy same przypiszą się do wejść po dacie i szczycie. '+
              'Wejścia, które mają już ślad, są odznaczone, więc ponowne wgranie tego samego folderu niczego nie zdubluje.</li>'+
          '</ol><p>Strava, Garmin, Komoot: pobierz aktywność jako plik GPX i wgraj go tak samo.</p></details></div>'+
        '<div class="dl-tabs" id="dl-tabs"></div><div id="dl-rows"></div></div>'+
    '</div></div>'+
  '<div id="invite-overlay" class="hidden" role="dialog" aria-modal="true" aria-labelledby="iv-title">'+
    '<div class="dy-box iv-box">'+
      '<div class="dy-hdr"><div class="dy-title" id="iv-title">🤝 Zaproszenie do wspólnego wejścia</div>'+
        '<button class="dy-close" id="iv-x" title="Zamknij">✕</button></div>'+
      '<div class="dy-body" id="iv-body"></div>'+
      '<div class="dy-foot"><span class="dy-err"></span><button class="dy-btn ghost" id="iv-later">Później</button></div>'+
    '</div></div>'+
  '<div id="dy-toast" class="dy-toast"></div>';
  while(wrap.firstChild) document.body.appendChild(wrap.firstChild);

  $('dy-x').onclick = $('dy-cancel').onclick = function(){ closeForm(true); };
  $('dl-x').onclick = closeList;
  // P56: zbiorcze wgrywanie śladów GPX
  $('dl-gpx-btn').addEventListener('click', function(){ $('dl-gpx-file').click(); });
  $('dl-gpx-file').addEventListener('change', function(){
    var files = Array.prototype.slice.call(this.files || []);
    this.value = '';
    if(files.length) gpxImport(files);
  });
  $('dy-save').onclick = save;
  $('dy-del').onclick = remove;
  $('dy-note').addEventListener('input', updateCount);
  var ci = $('dy-comp-in');
  ci.addEventListener('keydown', function(ev){
    if(ev.key==='Enter' || ev.key===','){ ev.preventDefault(); addCompanion(ci.value); ci.value=''; }
    else if(ev.key==='Backspace' && !ci.value && cur && cur.companions.length){ cur.companions.pop(); renderChips(); }
  });
  ci.addEventListener('input', function(){ pending = null; renderSuggest(); });
  ci.addEventListener('blur', function(){ if(ci.value.trim()){ addCompanion(ci.value); ci.value=''; } });
  $('dy-comp').addEventListener('click', function(ev){
    var b = ev.target.closest('[data-rm]');
    if(b){ cur.companions.splice(+b.getAttribute('data-rm'),1); renderChips(); }
    else ci.focus();
  });
  $('dy-photos').addEventListener('click', function(ev){
    var rm = ev.target.closest('[data-rmph]');
    if(rm){
      var i = +rm.getAttribute('data-rmph'), ph = cur.photos[i];
      if(ph){
        if(ph.isNew) { if(ph.objUrl) URL.revokeObjectURL(ph.objUrl); }
        else cur.removedPhotos.push(ph.id);
        cur.photos.splice(i,1); renderPhotos();
      }
      return;
    }
    if(ev.target.closest('[data-addph]')) $('dy-ph-file').click();
  });
  $('dy-ph-edit').addEventListener('click', function(ev){
    ev.preventDefault();
    if(!cur) return;
    cur.photoEdit = !cur.photoEdit; renderPhotos();
  });
  $('dy-ph-file').addEventListener('change', function(){
    var files = Array.prototype.slice.call(this.files||[]);
    this.value = '';
    addPhotoFiles(files);
  });
  // P56: ślad trasy z pliku GPX; podpowiedź przy linku Mapy.cz
  $('dy-trk-add').addEventListener('click', function(){ $('dy-trk-file').click(); });
  $('dy-trk-del').addEventListener('click', function(){ if(cur){ cur.track = null; cur.trackNote = ''; renderTrack(); } });
  $('dy-trk-file').addEventListener('change', function(){
    var file = this.files && this.files[0];
    this.value = '';
    if(file) addGpx(file);
  });
  $('dy-link').addEventListener('input', renderTrack);
  $('dy-date').addEventListener('change', renderSuggest);
  // kliknięcie podpowiedzi nie zabiera fokusu polu (blur dopisałby niedokończone imię)
  $('dy-suggest').addEventListener('mousedown', function(ev){ if(ev.target.closest('button')) ev.preventDefault(); });
  $('dy-suggest').addEventListener('click', function(ev){
    var nb = ev.target.closest('[data-near]');
    if(nb && pending){
      var p = pending; pending = null;
      addCompanion(nb.getAttribute('data-near')==='yes' ? p.near : p.name, true);
      return;
    }
    var b = ev.target.closest('[data-add]'); if(!b) return;
    $('dy-comp-in').value = '';
    addCompanion(b.getAttribute('data-add'), true);
  });
  $('dy-visits').addEventListener('click', function(ev){
    var b = ev.target.closest('[data-vid]'); if(!b) return;
    var vid = b.getAttribute('data-vid') || null;
    if(vid===(cur.visitId||null) || cur.busy) return;
    if(isDirty() && !confirm('Odrzucić niezapisane zmiany w tym wejściu?')) return;
    releasePhotoUrls();
    openForm(cur.type, cur.idx, vid || 'new');
  });
  $('iv-x').onclick = $('iv-later').onclick = closeInviteModal;
  $('iv-body').addEventListener('click', function(ev){
    var a = ev.target.closest('[data-accept]'); if(a) return acceptInvite(a.getAttribute('data-accept'), a);
    var oa = ev.target.closest('[data-oapply]'); if(oa) return answerOffer(oa.getAttribute('data-oapply'), 'apply', oa);
    var od = ev.target.closest('[data-odecline]'); if(od) return answerOffer(od.getAttribute('data-odecline'), 'decline', od);
    var ao = ev.target.closest('[data-askoffer]');
    if(ao) return sendOffer(ao.getAttribute('data-askoffer'), ao, $('invite-overlay').querySelector('.dy-foot .dy-err'), function(){
      // P49: po wysłaniu do wszystkich okno zamyka się samo; inaczej „Nie teraz” → „Zamknij”
      var left = $('iv-body').querySelectorAll('[data-askoffer]:not(:disabled)').length;
      if(!left) setTimeout(closeInviteModal, 900); else $('iv-later').textContent = 'Zamknij';
    });
    if(ev.target.closest('[data-later]')) return closeInviteModal();
  });
  $('dy-share-go').onclick = sendInvite;
  $('dy-share-in').addEventListener('keydown', function(ev){ if(ev.key==='Enter'){ ev.preventDefault(); sendInvite(); } });
  $('dy-share-list').addEventListener('click', function(ev){
    var r = ev.target.closest('[data-remind]'); if(r) return remindInvite(r.getAttribute('data-remind'), r);
    var u = ev.target.closest('[data-offer]'); if(u) return sendOffer(u.getAttribute('data-offer'), u);
    var b = ev.target.closest('[data-cancel]'); if(b) cancelInvite(b.getAttribute('data-cancel'));
  });
  $('dl-invites').addEventListener('click', function(ev){
    var a = ev.target.closest('[data-accept]'); if(a) return acceptInvite(a.getAttribute('data-accept'), a);
    var oa = ev.target.closest('[data-oapply]'); if(oa) return answerOffer(oa.getAttribute('data-oapply'), 'apply', oa);
    var od = ev.target.closest('[data-odecline]'); if(od) return answerOffer(od.getAttribute('data-odecline'), 'decline', od);
  });
  $('dl-comps').addEventListener('click', function(ev){
    var c = ev.target.closest('[data-ck]');
    if(c){
      var k = c.getAttribute('data-ck');
      compFilter = compFilter===k ? null : k; renderList();
      if(compFilter){ var w = $('dl-with'); if(w) w.scrollIntoView({block:'nearest', behavior:'smooth'}); }
      return;
    }
    if(!ev.target.closest('[data-people]')) return;
    peopleOpen = !peopleOpen; renderList();
  });
  $('dl-people').addEventListener('click', function(ev){
    var b = ev.target.closest('[data-pact]'); if(!b) return;
    peopleAction(b.getAttribute('data-pact'), b.closest('[data-key]').getAttribute('data-key'));
  });
  $('dl-people').addEventListener('change', function(ev){
    var sel = ev.target.closest('select[data-merge]'); if(!sel || !sel.value) return;
    mergePeople(sel.closest('[data-key]').getAttribute('data-key'), sel.value);
  });
  $('dl-tabs').addEventListener('click', function(ev){
    var b = ev.target.closest('[data-tab]'); if(!b) return;
    listTab = b.getAttribute('data-tab'); renderList();
  });
  $('dl-rows').addEventListener('click', function(ev){
    var r = ev.target.closest('[data-type]'); if(!r) return;
    openForm(r.getAttribute('data-type'), +r.getAttribute('data-idx'), r.getAttribute('data-vid') || 'new');
  });
  document.addEventListener('keydown', function(ev){
    if(ev.key!=='Escape') return;
    if(!$('diary-overlay').classList.contains('hidden')) closeForm(true);
    else if(!$('diary-list-overlay').classList.contains('hidden')) closeList();
  });
}

function toast(msg){
  var t = $('dy-toast'); if(!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(function(){ t.classList.remove('show'); }, 2500);
}

/* ── formularz wejścia ── */
function requireLogin(again){
  if(curUser()) return true;
  if(typeof showAuthOverlay==='function') showAuthOverlay(again);
  return false;
}

/* asNew: true = od razu puste, nowe wejście (np. tuż po kliknięciu „Zdobyty!”) */
/* onClose: wywoływane raz po zamknięciu formularza (app.js: okno otwarcia / ukończenia korony, P43) */
function open(type, idx, asNew, onClose){
  if(!requireLogin(function(){ open(type, idx, asNew, onClose); })) return;
  ensureDom();
  afterClose = onClose || null;
  var go = function(){
    if(!loadOk){ alert('Nie udało się wczytać Twoich wejść. Odśwież stronę i spróbuj ponownie.'); runAfterClose(); return; }
    openForm(type, idx, asNew ? 'new' : undefined);
  };
  // zawsze świeży odczyt: wejście mogło zostać zmienione na innym urządzeniu (stara kopia w pamięci
  // karty nadpisywała przy zapisie np. zdjęcia dodane na telefonie)
  load(curUser()).then(go);
}

/* which: undefined = ostatnie wejście (albo nowe, gdy brak), 'new' = nowe, inaczej id wejścia */
function openForm(type, idx, which){
  ensureDom();
  var p = tierArr(type)[idx];
  if(!p || !p.id) return;
  var list = visitsOf(p.id);
  var v = null;
  if(which===undefined) v = list.length ? list[list.length-1] : null;
  else if(which!=='new') v = visits[which] || null;
  cur = {
    type:type, idx:idx, p:p,
    visitId: v ? v.id : null,
    companions: v ? shownList(v.companions) : [],   // pisownia z książki osób; zapis ujednolica wejście
    photos: v ? v.photos.map(function(ph){ return Object.assign({isNew:false}, ph); }) : [],
    removedPhotos: [],
    photoEdit: false,                              // P49: krzyżyki usuwania zdjęć dopiero po „Edytuj”
    partners: v ? v.partners : 0,
    track: v ? v.track : null,                     // P56: ślad z GPX (encoded polyline)
    trackNote: '',
    loadedMs: v ? v.updatedAtMs : 0,
    busy: false
  };
  $('dy-title').textContent = p.name;
  $('dy-sub').textContent = tierShort(type)+' · '+p.pasmo+' · '+p.alt+' m n.p.m.';
  $('dy-sub').title = tierName(type);
  $('dy-date').max = todayIso();
  $('dy-date').value = v && v.date ? v.date : '';
  $('dy-date-approx').checked = !!(v && v.dateApprox);
  $('dy-from').value = v && v.from ? v.from : '';
  $('dy-to').value = v && v.to ? v.to : '';
  $('dy-km').value = v && v.km!=null ? fmtNum(v.km) : '';
  $('dy-asc').value = v && v.ascent!=null ? String(v.ascent) : '';
  $('dy-link').value = v && v.link ? v.link : '';
  $('dy-note').value = v ? v.note : '';
  $('dy-comp-in').value = '';
  pending = null;
  $('dy-err').textContent = '';
  $('dy-del').style.display = v ? '' : 'none';
  $('dy-save').disabled = false; $('dy-save').textContent = 'Zapisz';
  renderPlaces(); renderVisitTabs(list); renderChips(); renderPhotos(); updateCount(); renderTrack();
  curSig = formSig();
  sent = []; linked = []; renderShare(); loadSent();
  $('diary-overlay').classList.remove('hidden');
  setTimeout(function(){ try{ $('dy-date').focus(); }catch(x){} }, 30);
}

function formSig(){
  return JSON.stringify([$('dy-date').value, $('dy-date-approx').checked, $('dy-from').value.trim(), $('dy-to').value.trim(),
    $('dy-km').value.trim(), $('dy-asc').value.trim(), $('dy-link').value.trim(),
    $('dy-note').value.trim(), cur ? cur.companions : [],
    cur ? cur.photos.map(function(p){ return p.id; }) : [], cur ? cur.track || '' : '']);
}

/* P56: opis śladu w formularzu */
function renderTrack(){
  if(!cur) return;
  var info = $('dy-trk-info'), del = $('dy-trk-del'), add = $('dy-trk-add');
  var link = $('dy-link').value.trim(), r = link ? mapyLink(/^https?:\/\//i.test(link) ? link : 'https://'+link) : null, txt;
  if(cur.track){
    var pts = decTrack(cur.track), m = 0;
    for(var i = 1; i < pts.length; i++) m += distM(pts[i-1], pts[i]);
    txt = '✓ Ślad z pliku GPX · '+fmtNum(Math.round(m/100)/10)+' km' + (cur.trackNote ? ' — '+cur.trackNote : '');
  } else if(r && r.kind==='route'){
    txt = '✓ Trasa z linku Mapy.cz' + (MAPY_KEY ? '' : ' (przybliżona — przez punkty z linku)') + '. Plik GPX da dokładny ślad.';
  } else if(r && r.kind==='short'){
    txt = 'Krótkiego linku Mapy.cz nie da się odczytać. Wklej pełny adres trasy z paska przeglądarki albo dodaj plik GPX (w Mapy.cz: eksport trasy do GPX).';
  } else {
    txt = 'Dodaj plik GPX (Strava, Garmin, Komoot, Mapy.cz — „Eksport GPX”) albo wklej link do trasy z Mapy.cz.';
  }
  info.textContent = txt;
  info.classList.toggle('ok', /^✓/.test(txt));
  del.hidden = !cur.track;
  add.textContent = cur.track ? 'Zmień plik GPX' : 'Dodaj plik GPX';
}
function addGpx(file){
  var state = cur;
  if(!state) return;
  var err = $('dy-err');
  if(file.size > MAX_GPX_BYTES){ err.textContent = 'Plik GPX jest za duży (do 15 MB).'; return; }
  file.text().then(function(text){
    if(cur!==state) return;
    var g = parseGpx(text, state.p, $('dy-date').value || null), enc = encTrack(g.pts);
    if(enc.length > MAX_TRACK_CHARS) throw new Error('Ślad jest zbyt szczegółowy.');
    // szczyt przy śladzie? (tylko ostrzeżenie — można zapisać)
    var near = Infinity, pk = [state.p.lat, state.p.lng];
    g.pts.forEach(function(p){ near = Math.min(near, distM(p, pk)); });
    state.track = enc;
    state.trackNote = near > 1500 ? 'uwaga: ślad nie przechodzi przez '+state.p.name+' (najbliżej '+fmtNum(Math.round(near/100)/10)+' km)' : '';
    if(!$('dy-km').value.trim() && g.km) $('dy-km').value = fmtNum(g.km);
    if(!$('dy-asc').value.trim() && g.ascent) $('dy-asc').value = String(g.ascent);
    if(!$('dy-date').value && g.date && g.date <= todayIso()) $('dy-date').value = g.date;
    err.textContent = '';
    renderTrack();
  }).catch(function(e){
    console.warn('GPX', e);
    if(cur===state) err.textContent = (e && e.message && /GPX|śladu|szczegółowy|tras/.test(e.message)) ? e.message : 'Nie udało się odczytać pliku GPX.';
  });
}
function isDirty(){ return !!cur && formSig()!==curSig; }

function releasePhotoUrls(){
  if(!cur) return;
  cur.photos.forEach(function(p){ if(p.isNew && p.objUrl) URL.revokeObjectURL(p.objUrl); });
}

function closeForm(ask){
  var o = $('diary-overlay');
  if(!o || o.classList.contains('hidden')) { cur = null; return; }
  if(cur && cur.busy) return;                      // trwa wysyłanie zdjęć
  if(ask && isDirty() && !confirm('Odrzucić niezapisane zmiany?')) return;
  releasePhotoUrls();
  o.classList.add('hidden');
  cur = null;
  runAfterClose();
}
var afterClose = null;
function runAfterClose(){
  var f = afterClose; afterClose = null;
  if(f) setTimeout(f, 150);
}

/* podsumowanie wejść na podane szczyty (okno ukończenia korony w app.js, P43): daty, liczby,
   osoby liczone jak w „Moje wejścia” (personKey — różne pisownie tej samej osoby raz) */
function summary(peakIds){
  var ids = {}, s = {visits:0, first:null, last:null, km:0, ascent:0, photos:0, people:0, top:[]}, per = {}, peakFirst = {};
  (peakIds||[]).forEach(function(id){ ids[id] = 1; });
  Object.keys(visits).forEach(function(k){
    var v = visits[k];
    if(!ids[v.peakId]) return;
    s.visits++;
    // P54: początek = najwcześniejsze wejście; ukończenie = pierwsze wejście na ostatni zdobyty szczyt
    // (najpóźniejsza z dat pierwszego wejścia na każdy szczyt), nie data ostatniego powrotu
    if(v.date){
      if(!s.first || v.date < s.first) s.first = v.date;
      if(!peakFirst[v.peakId] || v.date < peakFirst[v.peakId]) peakFirst[v.peakId] = v.date;
    }
    s.km += v.km || 0; s.ascent += v.ascent || 0; s.photos += v.photos.length;
    var seen = {};
    v.companions.forEach(function(c){
      if(!pnorm(c)) return;
      var key = personKey(c);
      if(seen[key]) return;
      seen[key] = 1;
      if(!per[key]) per[key] = {name:shownName(c), c:0};
      per[key].c++;
    });
  });
  Object.keys(peakFirst).forEach(function(id){ if(!s.last || peakFirst[id] > s.last) s.last = peakFirst[id]; });
  var list = Object.keys(per).map(function(k){ return per[k]; }).sort(function(a, b){ return b.c - a.c || a.name.localeCompare(b.name, 'pl'); });
  s.people = list.length;
  s.top = list.slice(0, 3).map(function(x){ return x.name; });
  return s;
}

/* ── zdjęcia w formularzu ── */
function renderPhotos(){
  var box = $('dy-photos');
  if(!box || !cur) return;
  var user = curUser();
  var h = cur.photos.map(function(p, i){
    var hasPos = typeof p.lat==='number' && typeof p.lng==='number';
    var tip = [p.t ? p.t.replace('T',' ') : '', hasPos ? p.lat.toFixed(5)+', '+p.lng.toFixed(5) : ''].filter(Boolean).join(' · ');
    if(p.ext) tip = 'Zdjęcie współuczestnika'+(tip ? ' · '+tip : '');
    return '<div class="dy-ph'+(p.ext?' ext':'')+'" data-ph="'+esc(p.id)+'"'+(tip?' title="'+esc(tip)+'"':'')+'>'+
      '<a target="_blank" rel="noopener"><img alt="Zdjęcie '+(i+1)+'"'+(p.isNew?' src="'+esc(p.objUrl)+'"':'')+'></a>'+
      (hasPos ? '<a class="dy-ph-pin" href="'+esc(mapLink(p.lat,p.lng))+'" target="_blank" rel="noopener" title="Pokaż miejsce zdjęcia na mapie">📍</a>' : '')+
      // P49: krzyżyk usuwania tylko w trybie „Edytuj” (łatwo było w niego trafić, chcąc obejrzeć zdjęcie)
      (cur.photoEdit ? '<button type="button" class="dy-ph-x" data-rmph="'+i+'" aria-label="Usuń zdjęcie '+(i+1)+'">×</button>' : '')+'</div>';
  }).join('');
  if(photoRoom() > 0){
    h += '<button type="button" class="dy-ph add" data-addph="1" aria-label="Dodaj zdjęcia">＋<span>zdjęcie</span></button>';
  }
  box.innerHTML = h;
  var ext = cur.photos.filter(function(p){ return p.ext; }).length;
  $('dy-ph-count').textContent = (cur.photos.length - ext)+' / '+MAX_PHOTOS + (ext ? ' · +'+ext+' od współuczestnika' : '');
  if(!cur.photos.length) cur.photoEdit = false;
  var pe = $('dy-ph-edit');
  pe.hidden = !cur.photos.length;
  pe.textContent = cur.photoEdit ? 'Gotowe' : 'Edytuj';
  pe.classList.toggle('on', !!cur.photoEdit);
  box.classList.toggle('editing', !!cur.photoEdit);
  // zapisane zdjęcia: miniatury ze Storage
  var visitId = cur.visitId;
  cur.photos.forEach(function(p, i){
    if(p.isNew || !user) return;
    var el = box.querySelectorAll('.dy-ph[data-ph]')[i];
    var img = el && el.querySelector('img'), a = el && el.querySelector('a');
    if(!img) return;
    photoUrl(user.uid, visitId, p.id, true).then(function(u){ if(img.isConnected) img.src = u; }).catch(function(){ if(img.isConnected) img.classList.add('broken'); });
    photoUrl(user.uid, visitId, p.id, false).then(function(u){ if(a.isConnected) a.href = u; }).catch(function(){});
  });
}

function addPhotoFiles(files){
  if(!cur) return;
  var err = $('dy-err');
  var room = photoRoom();
  var imgs = files.filter(function(f){ return /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(f.name); });
  if(!imgs.length){ if(files.length) err.textContent = 'To nie jest zdjęcie.'; return; }
  if(room <= 0){ err.textContent = 'Maksymalnie '+MAX_PHOTOS+' własnych zdjęć na wejście.'; return; }
  var take = imgs.slice(0, room);
  err.textContent = imgs.length > room ? 'Dodano '+room+' z '+imgs.length+' (limit '+MAX_PHOTOS+' własnych zdjęć).' : '';
  var tok = cur;                                   // formularz mógł się zmienić w trakcie przetwarzania
  var chain = Promise.resolve();
  take.forEach(function(file){
    chain = chain.then(function(){
      if(file.size > MAX_SRC_BYTES){ err.textContent = 'Zdjęcie „'+file.name+'” jest za duże (maks. 30 MB).'; return; }
      return Promise.all([processPhoto(file), readMeta(file)]).then(function(res){
        if(cur !== tok) return;
        var r = res[0], meta = res[1];
        var ph = {id:newPhotoId(), isNew:true, blob:r.full, thumb:r.thumb, objUrl:URL.createObjectURL(r.thumb)};
        if(meta.lat!=null){ ph.lat = meta.lat; ph.lng = meta.lng; }
        if(meta.t) ph.t = meta.t;
        tok.photos.push(ph);
        // pusta data wejścia -> podpowiedz datę ze zdjęcia (o ile nie z przyszłości)
        var day = meta.t && meta.t.slice(0,10);
        if(day && !$('dy-date').value && day <= todayIso()){ $('dy-date').value = day; renderSuggest(); }
        renderPhotos();
      }).catch(function(){
        err.textContent = 'Nie udało się wczytać „'+file.name+'” (np. format HEIC — zapisz jako JPEG).';
      });
    });
  });
}

/* przełącznik wejść na ten szczyt: [12.08.2025] [03.09.2025] [＋ Nowe] */
function renderVisitTabs(list){
  var h = list.map(function(v, i){
    var lbl = v.date ? fmtVisitDate(v) : 'bez daty';
    return '<button type="button" class="dy-vt'+(cur.visitId===v.id?' on':'')+'" data-vid="'+esc(v.id)+'" title="Wejście '+(i+1)+'">'+esc(lbl)+'</button>';
  }).join('');
  h += '<button type="button" class="dy-vt new'+(cur.visitId===null?' on':'')+'" data-vid="">＋ '+(list.length?'Nowe wejście':'Pierwsze wejście')+'</button>';
  $('dy-visits').innerHTML = h;
}

/* podpowiedzi miejsc (skąd/dokąd) z dotychczasowych wejść */
function renderPlaces(){
  var seen = {}, opts = '';
  Object.keys(visits).forEach(function(k){
    [visits[k].from, visits[k].to].forEach(function(s){
      if(s && !seen[s.toLowerCase()]){ seen[s.toLowerCase()] = 1; opts += '<option value="'+esc(s)+'">'; }
    });
  });
  $('dy-places').innerHTML = opts;
}

/* sure: bez pytania „Czy to …?” (wybór z podpowiedzi albo odpowiedź na pytanie) */
function addCompanion(raw, sure){
  var name = String(raw||'').replace(/\s+/g,' ').trim().slice(0, MAX_COMP_LEN);
  if(!name || !cur) return;
  // znana osoba albo ta sama pisownia co w innym wejściu: jedna, ta sama nazwa
  var key = personKey(name), known = peopleEntries().filter(function(e){ return e.key===key; })[0];
  if(known) name = known.name;
  if(cur.companions.some(function(c){ return personKey(c)===key; })){ pending = null; renderSuggest(); return; }
  if(!sure && !known){
    var near = nearName(name);
    if(near && !cur.companions.some(function(c){ return personKey(c)===personKey(near); })){
      pending = {name:name, near:near}; renderSuggest(); return;
    }
  }
  pending = null;
  if(cur.companions.length >= MAX_COMP){ $('dy-err').textContent = 'Maksymalnie '+MAX_COMP+' osób.'; return; }
  cur.companions.push(name);
  renderChips();
}

function renderChips(){
  $('dy-chips').innerHTML = cur.companions.map(function(c,i){
    return '<span class="dy-chip">'+esc(c)+'<button type="button" data-rm="'+i+'" aria-label="Usuń '+esc(c)+'">×</button></span>';
  }).join('');
  renderSuggest();
}

/* podpowiedzi: ekipa z wejść z tą samą datą, potem najczęstsi towarzysze; podczas pisania — pasujące osoby
   (od początku imienia lub nazwiska, bez polskich znaków), także z książki osób */
function renderSuggest(){
  if(!cur) return;
  var box = $('dy-suggest');
  if(pending){
    box.innerHTML = '<span class="dy-near">Czy „'+esc(pending.name)+'” to <b>'+esc(pending.near)+'</b>?</span>'+
      '<button type="button" class="dy-sg yes" data-near="yes">Tak</button>'+
      '<button type="button" class="dy-sg" data-near="no">Nie, inna osoba</button>';
    return;
  }
  var q = pnorm($('dy-comp-in').value);
  var date = $('dy-date').value;
  var score = {}, names = {};
  Object.keys(visits).forEach(function(id){
    if(id===cur.visitId) return;
    var v = visits[id];
    shownList(v.companions).forEach(function(c){
      var k = personKey(c);
      names[k] = c;
      score[k] = (score[k]||0) + 1 + (date && v.date===date ? 1000 : 0);
    });
  });
  Object.keys(people.byUid).forEach(function(u){ if(!names['u:'+u]){ names['u:'+u] = people.byUid[u]; score['u:'+u] = 0; } });
  var have = {};
  cur.companions.forEach(function(c){ have[personKey(c)] = 1; });
  var keys = Object.keys(names).filter(function(k){
    if(have[k]) return false;
    return q ? (' '+pnorm(names[k])).indexOf(' '+q)!==-1 : score[k] > 0;
  }).sort(function(a,b){ return score[b]-score[a] || names[a].localeCompare(names[b],'pl'); }).slice(0,6);
  box.innerHTML = keys.map(function(k){
    return '<button type="button" class="dy-sg" data-add="'+esc(names[k])+'">＋ '+esc(names[k])+'</button>';
  }).join('');
}

function updateCount(){
  $('dy-count').textContent = $('dy-note').value.length+' / '+MAX_NOTE;
}

/* "12,5" -> 12.5 ; puste -> null ; błąd -> NaN */
function parseNum(s, asInt){
  s = String(s||'').trim().replace(/\s/g,'').replace(',', '.');
  if(!s) return null;
  if(!/^\d+(\.\d+)?$/.test(s)) return NaN;
  var n = parseFloat(s);
  return asInt ? Math.round(n) : Math.round(n*10)/10;
}

function save(){
  if(!cur) return;
  var f = fb(), user = curUser();
  var err = $('dy-err');
  if(!user){ err.textContent = 'Zaloguj się, aby zapisać.'; return; }
  if(!loadOk){ err.textContent = 'Wejścia nie zostały wczytane — odśwież stronę.'; return; }

  var ci = $('dy-comp-in');
  if(pending){ addCompanion(pending.name, true); }
  if(ci.value.trim()){ addCompanion(ci.value, true); ci.value=''; }

  var date = $('dy-date').value || null;
  if(date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > todayIso())){
    err.textContent = 'Data nie może być z przyszłości.'; return;
  }
  var note = $('dy-note').value.trim();
  if(note.length > MAX_NOTE){ err.textContent = 'Wspomnienie jest za długie.'; return; }

  var km = parseNum($('dy-km').value, false);
  if(km!==null && (isNaN(km) || km>MAX_KM)){ err.textContent = 'Dystans: podaj liczbę km (0–'+MAX_KM+').'; return; }
  var ascent = parseNum($('dy-asc').value, true);
  if(ascent!==null && (isNaN(ascent) || ascent>MAX_ASCENT)){ err.textContent = 'Podejście: podaj liczbę metrów (0–'+MAX_ASCENT+').'; return; }

  var from = $('dy-from').value.trim() || null;
  var to = $('dy-to').value.trim() || null;
  if((from && from.length>MAX_PLACE) || (to && to.length>MAX_PLACE)){ err.textContent = 'Nazwa miejsca jest za długa.'; return; }

  var link = $('dy-link').value.trim();
  if(link){
    if(!/^[a-z][a-z0-9+.-]*:/i.test(link)) link = 'https://'+link;
    if(!/^https:\/\//i.test(link)){ err.textContent = 'Link musi zaczynać się od https://'; return; }
    link = 'https://'+link.slice(8);
    if(link.length > MAX_LINK){ err.textContent = 'Link jest za długi.'; return; }
  } else link = null;

  var data = {
    peakId: cur.p.id,
    date: date,
    dateApprox: !!date && $('dy-date-approx').checked,
    note: note,
    companions: cur.companions.slice(0, MAX_COMP),
    from: from,
    to: to,
    km: km,
    ascent: ascent,
    link: link,
    photos: cur.photos.map(photoRecord),
    updatedAt: f.serverTimestamp()
  };
  if(cur.partners) data.partners = cur.partners;   // wspólne wejście: bez tego pola reguły ograniczą zdjęcia do 6
  if(cur.track) data.track = cur.track;             // P56: pole tylko ze śladem (bez niego zapis działa i na starych regułach)
  var type = cur.type, idx = cur.idx, state = cur;
  var ref = cur.visitId
    ? f.doc(f.db,'users',user.uid,'visits',cur.visitId)
    : f.doc(visitsCol(f, user.uid));
  var fresh = state.photos.filter(function(p){ return p.isNew; });
  var uploaded = [];
  if(fresh.length && !(f.storage && f.uploadBytes)){
    err.textContent = 'Zdjęcia są chwilowo niedostępne (Storage). Usuń je lub spróbuj później.'; return;
  }
  $('dy-save').disabled = true; state.busy = true; err.textContent = '';

  // 0) wejście zmienione w międzyczasie (inne urządzenie/karta)? Wtedy nie nadpisujemy.
  var check = state.visitId ? f.getDoc(ref).then(function(snap){
    var now = snap.exists() ? normalize(ref.id, snap.data()) : null;
    if(!now || now.updatedAtMs !== state.loadedMs){
      var e = new Error('conflict'); e.code = 'conflict'; e.gone = !now; throw e;
    }
  }) : Promise.resolve();

  // 1) wyślij nowe zdjęcia (pełne + miniatura), 2) zapisz wejście, 3) posprzątaj usunięte pliki
  var upload = fresh.reduce(function(chain, p, i){
    return chain.then(function(){
      $('dy-save').textContent = 'Zdjęcia '+(i+1)+'/'+fresh.length+'…';
      var meta = {contentType:'image/jpeg'};
      return f.uploadBytes(f.sRef(f.storage, photoPath(user.uid, ref.id, p.id, false)), p.blob, meta).then(function(){
        uploaded.push(photoPath(user.uid, ref.id, p.id, false));
        return f.uploadBytes(f.sRef(f.storage, photoPath(user.uid, ref.id, p.id, true)), p.thumb, meta);
      }).then(function(){ uploaded.push(photoPath(user.uid, ref.id, p.id, true)); });
    });
  }, check);

  upload.then(function(){
    $('dy-save').textContent = 'Zapisuję…';
    return f.setDoc(ref, data);
  }).then(function(){
    deleteFiles(user.uid, ref.id, state.removedPhotos);
    // P49: wspólne wejście z nowymi zdjęciami/danymi → po zamknięciu formularza propozycja „Wyślij zmiany”
    var targets = state.visitId && INVITES_ON ? offerTargets() : [];
    var askNow = targets.length && offerWorth(visits[ref.id], data, fresh.length);
    visits[ref.id] = normalize(ref.id, data);
    indexSpellings();
    state.busy = false;
    $('dy-save').textContent = 'Zapisz';
    refreshPopup(type, idx);
    drawTracks();
    var after = null;
    if(askNow){ after = afterClose; afterClose = null; }   // okna z app.js (np. otwarcie korony) dopiero po propozycji
    closeForm();
    var lo = $('diary-list-overlay');
    if(lo && !lo.classList.contains('hidden')) renderList();
    toast('Zapisano wejście ✓');
    if(askNow) setTimeout(function(){ askOffer(targets, state.p.name, fresh.length, after); }, 200);
  }).catch(function(e){
    console.warn('Zapis wejścia nieudany', e);
    // sprzątanie plików wysłanych przed błędem (zapis dokumentu się nie udał)
    uploaded.forEach(function(path){ try{ f.deleteObject(f.sRef(f.storage, path)).catch(function(){}); }catch(x){} });
    state.busy = false;
    $('dy-save').disabled = false; $('dy-save').textContent = 'Zapisz';
    var code = e && e.code || '';
    if(code==='conflict'){
      err.textContent = e.gone ? 'To wejście zostało usunięte na innym urządzeniu.'
        : 'To wejście zmieniono w międzyczasie (np. na telefonie) — nic nie nadpisano. Zamknij je i otwórz ponownie, a potem wprowadź zmiany jeszcze raz.';
      load(user);
      return;
    }
    err.textContent = code==='permission-denied' ? 'Brak uprawnień — zaloguj się ponownie.'
      : code.indexOf('storage/')===0 ? 'Nie udało się wysłać zdjęć. Sprawdź połączenie i spróbuj ponownie.'
      : 'Nie udało się zapisać. Spróbuj ponownie.';
  });
}

/* kasowanie plików zdjęć (pełne + miniatura); najlepsza próba, błędy ignorowane */
function deleteFiles(uid, visitId, ids){
  var f = fb();
  if(!ids || !ids.length || !f || !f.storage || !f.deleteObject) return;
  ids.forEach(function(id){
    [false, true].forEach(function(t){
      var path = photoPath(uid, visitId, id, t);
      delete urlCache[path];
      try{ f.deleteObject(f.sRef(f.storage, path)).catch(function(){}); }catch(x){}
    });
  });
}

function remove(){
  if(!cur || !cur.visitId) return;
  var f = fb(), user = curUser();
  if(!user) return;
  if(!confirm('Usunąć to wejście na „'+cur.p.name+'”? Tej operacji nie można cofnąć.')) return;
  var vid = cur.visitId, type = cur.type, idx = cur.idx;
  var oldPhotos = visits[vid] ? visits[vid].photos.map(function(p){ return p.id; }) : [];
  f.deleteDoc(f.doc(f.db,'users',user.uid,'visits',vid)).then(function(){
    deleteFiles(user.uid, vid, oldPhotos);
    cancelAllFor(vid);
    delete visits[vid];
    refreshPopup(type, idx);
    drawTracks();
    closeForm();
    var lo = $('diary-list-overlay');
    if(lo && !lo.classList.contains('hidden')) renderList();
    toast('Wejście usunięte');
  }).catch(function(e){
    console.warn('Usunięcie wejścia nieudane', e);
    $('dy-err').textContent = 'Nie udało się usunąć. Spróbuj ponownie.';
  });
}

/* ── lista „Moje wejścia” ── */
function openList(){
  if(!requireLogin(openList)) return;
  ensureDom();
  // adres mógł zostać potwierdzony w innej karcie/aplikacji poczty — odśwież stan konta (i zaproszenia)
  var u = curUser();
  if(u && !u.emailVerified && typeof refreshVerified==='function') refreshVerified();
  $('diary-list-overlay').classList.remove('hidden');
  if(loadOk) renderList();
  else {
    $('dl-rows').innerHTML = '<div class="dl-empty">Ładowanie…</div>';
    load(curUser()).then(function(){
      if(!loadOk) $('dl-rows').innerHTML = '<div class="dl-empty">Nie udało się wczytać wejść. Odśwież stronę.</div>';
      else renderList();
    });
  }
}

function closeList(){
  var o = $('diary-list-overlay'); if(o) o.classList.add('hidden');
}

/* ── P56: wgrywanie śladów GPX do wielu wejść naraz ──
   Każda trasa z plików trafia do wejść z tego samego dnia, których szczyt leży ≤ 400 m od śladu
   (jedna trasa może obejść dwa szczyty). Lista do zatwierdzenia; wejścia z już zapisanym śladem
   domyślnie odznaczone. Zapis: tylko pole track (+ puste km/podejście), merge. */
var gpxItems = [];
function gpxImport(files){
  if(!loadOk) return;
  var big = files.filter(function(f){ return f.size > MAX_GPX_BYTES; });
  Promise.all(files.filter(function(f){ return f.size <= MAX_GPX_BYTES; }).map(function(f){
    return f.text().then(function(t){
      try { return gpxTracks(t).map(function(x){ x.file = f.name; return x; }); }
      catch(e){ return [{file: f.name, error: e.message || 'Nie udało się odczytać pliku.'}]; }
    });
  })).then(function(lists){
    var trs = [].concat.apply([], lists);
    big.forEach(function(f){ trs.push({file: f.name, error: 'Plik jest za duży (do 15 MB).'}); });
    var own = Object.keys(visits).map(function(k){ return visits[k]; });
    gpxItems = [];
    var html = trs.map(function(t, ti){
      var title = esc(t.name || t.file) + (t.date ? ' <small>'+esc(fmtDate(t.date))+'</small>' : '');
      if(t.error) return '<div class="gi-row off"><div class="gi-trk">'+esc(t.file)+'</div><div class="gi-why">'+esc(t.error)+'</div></div>';
      var enc = encTrack(t.pts);
      var hits = own.filter(function(v){
        var r = peakRef(v.peakId);
        return r && v.date && v.date===t.date && trackNear(t.raw, [r.p.lat, r.p.lng]) <= 400;
      });
      if(!hits.length || enc.length > MAX_TRACK_CHARS){
        // podpowiedź: szczyt z listy przy trasie, ale bez wejścia z tego dnia
        var near = [];
        ['ks','wks','dks'].concat(kpsOn() ? ['kps'] : []).forEach(function(ty){ tierArr(ty).forEach(function(p){ if(trackNear(t.raw, [p.lat, p.lng]) <= 400) near.push(p.name); }); });
        var why = enc.length > MAX_TRACK_CHARS ? 'Ślad jest zbyt szczegółowy.'
          : near.length ? 'Przechodzi przez: '+near.join(', ')+' — ale nie masz wejścia z '+(t.date ? fmtDate(t.date) : 'tego dnia')+'. Dodaj je i wgraj ślad jeszcze raz.'
          : 'Nie przechodzi koło żadnego szczytu z list koron.';
        return '<div class="gi-row off"><div class="gi-trk">'+title+' <span class="gi-km">'+fmtNum(t.km)+' km</span></div><div class="gi-why">'+esc(why)+'</div></div>';
      }
      return hits.map(function(v){
        var r = peakRef(v.peakId), i = gpxItems.length, had = !!v.track;
        gpxItems.push({vid: v.id, enc: enc, km: t.km, ascent: t.ascent, type: r.type, idx: r.idx});
        return '<label class="gi-row"><input type="checkbox" data-gi="'+i+'"'+(had ? '' : ' checked')+'>'+
          '<div class="gi-trk">'+title+' <span class="gi-km">'+fmtNum(t.km)+' km</span></div>'+
          '<div class="gi-to">→ <b>'+esc(r.p.name)+'</b> · '+esc(fmtVisitDate(v))+(had ? ' <span class="gi-had">ma już ślad — zaznacz, by zastąpić</span>' : '')+'</div></label>';
      }).join('');
    }).join('');
    ensureGpxDom();
    $('gi-rows').innerHTML = html || '<div class="dl-empty">Brak tras w plikach.</div>';
    $('gi-err').textContent = '';
    gpxCount();
    $('gpx-overlay').classList.remove('hidden');
  });
}
function ensureGpxDom(){
  if($('gpx-overlay')) return;
  var w = document.createElement('div');
  w.innerHTML = '<div id="gpx-overlay" class="hidden" role="dialog" aria-modal="true" aria-labelledby="gi-title">'+
    '<div class="dy-box dy-wide"><div class="dy-hdr"><div class="dy-title" id="gi-title">🗺 Ślady GPX do wejść</div>'+
    '<button class="dy-close" id="gi-x" title="Zamknij">✕</button></div>'+
    '<div class="dy-body"><div class="gi-hint">Zaznaczone ślady zapiszą się przy wejściach i pokażą na mapie w „Moje trasy”. Puste pola dystansu i podejścia uzupełnią się z pliku.</div>'+
    '<div id="gi-rows"></div></div>'+
    '<div class="dy-foot"><span class="dy-err" id="gi-err"></span><button class="dy-btn ghost" id="gi-cancel">Anuluj</button>'+
    '<button class="dy-btn primary" id="gi-save">Zapisz</button></div></div></div>';
  document.body.appendChild(w.firstChild);
  $('gi-x').onclick = $('gi-cancel').onclick = function(){ $('gpx-overlay').classList.add('hidden'); };
  $('gi-rows').addEventListener('change', gpxCount);
  $('gi-save').onclick = gpxSave;
}
function gpxPicked(){
  return Array.prototype.slice.call(document.querySelectorAll('#gi-rows [data-gi]:checked')).map(function(c){ return gpxItems[+c.getAttribute('data-gi')]; });
}
function gpxCount(){
  var n = gpxPicked().length, b = $('gi-save');
  b.disabled = !n; b.textContent = n ? 'Zapisz ślady ('+n+')' : 'Zapisz';
}
function gpxSave(){
  var f = fb(), user = curUser(), picks = gpxPicked(), b = $('gi-save');
  if(!f || !user || !picks.length) return;
  b.disabled = true;
  var done = 0, fail = 0, saved = [];
  picks.reduce(function(chain, it){
    return chain.then(function(){
      var v = visits[it.vid]; if(!v) return;
      var data = {track: it.enc, updatedAt: f.serverTimestamp()};
      if(v.km==null && it.km) data.km = it.km;
      if(v.ascent==null && it.ascent!=null && it.ascent <= MAX_ASCENT) data.ascent = it.ascent;
      b.textContent = 'Zapisuję '+(done+fail+1)+'/'+picks.length+'…';
      return f.setDoc(f.doc(f.db, 'users', user.uid, 'visits', it.vid), data, {merge: true}).then(function(){
        v.track = it.enc; if(data.km) v.km = data.km; if(data.ascent!=null) v.ascent = data.ascent;
        v.updatedAtMs = Date.now(); done++; saved.push(it);
        if(it.type!=='kps') refreshPopup(it.type, it.idx);
      }).catch(function(e){ console.warn('Zapis śladu nieudany', it.vid, e); fail++; });
    });
  }, Promise.resolve()).then(function(){
    drawTracks();
    if(!$('diary-list-overlay').classList.contains('hidden')) renderList();
    if(fail){
      $('gi-err').textContent = 'Zapisano '+done+', nie udało się '+fail+'.';
      b.disabled = false; b.textContent = 'Spróbuj ponownie';
    } else {
      $('gpx-overlay').classList.add('hidden');
      toast('Zapisano ślady: '+done+' ✓');
    }
    // wspólne wejścia: propozycja wysłania śladu towarzyszom (offerUpdate, jak „Wyślij zmiany” w formularzu)
    var seen = {};
    saved = saved.filter(function(it){ if(seen[it.vid]) return false; seen[it.vid] = 1; return true; });
    Promise.all(saved.map(function(it){
      return targetsFor(it.vid).then(function(t){ var r = peakRef(visits[it.vid] ? visits[it.vid].peakId : ''); return {peak: r ? r.p.name : '', targets: t}; });
    })).then(function(groups){
      groups = groups.filter(function(g){ return g.targets.length; });
      if(groups.length) setTimeout(function(){ askOfferMany(groups); }, 300);
    });
  });
}

/* wiersze: jedno na wejście; zdobyty szczyt bez wejść ma jeden wiersz „dodaj” */
function listRows(){
  var rows = [];
  tiersShown().forEach(function(type){
    tierArr(type).forEach(function(p, idx){
      if((STATE[type]||[]).indexOf(idx)===-1 || !p.id) return;
      var vs = visitsOf(p.id);
      if(!vs.length) rows.push({p:p, type:type, idx:idx, v:null});
      vs.forEach(function(v){ rows.push({p:p, type:type, idx:idx, v:v}); });
    });
  });
  return rows;
}

function renderList(){
  ensureDom();
  renderInvites();
  var all = listRows();
  var conq = {}, n = 0, km = 0, asc = 0, team = 0, perPeak = {}, perComp = {};
  all.forEach(function(r){
    conq[r.p.id] = 1;
    if(r.v){
      n++; km += r.v.km||0; asc += r.v.ascent||0;
      // „w zespole” = wpisany choć jeden towarzysz; bez towarzyszy liczymy jako „samemu”
      if(r.v.companions.some(function(c){ return c.trim(); })) team++;
      if(!perPeak[r.p.id]) perPeak[r.p.id] = {name:r.p.name, c:0};
      perPeak[r.p.id].c++;
      // towarzysz liczony raz na wejście; „Ania” i „ania ” to ta sama osoba, a połączona z kontem —
      // każda jej pisownia (książka osób; pokazujemy nazwę z książki, inaczej pierwszą pisownię)
      var seen = {};
      r.v.companions.forEach(function(c){
        if(!pnorm(c)) return;
        var key = personKey(c);
        if(seen[key]) return;
        seen[key] = 1;
        if(!perComp[key]) perComp[key] = {key:key, name:shownName(c), c:0, peaks:{}};
        perComp[key].c++;
        perComp[key].peaks[r.p.id] = r.p.name;
      });
    }
  });
  // najczęstsze (od 2 razy); przy remisie wszystkie
  function leaders(map){
    var items = Object.keys(map).map(function(k){ return map[k]; });
    var max = items.reduce(function(m, x){ return Math.max(m, x.c); }, 0);
    return max>=2 ? {c:max, names:items.filter(function(x){ return x.c===max; }).map(function(x){ return x.name; })} : null;
  }
  var topPeak = leaders(perPeak), topComp = leaders(perComp);
  var stats = ['<span><b>'+Object.keys(conq).length+'</b> zdobytych</span>', '<span><b>'+n+'</b> wejść</span>'];
  if(n) stats.push('<span><b>'+(n-team)+'</b> samemu · <b>'+team+'</b> w zespole</span>');
  if(km) stats.push('<span><b>'+fmtNum(Math.round(km*10)/10)+'</b> km</span>');
  if(asc) stats.push('<span><b>'+asc+'</b> m podejść</span>');
  if(topPeak) stats.push('<span>najczęściej na: <b>'+topPeak.names.map(esc).join('</b>, <b>')+'</b> ×'+topPeak.c+'</span>');
  if(topComp) stats.push('<span>najczęściej z: <b>'+topComp.names.map(esc).join('</b>, <b>')+'</b> ×'+topComp.c+'</span>');
  $('dl-stats').innerHTML = stats.join('');

  // wszyscy towarzysze: od najczęstszych, przy równej liczbie alfabetycznie
  var comps = Object.keys(perComp).map(function(k){ return perComp[k]; }).sort(function(a, b){
    return b.c - a.c || a.name.localeCompare(b.name, 'pl');
  });
  // kliknięty towarzysz: wspólnie zdobyte szczyty i lista zawężona do wspólnych wejść
  var sel = compFilter && perComp[compFilter];
  if(!sel) compFilter = null;
  var withLine = '';
  if(sel){
    var pk = Object.keys(sel.peaks).map(function(id){ return sel.peaks[id]; }).sort(function(a, b){ return a.localeCompare(b, 'pl'); });
    // imienia nie odmieniamy („z Wojtek”), więc imię na początku, bez przyimka
    withLine = '<div class="dl-with" id="dl-with"><b>'+esc(sel.name)+'</b> — wspólnie '+sel.c+' '+plural(sel.c, 'wejście', 'wejścia', 'wejść')+
      ', '+pk.length+' '+plural(pk.length, 'szczyt', 'szczyty', 'szczytów')+': '+pk.map(esc).join(', ')+
      ' <button type="button" class="dy-sg" data-ck="'+esc(sel.key)+'">✕ pokaż wszystkie wejścia</button></div>';
  }
  $('dl-comps').hidden = !comps.length;
  $('dl-comps').innerHTML = comps.length ? '<span class="dl-comps-lbl">Towarzysze ('+comps.length+'):</span> '+
    comps.map(function(x){
      return '<button type="button" class="dl-comp'+(x.key===compFilter ? ' on' : '')+'" data-ck="'+esc(x.key)+'"'+
        ' title="Pokaż wspólne wejścia" aria-pressed="'+(x.key===compFilter)+'">'+esc(x.name)+(x.c>1 ? ' <i>×'+x.c+'</i>' : '')+'</button>';
    }).join('')+
    ' <button type="button" class="dy-sg" data-people="1">'+(peopleOpen ? 'Zamknij osoby' : 'Osoby: nazwy i łączenie…')+'</button>'+withLine : '';
  renderPeople();

  $('dl-tabs').innerHTML = [['all','Wszystkie']].concat(tiersShown().map(function(t){ return [t, tierShort(t)]; })).map(function(t){
    return '<button type="button" class="dl-tab'+(listTab===t[0]?' on':'')+'" data-tab="'+t[0]+'">'+t[1]+'</button>';
  }).join('');

  var rows = all.filter(function(r){
    if(compFilter && !(r.v && r.v.companions.some(function(c){ return personKey(c)===compFilter; }))) return false;
    return listTab==='all' || r.type===listTab;
  });
  rows.sort(function(a,b){
    var da = a.v && a.v.date, db = b.v && b.v.date;
    if(da && db) return da<db ? 1 : da>db ? -1 : 0;   // najnowsze na górze
    if(da) return -1;
    if(db) return 1;
    if(!!a.v !== !!b.v) return a.v ? -1 : 1;           // wejścia bez daty przed pustymi szczytami
    return a.p.name.localeCompare(b.p.name,'pl');
  });

  if(!rows.length){
    $('dl-rows').innerHTML = '<div class="dl-empty">'+(compFilter ? 'Brak wspólnych wejść w tej koronie.' : all.length
      ? 'Brak zdobytych szczytów w tej koronie.'
      : 'Nie zdobyłeś jeszcze żadnego szczytu. Oznacz szczyt jako zdobyty na mapie — wtedy możesz dodać do niego wejście.')+'</div>';
    return;
  }

  $('dl-rows').innerHTML = rows.map(function(r){
    var v = r.v;
    var route = '';
    if(v){
      var parts = [];
      if(v.from || v.to) parts.push(esc(v.from||'?')+' → '+esc(v.to||'?'));
      if(v.km!=null) parts.push(fmtNum(v.km)+' km');
      if(v.ascent!=null) parts.push('↑ '+v.ascent+' m');
      route = parts.join(' · ');
    }
    var note = v && v.note ? (v.note.length>120 ? v.note.slice(0,120)+'…' : v.note) : '';
    var meta = [];
    if(v && v.companions.length) meta.push('👥 '+esc(shownList(v.companions).join(', ')));
    if(v && v.photos.length) meta.push('📷 '+v.photos.length);
    if(v && v.link) meta.push('🔗');
    if(v && v.track) meta.push('🗺 ślad');
    return '<div class="dl-row" data-type="'+r.type+'" data-idx="'+r.idx+'" data-vid="'+(v?esc(v.id):'')+'" tabindex="0">'+
      '<span class="dl-badge '+r.type+'" title="'+tierName(r.type)+'">'+tierLabel(r.type)+'</span>'+
      '<div class="dl-main"><div class="dl-name">'+esc(r.p.name)+' <small>'+esc(r.p.pasmo)+'</small></div>'+
        (route ? '<div class="dl-route">'+route+'</div>' : '')+
        (note ? '<div class="dl-note">'+esc(note)+'</div>' : '')+
        (meta.length ? '<div class="dl-meta">'+meta.join(' · ')+'</div>' : '')+
        (!v ? '<div class="dl-add">＋ Dodaj wejście</div>' : '')+
      '</div>'+
      '<div class="dl-date'+(v && v.date ? '' : ' none')+'">'+(v && v.date ? fmtVisitDate(v) : (v ? 'brak daty' : ''))+'</div>'+
    '</div>';
  }).join('');
}

/* ── „Osoby” w „Moje wejścia”: nazwy, łączenie pisowni, rozłączanie kont (P37) ── */
function renderPeople(){
  var box = $('dl-people'); if(!box) return;
  box.hidden = !peopleOpen;
  if(!peopleOpen){ box.innerHTML = ''; return; }
  var all = peopleEntries().sort(function(a, b){
    return (b.uid?1:0) - (a.uid?1:0) || b.c - a.c || a.name.localeCompare(b.name, 'pl');
  });
  var opts = function(e){
    return '<option value="">Połącz z…</option>'+all.filter(function(x){ return x.key!==e.key && !(x.uid && e.uid); })
      .map(function(x){ return '<option value="'+esc(x.key)+'">'+esc(x.name)+(x.uid ? ' (konto)' : '')+'</option>'; }).join('');
  };
  box.innerHTML = '<div class="dp-hint">Osoby z kontem łączą się same, gdy przyjmiecie zaproszenie do wspólnego wejścia — '+
      'wtedy w kopiach wejść widzisz je zawsze pod Twoją nazwą. Tu zmienisz nazwę, połączysz dwie pisownie tej samej osoby albo rozłączysz konto.</div>'+
    (all.length ? all.map(function(e){
      var sp = Object.keys(e.spell).filter(function(x){ return x!==e.name; });
      return '<div class="dp-row" data-key="'+esc(e.key)+'">'+
        '<div class="dp-main"><b>'+esc(e.name)+'</b>'+(e.uid ? ' <span class="dp-acc" title="Połączone z kontem tej osoby">konto</span>' : '')+
          (e.c ? ' <i>×'+e.c+'</i>' : '')+(sp.length ? '<div class="dp-sp">też jako: '+sp.map(esc).join(', ')+'</div>' : '')+'</div>'+
        '<div class="dp-act"><select data-merge="1" title="Ta sama osoba co…">'+opts(e)+'</select>'+
          '<button type="button" class="dy-inv-x dy-inv-re" data-pact="rename">Zmień nazwę</button>'+
          (e.uid ? '<button type="button" class="dy-inv-x" data-pact="unlink" title="Odłącz od konta (wejścia zostają bez zmian)">Rozłącz</button>' : '')+'</div>'+
      '</div>';
    }).join('') : '<div class="dl-empty">Nie masz jeszcze wpisanych towarzyszy.</div>');
}
function peopleBusy(on){
  Array.prototype.forEach.call($('dl-people').querySelectorAll('button,select'), function(b){ b.disabled = on; });
}
function entryByKey(key){ return peopleEntries().filter(function(e){ return e.key===key; })[0] || null; }
/* imię w wejściach: każda pisownia osoby fromKey → toName (bez duplikatów w wejściu) */
function rewriteVisits(fromKey, toName){
  var f = fb(), user = curUser();
  var ids = Object.keys(visits).filter(function(id){ return visits[id].companions.some(function(c){ return personKey(c)===fromKey; }); });
  return ids.reduce(function(chain, id){
    return chain.then(function(){
      var out = [], seen = {};
      visits[id].companions.forEach(function(c){
        var n = personKey(c)===fromKey ? toName : c, k = personKey(n);
        if(seen[k]) return;
        seen[k] = 1; out.push(n);
      });
      return f.updateDoc(f.doc(f.db,'users',user.uid,'visits',id), {companions:out.slice(0, MAX_COMP), updatedAt:f.serverTimestamp()});
    });
  }, Promise.resolve()).then(function(){ return load(user); });
}
function peopleDone(p, msg){
  peopleBusy(true);
  return p.then(function(){ renderList(); refreshAll(); toast(msg); }).catch(function(e){
    console.warn('Osoby: zmiana nieudana', e);
    alert('Nie udało się zapisać zmiany. Odśwież stronę i spróbuj ponownie.');
    load(curUser());
  });
}
function peopleAction(act, key){
  var e = entryByKey(key); if(!e) return;
  if(act==='rename'){
    var n = prompt('Nowa nazwa dla „'+e.name+'”:', e.name);
    n = cleanLabel(n);
    if(!n || n===e.name) return;
    if(e.uid){
      people.byUid[e.uid] = n;
      if(!people.alias[pnorm(n)]) people.alias[pnorm(n)] = e.uid;
      return peopleDone(savePeople(), 'Zmieniono nazwę ✓');
    }
    return peopleDone(rewriteVisits(key, n), 'Zmieniono nazwę w wejściach ✓');
  }
  if(act==='unlink' && e.uid){
    if(!confirm('Odłączyć „'+e.name+'” od konta? Wejścia zostają bez zmian, ale kolejne kopie z zaproszeń mogą przynieść inną pisownię.')) return;
    delete people.byUid[e.uid];
    Object.keys(people.alias).forEach(function(k){ if(people.alias[k]===e.uid) delete people.alias[k]; });
    return peopleDone(savePeople(), 'Rozłączono');
  }
}
function mergePeople(key, targetKey){
  var e = entryByKey(key), t = entryByKey(targetKey);
  if(!e || !t) return;
  if(e.uid && t.uid){ alert('To dwa różne konta — nie da się ich połączyć.'); renderPeople(); return; }
  if(!confirm('Połączyć „'+e.name+'” z „'+t.name+'”? We wszystkich wejściach będzie widoczna jedna osoba.')){ renderPeople(); return; }
  var acc = e.uid || t.uid;
  if(acc){
    // osoba z kontem: druga pisownia dopięta jako alias (wejścia bez zmian, pokazujemy nazwę z książki)
    var other = e.uid ? t : e;
    Object.keys(other.spell).concat([other.name]).forEach(function(sp){ if(pnorm(sp)) people.alias[pnorm(sp)] = acc; });
    if(isPlaceholder(people.byUid[acc]) && !isPlaceholder(other.name)) people.byUid[acc] = cleanLabel(other.name);
    return peopleDone(savePeople(), 'Połączono ✓');
  }
  return peopleDone(rewriteVisits(key, t.name), 'Połączono ✓');
}

/* ── zaproszenia: udostępnianie wejścia uczestnikom ── */
function invitesCol(f){ return f.collection(f.db,'invites'); }
function peakById(id){
  var r = null;
  tiersShown().some(function(type){
    var arr = tierArr(type);
    for(var i=0;i<arr.length;i++) if(arr[i].id===id){ r = {p:arr[i], type:type, idx:i}; return true; }
    return false;
  });
  return r;
}
function tsMs(t){ return t && typeof t.toMillis==='function' ? t.toMillis() : 0; }
function isExpired(inv){ var c = tsMs(inv.createdAt); return !!c && Date.now() - c > INVITE_DAYS*864e5; }
function statusOf(inv){ return inv.status==='pending' && isExpired(inv) ? 'expired' : inv.status; }
var STATUS_PL = {pending:'oczekuje', accepting:'przyjmowanie…', accepted:'przyjęte', declined:'odrzucone', cancelled:'anulowane', expired:'wygasło'};

/* zaproszenia do mnie: tylko z potwierdzonym adresem (tak samo sprawdzają reguły) */
function loadInvites(user){
  var f = fb();
  incoming = [];
  if(!INVITES_ON || !f || !user || !user.email || !user.emailVerified || !f.query){ notifyInvites(); return Promise.resolve(); }
  var q = f.query(invitesCol(f), f.where('toEmail','==',user.email.toLowerCase()), f.where('status','==','pending'));
  return f.getDocs(q).then(function(snap){
    var next = [];
    snap.forEach(function(d){ var x = d.data(); x.id = d.id; if(!isExpired(x)) next.push(x); });
    next.sort(function(a,b){ return tsMs(b.createdAt) - tsMs(a.createdAt); });
    incoming = next;
    notifyInvites();
    if(incoming.length && !notifyInvites._shown && !pendingLink()){
      notifyInvites._shown = true;
      showInviteModal(incoming, '');
    }
  }).catch(function(e){ console.warn('Odczyt zaproszeń nieudany', e); });
}
function notifyInvites(){
  if(typeof renderUserBar==='function' && curUser()) renderUserBar(curUser());
  var lo = $('diary-list-overlay');
  if(lo && !lo.classList.contains('hidden')) renderInvites();
}

/* link z maila: ?zaproszenie=<id> (dawniej #zaproszenie=<id>; część po „#” potrafią gubić
   przekierowania śledzenia kliknięć) -> po zalogowaniu otwórz „Moje wejścia”.
   Osoba bez konta dostaje „rejestracja=1” (dawniej „&rejestracja”) — okno logowania na zakładce rejestracji. */
function urlParam(name){
  try{ return new URLSearchParams(location.search).get(name); }catch(e){ return null; }
}
function hashInvite(){
  var q = urlParam('zaproszenie');
  if(q && /^[A-Za-z0-9]{1,40}$/.test(q)) return q;
  var m = /^#zaproszenie=([A-Za-z0-9]{1,40})(&rejestracja)?$/.exec(location.hash||''); return m ? m[1] : null;
}
function hashWantsRegister(){ return urlParam('rejestracja')==='1' || /&rejestracja$/.test(location.hash||''); }

/* Zaproszenie z linku zapamiętujemy w localStorage: przetrwa rejestrację, potwierdzanie adresu
   i powrót z poczty (link z maila potwierdzającego nie zawiera już numeru zaproszenia). */
var LINK_KEY = 'korona_invite_link';
function pendingLink(){
  try{
    var x = JSON.parse(localStorage.getItem(LINK_KEY) || 'null');
    if(x && /^[A-Za-z0-9]{1,40}$/.test(x.id) && Date.now() - (x.t||0) < INVITE_DAYS*864e5) return x;
  }catch(e){}
  return null;
}
function setPendingLink(x){ try{ x ? localStorage.setItem(LINK_KEY, JSON.stringify(x)) : localStorage.removeItem(LINK_KEY); }catch(e){} }
(function captureLink(){
  if(!INVITES_ON) return;
  var id = hashInvite();
  if(!id) return;
  setPendingLink({id:id, reg:hashWantsRegister(), t:Date.now()});
  clearInviteUrl();
  if(location.hash){ try{ history.replaceState(null, '', location.pathname + location.search); }catch(e){} }
})();
function clearInviteUrl(){
  try{
    var p = new URLSearchParams(location.search); p.delete('zaproszenie'); p.delete('rejestracja');
    var q = p.toString();
    history.replaceState(null, '', location.pathname + (q ? '?'+q : ''));
  }catch(e){}
}
function askLogin(){
  if(typeof showAuthOverlay!=='function') return;
  var pl = pendingLink();
  showAuthOverlay(function(){});
  var sub = document.querySelector('#auth-overlay .auth-sub');
  if(sub){
    if(!sub.getAttribute('data-orig')) sub.setAttribute('data-orig', sub.textContent);
    sub.textContent = pl ? 'Masz zaproszenie do wspólnego wejścia. Zaloguj się albo załóż konto na adres e-mail, na który przyszło zaproszenie — zaraz potem je przyjmiesz.'
      : sub.getAttribute('data-orig');
  }
  if(pl && pl.reg && typeof authTab==='function') authTab('reg');
}
function openFromHash(){ /* zastąpione przez handleLinkInvite (link zapamiętany w localStorage) */ }

/* Po zalogowaniu: zaproszenie z linku — podgląd przez serwer (bez wymogu potwierdzonego adresu) */
var linkBusy = false;
function handleLinkInvite(user){
  var pl = pendingLink();
  if(!INVITES_ON || !pl || !user || linkBusy) return;
  var f = fb(); if(!f || !f.callable) return;
  linkBusy = true;
  f.callable('inviteAction').then(function(fn){ return fn({inviteId:pl.id, action:'peek'}); }).then(function(res){
    linkBusy = false;
    var d = res.data || {};
    if(d.status==='pending'){ showInviteModal([d], ''); return; }
    setPendingLink(null);
    var pk = peakById(d.peakId);
    showInviteModal([], d.status==='accepted' && d.copyVisitId
      ? 'To zaproszenie zostało już przyjęte — wejście'+(pk ? ' („'+pk.p.name+'”)' : '')+' jest w Twoim pamiętniku („Moje wejścia”).'
      : 'To zaproszenie jest już nieaktualne ('+(STATUS_PL[d.status]||d.status)+'). Poproś nadawcę o nowe.');
  }).catch(function(e){
    linkBusy = false;
    var code = e && e.code || '';
    if(code==='functions/permission-denied' || code==='functions/not-found'){
      if(code==='functions/not-found') setPendingLink(null);
      showInviteModal([], e.message || 'Nie znaleziono zaproszenia.');
    } else console.warn('Podgląd zaproszenia nieudany', e);
  });
}

/* Okno zaproszeń: z linku (jedno) albo po zalogowaniu (wszystkie oczekujące). msg: komunikat zamiast listy. */
function showInviteModal(list, msg){
  ensureDom();
  var o = $('invite-overlay');
  $('iv-title').textContent = '🤝 Zaproszenie do wspólnego wejścia';   // to samo okno służy propozycjom zmian
  var h = '', many = list.length > 1;
  var AFTER = 'Po przyjęciu kopia wejścia (data, trasa, zdjęcia) trafi do Twojego pamiętnika, a szczyt zostanie oznaczony jako zdobyty. '+
    'Swoje zdjęcia i brakujące dane możesz potem dodać w swojej kopii i przyciskiem „Wyślij zmiany” zaproponować je osobie, która Cię zaprosiła.';
  if(msg) h = '<p class="iv-msg">'+esc(msg)+'</p>';
  if(many) h += '<p class="iv-after iv-intro">'+AFTER+'</p>';
  h += list.map(function(inv){
    var pk = peakById(inv.peakId);
    var name = pk ? pk.p.name : (inv.peakName || inv.peakId);
    var meta = [];
    if(inv.date) meta.push((inv.dateApprox ? 'ok. ' : '') + fmtDate(inv.date));
    if(inv.photoCount) meta.push('📷 '+inv.photoCount);
    return '<div class="iv-card" data-iv="'+esc(inv.id)+'">'+
      '<div class="iv-who"><b>'+esc(inv.fromName || 'Uczestnik wycieczki')+'</b> zaprasza Cię do potwierdzenia wspólnego wejścia:</div>'+
      '<div class="iv-peak">'+esc(name)+
        (pk ? ' <small>'+esc(pk.p.pasmo)+'</small>' : '')+'</div>'+
      (pk ? '<div class="iv-tier"><span class="dl-badge '+pk.type+'">'+tierName(pk.type)+'</span></div>' : '')+
      (meta.length ? '<div class="iv-meta">'+meta.join(' · ')+'</div>' : '')+
      (many ? '' : '<div class="iv-after">'+AFTER+'</div>')+
      '<div class="iv-btns">'+(many ? '' : '<button type="button" class="dy-btn ghost" data-later="1">Później</button>')+
        '<button type="button" class="dy-btn primary" data-accept="'+esc(inv.id)+'">Przyjmij</button></div>'+
    '</div>';
  }).join('');
  $('iv-body').innerHTML = h;
  // jedno zaproszenie: „Później” obok „Przyjmij”, bez stopki; kilka: wspólne „Później” w stopce; komunikat: „OK”
  $('iv-later').textContent = list.length ? 'Później' : 'OK';
  $('iv-later').parentNode.hidden = list.length === 1;
  o.classList.remove('hidden');
  o._list = list;
}
function closeInviteModal(){
  var o = $('invite-overlay'); if(!o) return;
  o.classList.add('hidden');
  var f = o._after; o._after = null;                // P49: okna czekające za propozycją „Wyślij zmiany” (np. otwarcie korony)
  if(f) setTimeout(f, 150);
}
function inviteFromAnywhere(id){
  var o = $('invite-overlay');
  var a = (o && o._list || []).concat(incoming).filter(function(x){ return x.id===id; });
  return a[0] || null;
}

function renderInvites(){
  var box = $('dl-invites'); if(!box) return;
  var user = curUser();
  if(!INVITES_ON || !user){ box.innerHTML = ''; return; }
  // bez potwierdzonego adresu lista zaproszeń jest niedostępna (reguły), ale zaproszenia i tak
  // przyjmuje się z linku w mailu — nie pokazujemy mylącej prośby o potwierdzenie (test 2026-10-26)
  var offersHtml = offersIn.length ? '<div class="dl-inv-title">Zmiany we wspólnych wejściach</div>' +
    offersIn.map(function(x){ return offerCard(x, true); }).join('') : '';
  if(!user.emailVerified || !incoming.length){ box.innerHTML = offersHtml; return; }
  box.innerHTML = offersHtml + '<div class="dl-inv-title">Zaproszenia do potwierdzenia</div>' + incoming.map(function(inv){
    var pk = peakById(inv.peakId);
    var meta = [];
    if(inv.date) meta.push((inv.dateApprox ? 'ok. ' : '') + fmtDate(inv.date));
    meta.push('od: '+esc(inv.fromName || 'uczestnik'));
    if(inv.photoCount) meta.push('📷 '+inv.photoCount);
    return '<div class="dl-inv">'+
      '<div class="dl-main"><div class="dl-name">'+esc(pk ? pk.p.name : inv.peakId)+(pk ? ' <small>'+esc(pk.p.pasmo)+'</small>' : '')+'</div>'+
        (pk ? '<div class="iv-tier"><span class="dl-badge '+pk.type+'">'+tierName(pk.type)+'</span></div>' : '')+
        '<div class="dl-meta">'+meta.join(' · ')+'</div></div>'+
      '<div class="dl-inv-btns"><button type="button" class="dy-btn primary" data-accept="'+esc(inv.id)+'">Przyjmij</button></div>'+
    '</div>';
  }).join('');
}

/* przyjęcie: kopię wejścia i zdjęć robi funkcja serwera acceptInvite, potem zaznaczamy szczyt jako zdobyty */
function acceptInvite(id, btn){
  var user = curUser(); if(!user) return;
  var inv = inviteFromAnywhere(id); if(!inv) return;
  if(btn){ btn.disabled = true; btn.textContent = 'Kopiuję…'; }
  fb().callable('acceptInvite').then(function(fn){ return fn({inviteId:id}); }).then(function(res){
    incoming = incoming.filter(function(x){ return x.id!==id; });
    var pl = pendingLink(); if(pl && pl.id===id) setPendingLink(null);
    var peakId = (res && res.data && res.data.peakId) || inv.peakId;
    if(typeof markConquered==='function') markConquered(peakId);
    return load(user).then(function(){
      notifyInvites();
      closeInviteModal(); closeList();
      var pk = peakById(peakId);
      // przewiń do mapy (na viasudetica.eu jest niżej) i pokaż szczyt
      if(pk && typeof jumpToPeak==='function') jumpToPeak(pk.type, pk.idx);
      else if(pk && typeof focusPeak==='function') focusPeak(pk.type, pk.idx);
      toast('Wejście dodane do Twojego pamiętnika ✓');
    });
  }).catch(function(e){
    console.warn('Przyjęcie zaproszenia nieudane', e);
    if(btn){ btn.disabled = false; btn.textContent = 'Przyjmij'; }
    var code = e && e.code || '';
    // komunikaty z serwera (functions/index.js) są po polsku i nadają się do pokazania
    var known = ['functions/failed-precondition','functions/permission-denied','functions/not-found','functions/unauthenticated','functions/invalid-argument','functions/internal'];
    alert(known.indexOf(code)!==-1 && e.message && e.message!=='internal' && e.message!=='not-found' ? e.message
      : 'Nie udało się przyjąć zaproszenia. Spróbuj ponownie później.');
    if(code==='functions/failed-precondition' || code==='functions/not-found'){
      incoming = incoming.filter(function(x){ return x.id!==id; }); notifyInvites();
      var pl = pendingLink(); if(pl && pl.id===id) setPendingLink(null);
      closeInviteModal();
    }
  });
}
/* nadawca: pole w formularzu wejścia */
function renderShare(){
  var box = $('dy-share'); if(!box) return;
  box.hidden = !INVITES_ON;
  if(!INVITES_ON || !cur) return;
  var user = curUser();
  var hint = '', can = false;
  if(!cur.visitId) hint = 'Najpierw zapisz wejście — potem możesz je udostępnić uczestnikom.';
  else if(!user || !user.emailVerified) hint = 'Aby wysyłać zaproszenia, potwierdź swój adres e-mail (menu konta).';
  else { can = true; hint = 'Uczestnik dostanie e-mail z zaproszeniem. Po przyjęciu zobaczy u siebie kopię tego wejścia (data, trasa, zdjęcia) i szczyt jako zdobyty. '+
    'Zdjęcia i dane dodane później możecie sobie nawzajem przesłać przyciskiem „Wyślij zmiany”.'; }
  // wspólne wejście (przyjęte zaproszenie, w którąkolwiek stronę): wyjaśnienie przycisku „Wyślij zmiany”
  var shared = linked.length || sent.some(function(x){ return statusOf(x)==='accepted'; });
  if(shared) hint += (hint ? ' ' : '') + '„Wyślij zmiany” proponuje drugiej osobie Twoje nowe zdjęcia i dane, których ona nie ma — '+
    'nic jej nie nadpisuje, a ona sama decyduje, czy je przyjąć. Najpierw zapisz wejście.';
  $('dy-share-in').disabled = $('dy-share-go').disabled = !can;
  renderWho(can);
  $('dy-share-hint').textContent = hint;
  $('dy-share-list').innerHTML = sent.map(function(inv){
    var st = statusOf(inv);
    return '<div class="dy-inv"><span class="dy-inv-mail">'+esc(inv.toEmail)+'</span>'+
      '<span class="dy-inv-st '+st+'">'+STATUS_PL[st]+'</span>'+
      (st==='pending' && canRemind(inv) ? '<button type="button" class="dy-inv-x dy-inv-re" data-remind="'+esc(inv.id)+'">Przypomnij</button>' : '')+
      (st==='pending' && !canRemind(inv) && tsMs(inv.remindedAt) ? '<span class="dy-inv-note">przypomniano</span>' : '')+
      (st==='pending' ? '<button type="button" class="dy-inv-x" data-cancel="'+esc(inv.id)+'">Anuluj</button>' : '')+
      (st==='accepted' ? '<button type="button" class="dy-inv-x dy-inv-re" data-offer="'+esc(inv.id)+'" title="'+OFFER_TIP+'">Wyślij zmiany</button>' : '')+'</div>';
  }).join('') + linked.map(function(inv){
    // ta kopia pochodzi z przyjętego zaproszenia: aktualizacja w drugą stronę, do nadawcy
    return '<div class="dy-inv"><span class="dy-inv-mail">wspólne z: '+esc(inv.fromName || 'uczestnik')+'</span>'+
      '<span class="dy-inv-st accepted">przyjęte</span>'+
      '<button type="button" class="dy-inv-x dy-inv-re" data-offer="'+esc(inv.id)+'" title="'+OFFER_TIP+'">Wyślij zmiany</button></div>';
  }).join('');
}
/* „Kto to?” przy zaproszeniu: towarzysz tego wejścia, którego zapraszam (toName → książka osób po przyjęciu).
   Gdy tylko jeden towarzysz nie jest jeszcze połączony z kontem ani zaproszony, wybrany od razu. */
function renderWho(can){
  var sel = $('dy-share-who'); if(!sel || !cur) return;
  var comps = cur.companions.slice();
  var invited = {};
  sent.forEach(function(x){ var st = statusOf(x); if(x.toName && st!=='cancelled' && st!=='expired') invited[pnorm(x.toName)] = 1; });
  var free = comps.filter(function(c){ return !personOf(c) && !invited[pnorm(c)]; });
  var keep = sel.value && comps.indexOf(sel.value)!==-1 ? sel.value : (free.length===1 ? free[0] : '');
  sel.innerHTML = '<option value="">Kto to? (z towarzyszy)</option>'+comps.map(function(c){
    return '<option value="'+esc(c)+'">'+esc(c)+'</option>';
  }).join('');
  sel.value = keep;
  sel.hidden = !comps.length;
  sel.disabled = !can;
}
var OFFER_TIP = 'Zaproponuj drugiej osobie swoje nowe zdjęcia i dane, których nie ma (nic nie nadpisuje; ona decyduje, czy przyjąć)';

/* ── aktualizacja wspólnego wejścia (offerUpdate / answerUpdate w functions/index.js) ──
   Każda strona przyjętego zaproszenia może zaproponować drugiej nowe zdjęcia i pola, które tamta ma puste.
   Nic nie jest nadpisywane; adresat przyjmuje albo odrzuca propozycję. */
var FIELD_PL = {date:'data', from:'skąd', to:'dokąd', km:'dystans', ascent:'podejście', note:'wspomnienie', link:'link', track:'ślad trasy'};
function offerSummary(n, keys){
  var parts = [];
  if(n) parts.push(n===1 ? '1 nowe zdjęcie' : n+(n<5 ? ' nowe zdjęcia' : ' nowych zdjęć'));
  var f = (keys||[]).map(function(k){ return FIELD_PL[k]; }).filter(Boolean);
  if(f.length) parts.push('uzupełnienie: '+f.join(', '));
  return parts.join('; ');
}
function sendOffer(inviteId, btn, errEl, onSent){
  var f = fb(), err = errEl || $('dy-err'); if(!f || !f.callable) return;
  if(isDirty()){ err.textContent = 'Najpierw zapisz zmiany w wejściu — druga osoba dostanie zapisaną wersję.'; return; }
  if(btn){ btn.disabled = true; btn.textContent = 'Wysyłam…'; }
  err.textContent = '';
  f.callable('offerUpdate').then(function(fn){ return fn({inviteId:inviteId}); }).then(function(res){
    var d = res && res.data || {};
    if(btn){ btn.textContent = 'Wysłano'; }
    toast('Wysłano propozycję: '+offerSummary(d.photoCount, d.fieldKeys)+(d.skipped ? ' (limit zdjęć: '+d.skipped+' pominięte)' : ''));
    if(onSent) onSent();
  }).catch(function(e){
    console.warn('Wysłanie zmian nieudane', e);
    if(btn){ btn.disabled = false; btn.textContent = 'Wyślij zmiany'; }
    var code = e && e.code || '';
    var known = ['functions/failed-precondition','functions/permission-denied','functions/not-found'];
    err.textContent = known.indexOf(code)!==-1 && e.message ? e.message : 'Nie udało się wysłać zmian. Spróbuj później.';
  });
}
/* P49: po zapisie wspólnego wejścia z nowymi zdjęciami lub danymi — od razu propozycja „Wyślij zmiany”
   (do osoby, która zaprosiła, i do przyjętych zaproszonych). Te same offerUpdate co przycisk w formularzu. */
var OFFER_FIELDS = ['date', 'from', 'to', 'km', 'ascent', 'note', 'link', 'track'];   // track: P56 (ślad GPX)
function offerTargets(){
  return linked.map(function(x){ return {id:x.id, name:x.fromName || 'uczestnik'}; }).concat(
    sent.filter(function(x){ return statusOf(x)==='accepted'; }).map(function(x){ return {id:x.id, name:x.toName || x.toEmail || 'uczestnik'}; }));
}
function offerWorth(prev, data, newPhotos){
  if(newPhotos > 0) return true;
  return OFFER_FIELDS.some(function(k){
    var a = prev ? prev[k] : null, b = data[k];
    if(a === '' ) a = null; if(b === '') b = null;
    return b != null && a !== b;                   // nowa albo zmieniona wartość (puste pole nic nie proponuje)
  });
}
function askOffer(targets, peakName, newPhotos, then){
  ensureDom();
  var what = newPhotos ? (newPhotos===1 ? 'nowe zdjęcie' : 'nowe zdjęcia') + ' i dane' : 'nowe dane';
  $('iv-title').textContent = '🔄 Wysłać zmiany towarzyszom?';
  $('iv-body').innerHTML = '<p class="iv-msg"><b>'+esc(peakName)+'</b> — to wspólne wejście. Wysłać '+what+' jako propozycję? '+
    'Druga osoba dostanie tylko to, czego nie ma — nic jej nie nadpisze, a ona sama zdecyduje, czy przyjąć.</p>'+
    targets.map(function(t){
      return '<div class="iv-offer-row"><span>'+esc(t.name)+'</span>'+
        '<button type="button" class="dy-btn" data-askoffer="'+esc(t.id)+'">Wyślij zmiany</button></div>';
    }).join('');
  $('iv-later').textContent = 'Nie teraz';
  $('iv-later').parentNode.hidden = false;
  var o = $('invite-overlay');
  o.querySelector('.dy-foot .dy-err').textContent = '';
  o._list = []; o._after = then || null;
  o.classList.remove('hidden');
}
/* P56: towarzysze wspólnego wejścia vid poza formularzem (wgrywanie zbiorcze śladów) — jak offerTargets() */
function targetsFor(vid){
  var f = fb(), user = curUser();
  if(!INVITES_ON || !f || !user || !f.query) return Promise.resolve([]);
  var q1 = f.query(invitesCol(f), f.where('fromUid','==',user.uid), f.where('visitId','==',vid));
  var q2 = f.query(invitesCol(f), f.where('toUid','==',user.uid), f.where('copyVisitId','==',vid));
  var rows = function(q, map){ return f.getDocs(q).then(function(snap){ var out = []; snap.forEach(function(d){ var x = d.data(); x.id = d.id; var t = map(x); if(t) out.push(t); }); return out; }).catch(function(){ return []; }); };
  return Promise.all([
    rows(q1, function(x){ return statusOf(x)==='accepted' ? {id:x.id, name:x.toName || x.toEmail || 'uczestnik'} : null; }),
    rows(q2, function(x){ return x.status==='accepted' ? {id:x.id, name:x.fromName || 'uczestnik'} : null; })
  ]).then(function(r){ return r[0].concat(r[1]); });
}
/* okno „Wysłać ślady towarzyszom?” dla kilku wejść naraz (te same przyciski data-askoffer co askOffer) */
function askOfferMany(groups){
  ensureDom();
  $('iv-title').textContent = '🔄 Wysłać ślady towarzyszom?';
  $('iv-body').innerHTML = '<p class="iv-msg">Te wejścia są wspólne. Wysłać nowy ślad trasy jako propozycję? '+
    'Druga osoba dostanie go tylko wtedy, gdy sama nie ma śladu — nic jej nie nadpisze, a ona zdecyduje, czy przyjąć.</p>'+
    groups.map(function(g){
      return g.targets.map(function(t){
        return '<div class="iv-offer-row"><span><b>'+esc(g.peak)+'</b> · '+esc(t.name)+'</span>'+
          '<button type="button" class="dy-btn" data-askoffer="'+esc(t.id)+'">Wyślij ślad</button></div>';
      }).join('');
    }).join('');
  $('iv-later').textContent = 'Nie teraz';
  $('iv-later').parentNode.hidden = false;
  var o = $('invite-overlay');
  o.querySelector('.dy-foot .dy-err').textContent = '';
  o._list = []; o._after = null;
  o.classList.remove('hidden');
}
function loadOffers(user){
  var f = fb();
  offersIn = [];
  if(!INVITES_ON || !f || !user || !f.query) return Promise.resolve();
  var q = f.query(f.collection(f.db,'offers'), f.where('toUid','==',user.uid), f.where('status','==','pending'));
  return f.getDocs(q).then(function(snap){
    var next = [];
    snap.forEach(function(d){ var x = d.data(); x.id = d.id; next.push(x); });
    offersIn = next;
    notifyInvites();
    var o = $('invite-overlay');
    if(offersIn.length && !loadOffers._shown && (!o || o.classList.contains('hidden'))){
      loadOffers._shown = true;
      showOfferModal(offersIn);
    }
  }).catch(function(e){ console.warn('Odczyt propozycji zmian nieudany', e); });
}
function offerCard(off, inList){
  var pk = peakById(off.peakId);
  var name = pk ? pk.p.name : off.peakId;
  return '<div class="'+(inList ? 'dl-inv' : 'iv-card')+'">'+
    (inList ? '<div class="dl-main"><div class="dl-name">'+esc(name)+(pk ? ' <small>'+esc(pk.p.pasmo)+'</small>' : '')+'</div>'+
        '<div class="dl-meta">od: '+esc(off.fromName || 'uczestnik')+(off.date ? ' · '+fmtDate(off.date) : '')+' · '+esc(offerSummary(off.photoCount, off.fieldKeys))+'</div></div>'
      : '<div class="iv-who"><b>'+esc(off.fromName || 'Uczestnik')+'</b> przesyła zmiany do Waszego wspólnego wejścia:</div>'+
        '<div class="iv-peak">'+esc(name)+(pk ? ' <small>'+esc(pk.p.pasmo)+'</small>' : '')+'</div>'+
        '<div class="iv-meta">'+(off.date ? fmtDate(off.date)+' · ' : '')+esc(offerSummary(off.photoCount, off.fieldKeys))+'</div>'+
        '<div class="iv-after">Dopisane zostanie tylko to, czego nie masz — Twoje zdjęcia i wypełnione pola zostają bez zmian.</div>')+
    '<div class="'+(inList ? 'dl-inv-btns' : 'iv-btns')+'"><button type="button" class="dy-btn ghost" data-odecline="'+esc(off.id)+'">Odrzuć</button>'+
      '<button type="button" class="dy-btn primary" data-oapply="'+esc(off.id)+'">Przyjmij</button></div>'+
  '</div>';
}
function showOfferModal(list){
  ensureDom();
  $('iv-title').textContent = '🔄 Zmiany we wspólnym wejściu';
  $('iv-body').innerHTML = list.map(function(x){ return offerCard(x, false); }).join('');
  $('iv-later').textContent = 'Później';
  $('iv-later').parentNode.hidden = false;
  $('invite-overlay').classList.remove('hidden');
  $('invite-overlay')._list = [];
}
function answerOffer(id, action, btn){
  var user = curUser(), f = fb(); if(!user || !f || !f.callable) return;
  var row = btn && btn.parentNode;
  if(row) Array.prototype.forEach.call(row.querySelectorAll('button'), function(b){ b.disabled = true; });
  if(btn) btn.textContent = action==='apply' ? 'Dodaję…' : 'Odrzucam…';
  f.callable('answerUpdate').then(function(fn){ return fn({offerId:id, action:action}); }).then(function(res){
    offersIn = offersIn.filter(function(x){ return x.id!==id; });
    var d = res && res.data || {};
    var done = function(){
      notifyInvites();
      if(!offersIn.length) closeInviteModal(); else if(!$('invite-overlay').classList.contains('hidden')) showOfferModal(offersIn);
      toast(action==='apply' ? 'Zmiany dodane do Twojego wejścia ✓' : 'Propozycja odrzucona');
    };
    if(action==='apply') return load(user).then(function(){
      done();
      var pk = peakById(d.peakId);
      if(pk && typeof focusPeak==='function') focusPeak(pk.type, pk.idx);
    });
    done();
  }).catch(function(e){
    console.warn('Odpowiedź na propozycję nieudana', e);
    if(row) Array.prototype.forEach.call(row.querySelectorAll('button'), function(b){ b.disabled = false; });
    if(btn) btn.textContent = action==='apply' ? 'Przyjmij' : 'Odrzuć';
    var code = e && e.code || '';
    var known = ['functions/failed-precondition','functions/permission-denied','functions/not-found'];
    alert(known.indexOf(code)!==-1 && e.message ? e.message : 'Nie udało się. Spróbuj ponownie później.');
    if(code==='functions/failed-precondition' || code==='functions/not-found'){
      offersIn = offersIn.filter(function(x){ return x.id!==id; }); notifyInvites();
      if(!offersIn.length) closeInviteModal();
    }
  });
}
/* przypomnienie: najwcześniej dobę po poprzednim mailu, najwyżej REMIND_MAX razy (sprawdza też serwer, remindInvite) */
var REMIND_MAX = 2;
function canRemind(inv){
  var last = Math.max(tsMs(inv.createdAt), tsMs(inv.mailedAt), tsMs(inv.remindedAt));
  return (inv.remindCount||0) < REMIND_MAX && !!last && Date.now() - last >= 864e5;
}
function remindInvite(id, btn){
  var f = fb(); if(!f || !f.callable) return;
  if(btn){ btn.disabled = true; btn.textContent = 'Wysyłam…'; }
  $('dy-err').textContent = '';
  f.callable('remindInvite').then(function(fn){ return fn({inviteId:id}); }).then(function(res){
    var n = res && res.data && res.data.remindCount;
    sent.forEach(function(x){ if(x.id===id){ x.remindedAt = {toMillis:function(){ return Date.now(); }}; x.remindCount = n || (x.remindCount||0)+1; } });
    renderShare();
    var inv = sent.filter(function(x){ return x.id===id; })[0];
    toast('Przypomnienie wysłane'+(inv ? ' do '+inv.toEmail : ''));
  }).catch(function(e){
    console.warn('Przypomnienie nieudane', e);
    var code = e && e.code || '';
    var known = ['functions/failed-precondition','functions/resource-exhausted','functions/permission-denied','functions/not-found'];
    $('dy-err').textContent = known.indexOf(code)!==-1 && e.message ? e.message : 'Nie udało się wysłać przypomnienia. Spróbuj później.';
    loadSent();   // świeży stan (np. zaproszenie w międzyczasie przyjęte)
  });
}
function loadSent(){
  var f = fb(), user = curUser();
  if(!INVITES_ON || !cur || !cur.visitId || !user || !f.query) return;
  var tok = cur, vid = cur.visitId;
  var q = f.query(invitesCol(f), f.where('fromUid','==',user.uid), f.where('visitId','==',vid));
  f.getDocs(q).then(function(snap){
    if(cur !== tok) return;
    var next = [];
    snap.forEach(function(d){ var x = d.data(); x.id = d.id; next.push(x); });
    next.sort(function(a,b){ return tsMs(a.createdAt) - tsMs(b.createdAt); });
    sent = next; renderShare();
  }).catch(function(e){ console.warn('Odczyt wysłanych zaproszeń nieudany', e); });
  // ta kopia z przyjętego zaproszenia? (odbiorca widzi swoje przyjęte zaproszenia po toUid)
  var q2 = f.query(invitesCol(f), f.where('toUid','==',user.uid), f.where('copyVisitId','==',vid));
  f.getDocs(q2).then(function(snap){
    if(cur !== tok) return;
    var next = [];
    snap.forEach(function(d){ var x = d.data(); x.id = d.id; if(x.status==='accepted') next.push(x); });
    linked = next; renderShare();
  }).catch(function(e){ console.warn('Odczyt wspólnego wejścia nieudany', e); });
}
function sendInvite(){
  if(!cur || !cur.visitId) return;
  var f = fb(), user = curUser(), err = $('dy-err');
  if(!user || !user.emailVerified) return;
  var email = $('dy-share-in').value.trim().toLowerCase();
  if(!EMAIL_RE.test(email) || email.length > 254){ err.textContent = 'Podaj poprawny adres e-mail uczestnika.'; return; }
  if(email === (user.email||'').toLowerCase()){ err.textContent = 'To Twój własny adres.'; return; }
  if(isDirty()){ err.textContent = 'Najpierw zapisz zmiany w wejściu — uczestnik dostanie zapisaną wersję.'; return; }
  var active = sent.filter(function(x){ var st = statusOf(x); return st!=='cancelled' && st!=='expired'; });
  if(active.some(function(x){ return x.toEmail===email; })){ err.textContent = 'Ta osoba ma już zaproszenie do tego wejścia.'; return; }
  if(active.length >= MAX_INVITES){ err.textContent = 'Maksymalnie '+MAX_INVITES+' zaproszeń na wejście.'; return; }
  var v = visits[cur.visitId] || {};
  var data = {
    fromUid: user.uid,
    // tylko podgląd; serwer i tak nadpisuje imię danymi z konta (functions/index.js onInviteCreated)
    fromName: (typeof publicName==='function' ? publicName(user) : 'Uczestnik').replace(/[@\/:<>\\]/g, ' ').trim().slice(0, 80) || 'Uczestnik',
    visitId: cur.visitId,
    peakId: cur.p.id,
    date: v.date || null,
    dateApprox: !!(v.date && v.dateApprox),
    photoCount: (v.photos||[]).length,
    toEmail: email,
    status: 'pending',
    createdAt: f.serverTimestamp()
  };
  var who = cleanLabel($('dy-share-who').value);
  if(who) data.toName = who;
  var ref = f.doc(invitesCol(f)), tok = cur;
  $('dy-share-go').disabled = true; err.textContent = '';
  f.setDoc(ref, data).then(function(){
    if(cur !== tok) return;
    data.createdAt = {toMillis:function(){ return Date.now(); }};
    data.id = ref.id; sent.push(data);
    $('dy-share-in').value = '';
    renderShare();
    toast('Zaproszenie wysłane do '+email);
  }).catch(function(e){
    console.warn('Wysłanie zaproszenia nieudane', e);
    if(cur === tok){ $('dy-share-go').disabled = false; err.textContent = 'Nie udało się wysłać zaproszenia. Spróbuj ponownie.'; }
  });
}
function cancelInvite(id){
  var f = fb();
  f.updateDoc(f.doc(f.db,'invites',id), {status:'cancelled', closedAt:f.serverTimestamp()}).then(function(){
    sent.forEach(function(x){ if(x.id===id) x.status = 'cancelled'; });
    renderShare();
  }).catch(function(e){ console.warn('Anulowanie nieudane', e); $('dy-err').textContent = 'Nie udało się anulować. Spróbuj ponownie.'; });
}
/* po usunięciu wejścia: anuluj jego oczekujące zaproszenia (najlepsza próba) */
function cancelAllFor(vid){
  var f = fb(), user = curUser();
  if(!INVITES_ON || !user || !f.query) return;
  var q = f.query(invitesCol(f), f.where('fromUid','==',user.uid), f.where('visitId','==',vid), f.where('status','==','pending'));
  f.getDocs(q).then(function(snap){
    snap.forEach(function(d){ f.updateDoc(d.ref, {status:'cancelled', closedAt:f.serverTimestamp()}).catch(function(){}); });
  }).catch(function(){});
}

/* powrót na kartę po dłuższej chwili: świeże wejścia i zaproszenia (zmiany z innego urządzenia) */
document.addEventListener('visibilitychange', function(){
  if(document.visibilityState!=='visible') return;
  var user = curUser();
  if(!user || cur || Date.now() - loadedAt < 60e3) return;
  load(user);
});

/* ── start ── */
window.Diary = {
  load: load, clear: clear, popupBtn: popupBtn,
  open: open, openList: openList,
  // P56: otwarcie konkretnego wejścia (z trasy na mapie)
  openVisit: function(type, idx, id){
    if(!requireLogin(function(){ Diary.openVisit(type, idx, id); })) return;
    ensureDom(); afterClose = null;
    load(curUser()).then(function(){ if(loadOk) openForm(type, idx, visits[id] ? id : undefined); });
  },
  visits: function(){ return visits; },
  summary: summary,
  inviteCount: function(){ return incoming.length + offersIn.length; },
  serverOn: function(){ return INVITES_ON; }   // funkcje serwera wdrożone (także własny mail weryfikacyjny)
};
ensureDom();
// markery mogły powstać zanim diary.js się załadował — przebuduj popupy z przyciskiem
if(typeof placeMarkers==='function') placeMarkers();
})();
