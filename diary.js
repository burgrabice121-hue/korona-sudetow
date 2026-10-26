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
var MAX_PHOTOS = 6, PHOTO_MAX_PX = 1600, THUMB_MAX_PX = 320, MAX_SRC_BYTES = 30*1024*1024;
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

var visits = {};       // visitId -> dane wejścia (z polem peakId)
var loadOk = false;    // true tylko po udanym odczycie (inaczej nie pozwalamy zapisywać "na ślepo")
var loadPromise = null;
var loadedAt = 0;      // kiedy ostatnio wczytano wejścia (odświeżanie po powrocie na kartę)
var cur = null;        // stan formularza
var curSig = '';       // podpis formularza do wykrywania niezapisanych zmian
var listTab = 'all';

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
function tierArr(type){ return type==='ks'?KS:type==='wks'?WKS:DKS; }
function tierLabel(type){ return type==='ks'?'KS':type==='wks'?'WKS':'DKS'; }
/* krótka nazwa jak w górnym pasku — tam, gdzie mieści się zamiast skrótu (zakładki, podtytuł) */
function tierShort(type){ return type==='ks'?'Korona':type==='wks'?'Wielka':'Diamentowa'; }
/* pełna nazwa: dla osób nowych na portalu (okno zaproszenia) i w podpowiedzi do skrótu */
function tierName(type){ return type==='ks'?'Korona Sudetów':type==='wks'?'Wielka Korona Sudetów':'Diamentowa Korona Sudetów'; }
function visitsCol(f, uid){ return f.collection(f.db,'users',uid,'visits'); }

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
    photos: normalizePhotos(d.photos),
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
    out.push(r);
  });
  return out.slice(0, MAX_PHOTOS);
}
function photoRecord(p){
  var r = {id: p.id};
  if(typeof p.lat==='number' && typeof p.lng==='number'){ r.lat = p.lat; r.lng = p.lng; }
  if(p.t) r.t = p.t;
  return r;
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
  loadPromise = f.getDocs(visitsCol(f, user.uid)).then(function(snap){
    var next = {};
    snap.forEach(function(d){ next[d.id] = normalize(d.id, d.data()); });
    visits = next;
    loadOk = true;
    loadedAt = Date.now();
    refreshAll();
    loadInvites(user);
    handleLinkInvite(user);
  }).catch(function(e){
    console.warn('Odczyt wejść nieudany', e);
  });
  return loadPromise;
}

function clear(){
  visits = {}; loadOk = false; loadPromise = null; cur = null; incoming = []; sent = [];
  // niezalogowany z linkiem z maila: poproś o logowanie; po nim load() -> handleLinkInvite() otworzy zaproszenie
  if(INVITES_ON && pendingLink()) askLogin();
  closeForm(); closeList();
  refreshAll();
}

function refreshAll(){
  if(typeof placeMarkers==='function') placeMarkers();
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
        '<div class="dy-field c12"><label for="dy-comp-in">Towarzysze</label>'+
          '<div class="dy-comp" id="dy-comp"><span id="dy-chips"></span>'+
          '<input type="text" id="dy-comp-in" maxlength="'+MAX_COMP_LEN+'" placeholder="Imię i Enter" autocomplete="off"></div>'+
          '<div class="dy-suggest" id="dy-suggest"></div></div>'+
        '<div class="dy-field c12" id="dy-share" hidden><label for="dy-share-in">Udostępnij uczestnikom (e-mail)</label>'+
          '<div class="dy-share-row"><input type="email" id="dy-share-in" maxlength="254" placeholder="adres@przyklad.pl" autocomplete="off">'+
          '<button type="button" class="dy-btn ghost" id="dy-share-go">Wyślij zaproszenie</button></div>'+
          '<div class="dy-share-hint" id="dy-share-hint"></div><div class="dy-share-list" id="dy-share-list"></div></div>'+
        '<div class="dy-field c12"><label>Zdjęcia <span class="dy-count" id="dy-ph-count"></span></label>'+
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
      '<div class="dy-body"><div id="dl-invites"></div><div class="dl-stats" id="dl-stats"></div><div class="dl-comps" id="dl-comps" hidden></div>'+
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
  $('dy-save').onclick = save;
  $('dy-del').onclick = remove;
  $('dy-note').addEventListener('input', updateCount);
  var ci = $('dy-comp-in');
  ci.addEventListener('keydown', function(ev){
    if(ev.key==='Enter' || ev.key===','){ ev.preventDefault(); addCompanion(ci.value); ci.value=''; }
    else if(ev.key==='Backspace' && !ci.value && cur && cur.companions.length){ cur.companions.pop(); renderChips(); }
  });
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
  $('dy-ph-file').addEventListener('change', function(){
    var files = Array.prototype.slice.call(this.files||[]);
    this.value = '';
    addPhotoFiles(files);
  });
  $('dy-date').addEventListener('change', renderSuggest);
  $('dy-suggest').addEventListener('click', function(ev){
    var b = ev.target.closest('[data-add]'); if(!b) return;
    addCompanion(b.getAttribute('data-add'));
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
    if(ev.target.closest('[data-later]')) return closeInviteModal();
  });
  $('dy-share-go').onclick = sendInvite;
  $('dy-share-in').addEventListener('keydown', function(ev){ if(ev.key==='Enter'){ ev.preventDefault(); sendInvite(); } });
  $('dy-share-list').addEventListener('click', function(ev){
    var b = ev.target.closest('[data-cancel]'); if(b) cancelInvite(b.getAttribute('data-cancel'));
  });
  $('dl-invites').addEventListener('click', function(ev){
    var a = ev.target.closest('[data-accept]'); if(a) return acceptInvite(a.getAttribute('data-accept'), a);
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
function open(type, idx, asNew){
  if(!requireLogin(function(){ open(type, idx, asNew); })) return;
  ensureDom();
  var go = function(){
    if(!loadOk){ alert('Nie udało się wczytać Twoich wejść. Odśwież stronę i spróbuj ponownie.'); return; }
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
    companions: v ? v.companions.slice() : [],
    photos: v ? v.photos.map(function(ph){ return Object.assign({isNew:false}, ph); }) : [],
    removedPhotos: [],
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
  $('dy-err').textContent = '';
  $('dy-del').style.display = v ? '' : 'none';
  $('dy-save').disabled = false; $('dy-save').textContent = 'Zapisz';
  renderPlaces(); renderVisitTabs(list); renderChips(); renderPhotos(); updateCount();
  curSig = formSig();
  sent = []; renderShare(); loadSent();
  $('diary-overlay').classList.remove('hidden');
  setTimeout(function(){ try{ $('dy-date').focus(); }catch(x){} }, 30);
}

function formSig(){
  return JSON.stringify([$('dy-date').value, $('dy-date-approx').checked, $('dy-from').value.trim(), $('dy-to').value.trim(),
    $('dy-km').value.trim(), $('dy-asc').value.trim(), $('dy-link').value.trim(),
    $('dy-note').value.trim(), cur ? cur.companions : [],
    cur ? cur.photos.map(function(p){ return p.id; }) : []]);
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
}

/* ── zdjęcia w formularzu ── */
function renderPhotos(){
  var box = $('dy-photos');
  if(!box || !cur) return;
  var user = curUser();
  var h = cur.photos.map(function(p, i){
    var hasPos = typeof p.lat==='number' && typeof p.lng==='number';
    var tip = [p.t ? p.t.replace('T',' ') : '', hasPos ? p.lat.toFixed(5)+', '+p.lng.toFixed(5) : ''].filter(Boolean).join(' · ');
    return '<div class="dy-ph" data-ph="'+esc(p.id)+'"'+(tip?' title="'+esc(tip)+'"':'')+'>'+
      '<a target="_blank" rel="noopener"><img alt="Zdjęcie '+(i+1)+'"'+(p.isNew?' src="'+esc(p.objUrl)+'"':'')+'></a>'+
      (hasPos ? '<a class="dy-ph-pin" href="'+esc(mapLink(p.lat,p.lng))+'" target="_blank" rel="noopener" title="Pokaż miejsce zdjęcia na mapie">📍</a>' : '')+
      '<button type="button" class="dy-ph-x" data-rmph="'+i+'" aria-label="Usuń zdjęcie '+(i+1)+'">×</button></div>';
  }).join('');
  if(cur.photos.length < MAX_PHOTOS){
    h += '<button type="button" class="dy-ph add" data-addph="1" aria-label="Dodaj zdjęcia">＋<span>zdjęcie</span></button>';
  }
  box.innerHTML = h;
  $('dy-ph-count').textContent = cur.photos.length+' / '+MAX_PHOTOS;
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
  var room = MAX_PHOTOS - cur.photos.length;
  var imgs = files.filter(function(f){ return /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(f.name); });
  if(!imgs.length){ if(files.length) err.textContent = 'To nie jest zdjęcie.'; return; }
  if(room <= 0){ err.textContent = 'Maksymalnie '+MAX_PHOTOS+' zdjęć na wejście.'; return; }
  var take = imgs.slice(0, room);
  err.textContent = imgs.length > room ? 'Dodano '+room+' z '+imgs.length+' (limit '+MAX_PHOTOS+' zdjęć).' : '';
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

function addCompanion(raw){
  var name = String(raw||'').replace(/\s+/g,' ').trim().slice(0, MAX_COMP_LEN);
  if(!name || !cur) return;
  var low = name.toLowerCase();
  if(cur.companions.some(function(c){ return c.toLowerCase()===low; })) return;
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

/* podpowiedzi: ekipa z wejść z tą samą datą, potem najczęstsi towarzysze */
function renderSuggest(){
  if(!cur) return;
  var date = $('dy-date').value;
  var score = {};
  Object.keys(visits).forEach(function(id){
    if(id===cur.visitId) return;
    var v = visits[id];
    v.companions.forEach(function(c){
      score[c] = (score[c]||0) + 1 + (date && v.date===date ? 1000 : 0);
    });
  });
  var have = cur.companions.map(function(c){ return c.toLowerCase(); });
  var names = Object.keys(score).filter(function(c){ return have.indexOf(c.toLowerCase())===-1; })
    .sort(function(a,b){ return score[b]-score[a] || a.localeCompare(b,'pl'); }).slice(0,6);
  $('dy-suggest').innerHTML = names.length
    ? names.map(function(c){
        return '<button type="button" class="dy-sg" data-add="'+esc(c)+'">＋ '+esc(c)+'</button>';
      }).join('')
    : '';
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
  if(ci.value.trim()){ addCompanion(ci.value); ci.value=''; }

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
    visits[ref.id] = normalize(ref.id, data);
    state.busy = false;
    $('dy-save').textContent = 'Zapisz';
    refreshPopup(type, idx);
    closeForm();
    var lo = $('diary-list-overlay');
    if(lo && !lo.classList.contains('hidden')) renderList();
    toast('Zapisano wejście ✓');
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

/* wiersze: jedno na wejście; zdobyty szczyt bez wejść ma jeden wiersz „dodaj” */
function listRows(){
  var rows = [];
  ['ks','wks','dks'].forEach(function(type){
    tierArr(type).forEach(function(p, idx){
      if(STATE[type].indexOf(idx)===-1 || !p.id) return;
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
  var conq = {}, n = 0, km = 0, asc = 0, perPeak = {}, perComp = {};
  all.forEach(function(r){
    conq[r.p.id] = 1;
    if(r.v){
      n++; km += r.v.km||0; asc += r.v.ascent||0;
      if(!perPeak[r.p.id]) perPeak[r.p.id] = {name:r.p.name, c:0};
      perPeak[r.p.id].c++;
      // towarzysz liczony raz na wejście; „Ania” i „ania ” to ta sama osoba (pokazujemy pierwszą pisownię)
      var seen = {};
      r.v.companions.forEach(function(c){
        var key = c.trim().toLowerCase();
        if(!key || seen[key]) return;
        seen[key] = 1;
        if(!perComp[key]) perComp[key] = {name:c.trim(), c:0};
        perComp[key].c++;
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
  if(km) stats.push('<span><b>'+fmtNum(Math.round(km*10)/10)+'</b> km</span>');
  if(asc) stats.push('<span><b>'+asc+'</b> m podejść</span>');
  if(topPeak) stats.push('<span>najczęściej na: <b>'+topPeak.names.map(esc).join('</b>, <b>')+'</b> ×'+topPeak.c+'</span>');
  if(topComp) stats.push('<span>najczęściej z: <b>'+topComp.names.map(esc).join('</b>, <b>')+'</b> ×'+topComp.c+'</span>');
  $('dl-stats').innerHTML = stats.join('');

  // wszyscy towarzysze: od najczęstszych, przy równej liczbie alfabetycznie
  var comps = Object.keys(perComp).map(function(k){ return perComp[k]; }).sort(function(a, b){
    return b.c - a.c || a.name.localeCompare(b.name, 'pl');
  });
  $('dl-comps').hidden = !comps.length;
  $('dl-comps').innerHTML = comps.length ? '<span class="dl-comps-lbl">Towarzysze ('+comps.length+'):</span> '+
    comps.map(function(x){ return '<span class="dl-comp">'+esc(x.name)+(x.c>1 ? ' <i>×'+x.c+'</i>' : '')+'</span>'; }).join('') : '';

  $('dl-tabs').innerHTML = [['all','Wszystkie'],['ks',tierShort('ks')],['wks',tierShort('wks')],['dks',tierShort('dks')]].map(function(t){
    return '<button type="button" class="dl-tab'+(listTab===t[0]?' on':'')+'" data-tab="'+t[0]+'">'+t[1]+'</button>';
  }).join('');

  var rows = all.filter(function(r){ return listTab==='all' || r.type===listTab; });
  rows.sort(function(a,b){
    var da = a.v && a.v.date, db = b.v && b.v.date;
    if(da && db) return da<db ? 1 : da>db ? -1 : 0;   // najnowsze na górze
    if(da) return -1;
    if(db) return 1;
    if(!!a.v !== !!b.v) return a.v ? -1 : 1;           // wejścia bez daty przed pustymi szczytami
    return a.p.name.localeCompare(b.p.name,'pl');
  });

  if(!rows.length){
    $('dl-rows').innerHTML = '<div class="dl-empty">'+(all.length
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
    if(v && v.companions.length) meta.push('👥 '+esc(v.companions.join(', ')));
    if(v && v.photos.length) meta.push('📷 '+v.photos.length);
    if(v && v.link) meta.push('🔗');
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

/* ── zaproszenia: udostępnianie wejścia uczestnikom ── */
function invitesCol(f){ return f.collection(f.db,'invites'); }
function peakById(id){
  var r = null;
  ['ks','wks','dks'].some(function(type){
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
  var h = '', many = list.length > 1;
  var AFTER = 'Po przyjęciu kopia wejścia (data, trasa, zdjęcia) trafi do Twojego pamiętnika, a szczyt zostanie oznaczony jako zdobyty.';
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
function closeInviteModal(){ var o = $('invite-overlay'); if(o) o.classList.add('hidden'); }
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
  if(!user.emailVerified){ box.innerHTML = ''; return; }
  if(!incoming.length){ box.innerHTML = ''; return; }
  box.innerHTML = '<div class="dl-inv-title">Zaproszenia do potwierdzenia</div>' + incoming.map(function(inv){
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
  else { can = true; hint = 'Uczestnik dostanie e-mail z zaproszeniem. Po przyjęciu zobaczy u siebie kopię tego wejścia (data, trasa, zdjęcia) i szczyt jako zdobyty.'; }
  $('dy-share-in').disabled = $('dy-share-go').disabled = !can;
  $('dy-share-hint').textContent = hint;
  $('dy-share-list').innerHTML = sent.map(function(inv){
    var st = statusOf(inv);
    return '<div class="dy-inv"><span class="dy-inv-mail">'+esc(inv.toEmail)+'</span>'+
      '<span class="dy-inv-st '+st+'">'+STATUS_PL[st]+'</span>'+
      (st==='pending' ? '<button type="button" class="dy-inv-x" data-cancel="'+esc(inv.id)+'">Anuluj</button>' : '')+'</div>';
  }).join('');
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
  visits: function(){ return visits; },
  inviteCount: function(){ return incoming.length; },
  serverOn: function(){ return INVITES_ON; }   // funkcje serwera wdrożone (także własny mail weryfikacyjny)
};
ensureDom();
// markery mogły powstać zanim diary.js się załadował — przebuduj popupy z przyciskiem
if(typeof placeMarkers==='function') placeMarkers();
})();
