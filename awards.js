/* Nagrody dla zdobywców poziomów i Krąg Sudetczyków (P60, zlecenie Promocji 2026-11-22: session-logs/promocja-nagrody-zdobywcow.md).
   1) Dyplom do druku / PDF (A4 poziomo, window.print), imię wpisywane przed wydrukiem — nie trafia do bazy.
   2) Obraz dyplomu do udostępnienia (canvas PNG 1200×630 i 1080×1080; Web Share API z plikiem albo pobranie).
   3) Krąg Sudetczyków: tytuł poziomu z numerem (Górołaz/Wędrowiec/Odkrywca, forma żeńska do wyboru — users.titleForm),
      finishers/{tier}_{uid}, numer nadaje serwer (functions/finishers.js, funkcja finishers).
   Tylko viasudetica.eu (index.html); wielkakoronasudetow.pl tego pliku nie ładuje.
   Korzysta z globalnych app.js: TIER_DATA, tierComplete, tierChain, STATE, langSpans, escHtml, plPlural, fmtDayIso. */
(function(){
'use strict';

var TIERS = ['ks', 'wks', 'dks'];
var NAME = {ks: ['Korona Sudetów', 'Crown of the Sudetes'], wks: ['Wielka Korona Sudetów', 'Great Crown of the Sudetes'],
            dks: ['Diamentowa Korona Sudetów', 'Diamond Crown of the Sudetes']};
var COUNTRY = {PL: ['Polska', 'Poland'], CZ: ['Czechy', 'Czechia'], DE: ['Niemcy', 'Germany']};
var C = {stone: '#2C2A25', bark: '#4A4035', moss: '#5C6B3A', lichen: '#8A9E5A', cream: '#F5F0E8', parchment: '#EDE6D6',
         fog: '#D4CCBA', rust: '#A0522D', gold: '#B8860B'};
var SITE = 'viasudetica.eu';

function en(){ var b = document.getElementById('btn-en'); return !!(b && b.classList.contains('active')); }
function L(pl, e){ return en() ? e : pl; }
function esc(s){ return escHtml(s == null ? '' : s); }
function fb(){ return window._fb; }
function user(){ var f = fb(); return f && f.auth && f.auth.currentUser; }
function peaks(t){ return TIER_DATA[t] || []; }
function day(iso){ return fmtDayIso(iso) || '—'; }

/* opis poziomu (dyplom, podpis przy udostępnianiu); liczba szczytów z listy */
function desc(t, isEn){
  var n = peaks(t).length;
  if(t === 'ks') return isEn ? 'the ' + n + ' most prominent and most isolated summits of the Sudetes in Poland, Czechia and Germany.'
                             : n + ' najwybitniejszych i najbardziej izolowanych szczytów Sudetów w Polsce, Czechach i Niemczech.';
  var few = plPlural(n, 'x', 'few', 'many') === 'few';
  var pl = (few ? 'kolejne ' : 'kolejnych ') + n + ' ' + plPlural(n, 'szczyt', 'szczyty', 'szczytów');
  if(t === 'wks') return isEn ? 'a further ' + n + ' summits selected by prominence and isolation.'
                              : pl + ' wybranych według wybitności i izolacji.';
  return isEn ? 'a further ' + n + ' summits, including the most prominent summits of ranges, foothills and basins.'
              : pl + ', w tym najwybitniejsze szczyty pasm, pogórzy i kotlin.';
}
/* zdanie na dyplomie (autor 2026-11-23): „Potwierdzamy zdobycie Korony Sudetów tj. …” */
var GEN = {ks: 'Korony Sudetów', wks: 'Wielkiej Korony Sudetów', dks: 'Diamentowej Korony Sudetów'};
function dipText(t, isEn){
  var n = peaks(t).length;
  if(isEn) return 'We confirm the completion of the ' + NAME[t][1] + ', i.e. ' + (t === 'ks'
    ? 'the ' + n + ' most prominent and most isolated summits of the whole Sudetes, within their borders on the Polish, Czech and German sides.'
    : desc(t, true));
  return 'Potwierdzamy zdobycie ' + GEN[t] + ' tj. ' + (t === 'ks'
    ? n + ' najwybitniejszych i najbardziej izolowanych szczytów całych Sudetów, w ich granicach po stronie polskiej, czeskiej i niemieckiej.'
    : t === 'wks' ? 'kolejnych ' + n + ' szczytów wybranych według wybitności i izolacji.'
    : 'kolejnych ' + n + ' szczytów, w tym najwybitniejszych szczytów pasm, pogórzy i kotlin.');
}
/* dyplom WKS/DKS (prośba autora 2026-11-22): wcześniej ukończone poziomy i łączna liczba szczytów */
function prior(t, isEn){
  var ch = tierChain(t);
  if(ch.length < 2) return '';
  var total = 0;
  ch.forEach(function(c){ total += peaks(c).length; });
  var prev = ch.slice(0, -1).map(function(c){ return NAME[c][isEn ? 1 : 0]; });
  if(isEn) return 'Previously completed: the ' + prev.join(' and the ') + ' — ' + total + ' summits in total.';
  return (prev.length > 1 ? 'Wcześniej ukończone: ' : 'Wcześniej ukończona: ') + prev.join(' i ') + ' — łącznie ' + total + ' ' +
    plPlural(total, 'szczyt', 'szczyty', 'szczytów') + '.';
}
function countries(t){
  var s = {};
  peaks(t).forEach(function(p){ String(p.kraj || '').split('/').forEach(function(c){ c = c.trim(); if(c) s[c] = 1; }); });
  return Object.keys(s);
}
function countryName(kraj, isEn){
  return String(kraj || '').split('/').map(function(c){ c = c.trim(); return COUNTRY[c] ? COUNTRY[c][isEn ? 1 : 0] : c; }).join(' / ');
}

/* pierwsze wejście z datą na każdy szczyt (dziennik): {peakId: {date, approx, n}} — n: liczba wejść na szczyt */
function firstDates(){
  var out = {}, cnt = {}, vs = window.Diary && Diary.visits ? Diary.visits() : {};
  Object.keys(vs).forEach(function(k){
    var v = vs[k];
    if(!v) return;
    cnt[v.peakId] = (cnt[v.peakId] || 0) + 1;
    if(!v.date) return;
    if(!out[v.peakId] || v.date < out[v.peakId].date) out[v.peakId] = {date: v.date, approx: !!v.dateApprox};
  });
  Object.keys(out).forEach(function(id){ out[id].n = cnt[id] || 1; });
  return out;
}
/* P54/P55: początek = najwcześniejsze pierwsze wejście na szczyt poziomu; ukończenie = najpóźniejsze z pierwszych
   wejść na szczyty tego poziomu i poprzednich */
function tierDates(t){
  var f = firstDates(), first = null, last = null, missing = [];
  peaks(t).forEach(function(p){
    var d = f[p.id];
    if(!d){ missing.push(p); return; }
    if(!first || d.date < first) first = d.date;
  });
  tierChain(t).forEach(function(c){ peaks(c).forEach(function(p){ var d = f[p.id]; if(d && (!last || d.date > last)) last = d.date; }); });
  return {first: first, last: last, missing: missing, dates: f};
}

/* ── Krąg Sudetczyków (P60, zmiany autora 2026-11-23): tytuły poziomów z numerem, forma żeńska do wyboru ── */
var CIRCLE = ['Krąg Sudetczyków', 'Sudetes Circle'];
var TITLE = {ks: [['Górołaz', 'Górołazka'], 'Hillwalker'], wks: [['Wędrowiec', 'Wędrowniczka'], 'Wanderer'],
             dks: [['Odkrywca', 'Odkrywczyni'], 'Explorer'], all: [['Sudetczyk', 'Sudetczanka'], 'Sudetes Local']};
function title(t, form, isEn){ var x = TITLE[t]; return isEn ? x[1] : x[0][form === 'f' ? 1 : 0]; }
/* dopełniacz do zdań „z tytułem Górołaza” (autor 2026-11-23) */
var TITLE_GEN = {ks: ['Górołaza', 'Górołazki'], wks: ['Wędrowca', 'Wędrowniczki'], dks: ['Odkrywcy', 'Odkrywczyni'], all: ['Sudetczyka', 'Sudetczanki']};
function titleGen(t, form){ return TITLE_GEN[t][form === 'f' ? 1 : 0]; }
/* wybór formy tytułu przed dołączeniem (bez niego nowa osoba nie miała gdzie wybrać formy żeńskiej) */
function formPick(t, form){
  return '<div class="aw-row aw-form-pick">' + langSpans('Tytuł:', 'Title:') + ' ' + ['m', 'f'].map(function(x){
    return '<button type="button" class="aw-btn ghost' + (form === x ? ' on' : '') + '" data-aw="form-' + x + '">' + esc(title(t, x, false)) + '</button>';
  }).join('') + '</div>';
}
/* „Wędrowiec nr 3” (+ „· Sudetczyk” przy Diamentowej: komplet 57 szczytów) */
function titleNo(t, no, form, isEn){
  return title(t, form, isEn) + (isEn ? ' no. ' : ' nr ') + no + (t === 'dks' ? ' · ' + title('all', form, isEn) : '');
}
var myForm = null;   // users/{uid}.titleForm: 'f' | 'm' (null = jeszcze nie wczytane)
function loadForm(){
  var u = user(), f = fb();
  if(!u || !f) return Promise.resolve('m');
  if(myForm) return Promise.resolve(myForm);
  return f.getDoc(f.doc(f.db, 'users', u.uid)).then(function(s){ myForm = s.exists() && s.data().titleForm === 'f' ? 'f' : 'm'; return myForm; })
    .catch(function(){ return 'm'; });
}
function saveForm(form){
  var u = user(), f = fb();
  myForm = form === 'f' ? 'f' : 'm';
  if(!u || !f) return;
  f.setDoc(f.doc(f.db, 'users', u.uid), {titleForm: myForm}, {merge: true}).then(function(){
    var member = TIERS.some(function(t){ return finCache[t] && !finCache[t].hidden; });
    if(member) return callFin('ks', 'form');
  }).catch(function(e){ console.warn('Zapis formy tytułu nieudany', e); });
}

/* ── własny wpis w Kręgu ── */
var finCache = {};   // tier -> {no, hidden, form} | null (brak wpisu)
function ownEntry(t){
  var u = user(), f = fb();
  if(!u || !f) return Promise.resolve(null);
  return f.getDoc(f.doc(f.db, 'finishers', t + '_' + u.uid)).then(function(s){
    finCache[t] = s.exists() ? {no: s.data().no, hidden: s.data().hidden === true, form: s.data().form} : null;
    return finCache[t];
  }).catch(function(){ return null; });
}
function callFin(t, action){
  var f = fb();
  if(!f || !f.callable) return Promise.reject(new Error('brak funkcji'));
  // _fb.callable(name) zwraca obietnicę funkcji (moduł functions ładowany przy pierwszym użyciu)
  return f.callable('finishers').then(function(fn){ return fn({tier: t, action: action}); }).then(function(r){ return r.data; });
}
function finErr(e){
  var m = e && e.message || '';
  if(/not-found|internal|unavailable|brak funkcji/i.test(String(e && e.code || '') + m))
    return langSpans('Krąg Sudetczyków nie jest jeszcze dostępny. Spróbuj później.', 'The Sudetes Circle is not available yet. Try again later.');
  return langSpans('Nie udało się zapisać. Spróbuj ponownie.', 'Could not save. Please try again.') + (m ? ' <span class="aw-muted">(' + esc(m) + ')</span>' : '');
}
function missingMsg(names){
  return langSpans('Aby dołączyć do Kręgu Sudetczyków, uzupełnij datę wejścia przy każdym szczycie tego poziomu. Brakuje dat: ',
                   'To join the Sudetes Circle, add the date of ascent for every summit of this tier. Missing dates: ') +
    names.map(esc).join(', ') + '.';
}

/* blok Kręgu w podsumowaniu poziomu i w nakładce Kręgu: stan, dołączenie, wypisanie */
function finBlock(box, t, opts){
  opts = opts || {};
  if(!box) return;
  if(!user()){ box.innerHTML = ''; return; }
  box.innerHTML = '<span class="aw-muted">' + langSpans('Sprawdzam Krąg Sudetczyków…', 'Checking the Sudetes Circle…') + '</span>';
  Promise.all([ownEntry(t), loadForm()]).then(function(r){
    var e = r[0], form = r[1], nm = NAME[t], tl = [title(t, form, false), title(t, form, true)];
    if(e && !e.hidden){
      box.innerHTML = dipButtons() + '<div class="aw-fin-ok">🎖 ' + langSpans('<b>' + esc(titleNo(t, e.no, form, false)) + '</b> · Krąg Sudetczyków',
                                                              '<b>' + esc(titleNo(t, e.no, form, true)) + '</b> · Sudetes Circle') + '</div>' +
        '<span class="lang-pl">' + formPick(t, form) + '</span>' +
        (opts.inList ? '<button type="button" class="aw-link" data-aw="leave">' + langSpans('Wypisz mnie z Kręgu', 'Leave the Circle') + '</button>'
                     : '<button type="button" class="aw-link" data-aw="list">' + langSpans('Zobacz Krąg Sudetczyków ›', 'See the Sudetes Circle ›') + '</button>');
    } else if(!tierComplete(t)){
      box.innerHTML = opts.inList ? '<span class="aw-muted">' + langSpans('Po ukończeniu poziomu ' + nm[0] + ' dołączysz tu z tytułem ' + titleGen(t, form) + '.',
                                                                          'Once you complete the ' + nm[1] + ' you can join here as ' + tl[1] + '.') + '</span>' : '';
    } else {
      var d = tierDates(t);
      if(d.missing.length){ box.innerHTML = '<div class="aw-fin-q">' + missingMsg(d.missing.map(function(p){ return p.name; })) + '</div>'; }
      else box.innerHTML = '<div class="aw-fin-q">' +
        langSpans('Dołączyć Cię do Kręgu Sudetczyków z tytułem ' + titleGen(t, form) + ' i numerem? Dyplom z numerem dostaniesz po dołączeniu. Krąg jest publiczny: pokazuje Twoją nazwę, tytuł z numerem i datę ukończenia.',
                  'Add you to the Sudetes Circle as ' + tl[1] + ' with a number? You get a numbered certificate once you join. The Circle is public: it shows your name, title with number and completion date.') +
        (e && e.hidden ? ' ' + langSpans('Twój numer ' + e.no + ' czeka.', 'Your number ' + e.no + ' is kept.') : '') + '</div>' +
        '<span class="lang-pl">' + formPick(t, form) + '</span>' +
        '<div class="aw-row"><button type="button" class="aw-btn" data-aw="join">' + langSpans('Dołącz do Kręgu', 'Join the Circle') + '</button>' +
        (opts.inList ? '' : '<button type="button" class="aw-btn ghost" data-aw="later">' + langSpans('Nie teraz', 'Not now') + '</button>') + '</div>';
    }
    box.onclick = function(ev){
      var b = ev.target.closest('[data-aw]');
      if(!b) return;
      var a = b.getAttribute('data-aw');
      if(a === 'later'){ box.innerHTML = '<span class="aw-muted">' + langSpans('Możesz dołączyć później: menu konta → Krąg Sudetczyków. Dyplom z numerem dostaniesz po dołączeniu.', 'You can join later: account menu → Sudetes Circle. You get a numbered certificate once you join.') + '</span>'; return; }
      if(a === 'form-m' || a === 'form-f'){ saveForm(a.slice(5)); finBlock(box, t, opts); return; }
      if(a === 'dip' || a === 'share'){ if(opts.inList) closeList(); diploma(t, a === 'share'); return; }
      if(a === 'list'){ if(window.closeUnlock) closeUnlock(null); openList(t); return; }
      if(a === 'leave' && !confirm(L('Wypisać Cię z Kręgu Sudetczyków? Numer zostanie zarezerwowany i wróci, jeśli dołączysz ponownie.',
                                     'Leave the Sudetes Circle? Your number is kept and comes back if you join again.'))) return;
      b.disabled = true;
      callFin(t, a).then(function(r){
        if(a === 'join' && !r.ok){
          box.innerHTML = '<div class="aw-fin-q">' + (r.reason === 'dates' ? missingMsg(r.missing || [])
            : r.reason === 'schema' ? langSpans('Odśwież stronę i spróbuj ponownie.', 'Reload the page and try again.')
            : langSpans('Ten poziom nie jest jeszcze ukończony na Twoim koncie.', 'This tier is not complete on your account yet.')) + '</div>';
          return;
        }
        finBlock(box, t, opts);
        if(opts.onChange) opts.onChange();
      }).catch(function(e){ b.disabled = false; box.insertAdjacentHTML('beforeend', '<div class="aw-err">' + finErr(e) + '</div>'); });
    };
  });
}

/* ── w podsumowaniu ukończonego poziomu (app.js doneSection) ── */
function doneBlock(t){
  if(TIERS.indexOf(t) === -1) return '';
  setTimeout(function(){ finBlock(document.querySelector('.aw-fin[data-fin="' + t + '"]'), t); }, 0);
  return '<div class="aw-done">' +
    '<div class="aw-fin" data-fin="' + t + '"></div>' +
    nudge(t) + '</div>';
}
/* przyciski dyplomu — tylko w bloku Kręgu członka (dyplom ma numer z Kręgu) */
function dipButtons(){
  return '<div class="aw-row"><button type="button" class="aw-btn" data-aw="dip">📜 ' + langSpans('Pobierz dyplom (PDF)', 'Download certificate (PDF)') + '</button>' +
    '<button type="button" class="aw-btn" data-aw="share">↗ ' + langSpans('Udostępnij dyplom', 'Share certificate') + '</button></div>';
}

/* zachęta przy dyplomie (prośba autora 2026-11-22): uzupełnić trasy, zdjęcia, towarzyszy (kompletny pamiętnik),
   zaprosić towarzyszy, polecić viasudetica.eu znajomym */
function nudge(t){
  var ids = {}, vs = window.Diary && Diary.visits ? Diary.visits() : {}, n = 0, noRoute = 0, noPhoto = 0, noComp = 0;
  peaks(t).forEach(function(p){ ids[p.id] = 1; });
  Object.keys(vs).forEach(function(k){
    var v = vs[k];
    if(!v || !ids[v.peakId]) return;
    n++;
    if(!v.track && !v.from && !v.to && !v.km) noRoute++;
    if(!(v.photos && v.photos.length)) noPhoto++;
    if(!(v.companions && v.companions.length)) noComp++;
  });
  var gaps = [];
  if(noRoute) gaps.push(langSpans('bez trasy: ' + noRoute, 'no route: ' + noRoute));
  if(noPhoto) gaps.push(langSpans('bez zdjęć: ' + noPhoto, 'no photos: ' + noPhoto));
  if(noComp) gaps.push(langSpans('bez towarzyszy: ' + noComp, 'no companions: ' + noComp));
  return '<div class="aw-nudge">' +
    '<p>' + langSpans('Uzupełnij w „Moje wejścia” trasy, zdjęcia i towarzyszy — z kompletnych wpisów przygotujemy pełny pamiętnik tej wyprawy.',
                      'Complete the routes, photos and companions in “My climbs” — complete entries let us make a full journal of this journey.') +
    (n && gaps.length ? ' <span class="aw-muted">(' + langSpans('wejścia ', 'climbs ') + gaps.join(', ') + ')</span>' : '') + '</p>' +
    '<p>' + langSpans('Zaproś towarzyszy do wspólnych wejść: dostaną kopię wpisu ze zdjęciami, a ich wejścia też się policzą.',
                      'Invite your companions to shared climbs: they get a copy of the entry with photos, and their climbs count too.') + '</p>' +
    '<div class="aw-row">' +
      '<button type="button" class="aw-btn ghost" onclick="if(window.closeUnlock)closeUnlock(null);window.Diary&&Diary.openList()">📖 ' + langSpans('Uzupełnij wejścia i zaproś towarzyszy', 'Complete climbs and invite companions') + '</button>' +
      '<button type="button" class="aw-btn ghost" onclick="Awards.recommend(this)">✉ ' + langSpans('Poleć viasudetica.eu znajomym', 'Recommend viasudetica.eu to friends') + '</button>' +
    '</div></div>';
}
function recommend(btn){
  var E = en();
  var text = E ? 'Crown of the Sudetes: the most prominent summits of the Sudetes in Poland, Czechia and Germany — map, progress and ascent diary.'
               : 'Korona Sudetów: najwybitniejsze szczyty Sudetów w Polsce, Czechach i Niemczech — mapa, postępy i dziennik wejść.';
  var url = 'https://' + SITE + '/';
  if(navigator.share){ navigator.share({title: 'ViaSudetica', text: text, url: url}).catch(function(){}); return; }
  var done = function(){ if(btn) btn.innerHTML = '✓ ' + langSpans('Link skopiowany — wklej go znajomym', 'Link copied — paste it to your friends'); };
  if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text + ' ' + url).then(done, function(){ prompt(E ? 'Copy the link:' : 'Skopiuj link:', url); });
  else prompt(E ? 'Copy the link:' : 'Skopiuj link:', url);
}

/* ── Krąg Sudetczyków (menu konta, przycisk w rankingu) ── */
var listTier = 'ks';
function ensureList(){
  var o = document.getElementById('fin-overlay');
  if(o) return o;
  o = document.createElement('div');
  o.id = 'fin-overlay'; o.className = 'hidden';
  o.innerHTML = '<div class="rank-box"><div class="rank-hdr"><h2>🎖 <span id="fin-title"></span></h2>' +
    '<button class="rank-close" type="button" onclick="Awards.closeList()">✕</button></div>' +
    '<div class="rank-body"><div class="rank-tabs">' +
    TIERS.map(function(t){ return '<button type="button" class="rank-tab' + (t === 'dks' ? ' dk' : '') + '" data-fintab="' + t + '"></button>'; }).join('') +
    '</div><p class="fin-lead" id="fin-lead"></p><div class="aw-fin fin-own" id="fin-own"></div>' +
    '<div id="fin-content"></div><p class="fin-foot" id="fin-foot"></p></div></div>';
  document.body.appendChild(o);
  o.addEventListener('click', function(e){
    if(e.target === o){ closeList(); return; }
    var b = e.target.closest('[data-fintab]');
    if(b) openList(b.getAttribute('data-fintab'));
  });
  document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && !o.classList.contains('hidden')) closeList(); });
  return o;
}
function openList(t){
  if(t) listTier = t;
  var o = ensureList(), nm = NAME[listTier];
  o.classList.remove('hidden');
  document.getElementById('fin-title').innerHTML = langSpans('Krąg Sudetczyków', 'Sudetes Circle');
  o.querySelectorAll('[data-fintab]').forEach(function(b){
    var x = b.getAttribute('data-fintab');
    b.innerHTML = langSpans(NAME[x][0].replace(' Sudetów', ''), NAME[x][1].replace(' of the Sudetes', ''));
    b.classList.toggle('on', x === listTier);
  });
  document.getElementById('fin-lead').innerHTML = langSpans(nm[0] + ': tytuł ' + TITLE[listTier][0][0] + ' / ' + TITLE[listTier][0][1] + '. Każdy numer nadajemy raz, w kolejności dołączenia do Kręgu.',
                                                            nm[1] + ': title ' + TITLE[listTier][1] + '. Each number is given once, in the order of joining the Circle.');
  document.getElementById('fin-foot').innerHTML = langSpans('Krąg opiera się na dziennikach wejść. Nie weryfikujemy wejść.',
                                                            'The Circle is based on the members\u2019 ascent diaries. Ascents are not verified.');
  finBlock(document.getElementById('fin-own'), listTier, {inList: true, onChange: loadList});
  loadList();
}
function closeList(){ var o = document.getElementById('fin-overlay'); if(o) o.classList.add('hidden'); }
function loadList(){
  var el = document.getElementById('fin-content'), f = fb(), t = listTier;
  if(!el) return;
  if(!f){ el.innerHTML = '<div class="rank-empty">' + langSpans('Ładowanie…', 'Loading…') + '</div>'; setTimeout(loadList, 400); return; }
  el.innerHTML = '<div class="rank-loading">' + langSpans('Ładowanie…', 'Loading…') + '</div>';
  f.getDocs(f.query(f.collection(f.db, 'finishers'), f.where('tier', '==', t), f.where('hidden', '==', false))).then(function(snap){
    if(t !== listTier) return;
    var rows = [];
    snap.forEach(function(d){ rows.push(d.data()); });
    rows.sort(function(a, b){ return (a.no || 0) - (b.no || 0); });
    if(!rows.length){ el.innerHTML = '<div class="rank-empty">' + langSpans('Na tym poziomie nie ma jeszcze nikogo.', 'Nobody on this tier yet.') + '</div>'; return; }
    el.innerHTML = '<table class="rank-table fin-table"><thead><tr><th>' + langSpans('Tytuł', 'Title') + '</th><th>' + langSpans('Osoba', 'Person') +
      '</th><th>' + langSpans('Data ukończenia', 'Completion date') + '</th></tr></thead><tbody>' +
      rows.map(function(r){
        var f = r.form === 'f' ? 'f' : 'm';
        return '<tr' + (t === 'dks' ? ' class="fin-star"' : '') + '><td class="fin-title">' + (t === 'dks' ? '★ ' : '') + langSpans(esc(titleNo(t, r.no, f, false)), esc(titleNo(t, r.no, f, true))) +
          '</td><td><div class="rank-name">' + esc(r.name) + '</div></td><td>' + esc(day(r.completed)) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }).catch(function(){
    el.innerHTML = '<div class="rank-empty">' + langSpans('Krąg Sudetczyków nie jest jeszcze dostępny.', 'The Sudetes Circle is not available yet.') + '</div>';
  });
}

/* ── dyplom ── */
var dip = {t: 'ks', no: null, isEn: false};
function ensureDip(){
  var o = document.getElementById('aw-dip');
  if(o) return o;
  o = document.createElement('div');
  o.id = 'aw-dip'; o.hidden = true;
  o.innerHTML = '<div class="aw-bar">' +
      '<div class="aw-tabs"><button type="button" data-dmode="print"></button><button type="button" data-dmode="share"></button></div>' +
      '<label class="aw-name"><span id="aw-name-l"></span><input id="aw-name" maxlength="60" autocomplete="name"></label>' +
      '<label class="aw-show" id="aw-show-w"><input type="checkbox" id="aw-show" checked> <span id="aw-show-l"></span></label>' +
      '<span class="aw-form" id="aw-form"></span>' +
      '<button type="button" class="aw-btn" id="aw-go"></button>' +
      '<button type="button" class="aw-x" id="aw-close" aria-label="Zamknij">✕</button>' +
    '</div>' +
    '<div class="aw-hint" id="aw-hint"></div>' +
    '<div class="aw-stage" id="aw-stage"><div class="aw-scale" id="aw-scale"><div class="aw-sheet" id="aw-sheet"></div></div></div>' +
    '<div class="aw-share" id="aw-share" hidden><div class="aw-fmt" id="aw-fmt"></div><canvas id="aw-canvas"></canvas></div>';
  document.body.appendChild(o);
  o.querySelector('#aw-close').onclick = closeDip;
  o.querySelector('#aw-name').oninput = function(){ renderSheet(); if(dip.mode === 'share') drawShare(); };
  o.querySelector('#aw-show').onchange = drawShare;
  o.querySelector('#aw-go').onclick = function(){ dip.mode === 'share' ? shareImg() : printDip(); };
  o.addEventListener('click', function(e){
    var b = e.target.closest('[data-dmode]'); if(b) setMode(b.getAttribute('data-dmode'));
    var f = e.target.closest('[data-fmt]'); if(f){ dip.fmt = f.getAttribute('data-fmt'); drawShare(); }
    var g = e.target.closest('[data-form]');
    if(g){ dip.form = g.getAttribute('data-form'); saveForm(dip.form); formBar(); renderSheet(); if(dip.mode === 'share') drawShare(); }
  });
  document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && !o.hidden) closeDip(); });
  window.addEventListener('resize', fitSheet);
  return o;
}
/* dyplom tylko dla członka Kręgu tego poziomu (autor 2026-11-23): numer dyplomu = numer w Kręgu.
   Okno otwiera się po odczycie wpisu i formy tytułu — bez chwilowego „Górołaz” u Górołazki. */
function diploma(t, share){
  if(!tierComplete(t)) return;
  Promise.all([ownEntry(t), loadForm()]).then(function(r){
    var e = r[0];
    if(!e || e.hidden){
      alert(L('Dyplom z numerem dostaniesz po dołączeniu do Kręgu Sudetczyków (menu konta → Krąg Sudetczyków).',
              'You get a numbered certificate once you join the Sudetes Circle (account menu → Sudetes Circle).'));
      return;
    }
    var o = ensureDip(), u = user();
    dip.t = t; dip.isEn = en(); dip.no = e.no; dip.form = r[1]; dip.fmt = dip.fmt || 'wide';
    var n = String(u && u.displayName || '').trim();
    document.getElementById('aw-name').value = n.indexOf('@') === -1 ? n : '';
    o.hidden = false;
    document.body.classList.add('aw-open');
    formBar();
    setMode(share ? 'share' : 'print');
  });
}
/* forma tytułu (Górołaz / Górołazka…) — tylko po polsku; w EN tytuł jest jeden */
function formBar(){
  var el = document.getElementById('aw-form');
  if(!el) return;
  if(dip.isEn){ el.innerHTML = ''; return; }
  el.innerHTML = 'Tytuł: ' + ['m', 'f'].map(function(f){
    return '<button type="button" data-form="' + f + '" class="' + (dip.form === f ? 'on' : '') + '">' + esc(title(dip.t, f, false)) + '</button>';
  }).join('');
}
function closeDip(){ var o = document.getElementById('aw-dip'); if(o) o.hidden = true; document.body.classList.remove('aw-open'); }
function setMode(m){
  var E = dip.isEn;
  dip.mode = m;
  document.querySelectorAll('#aw-dip [data-dmode]').forEach(function(b){
    var x = b.getAttribute('data-dmode');
    b.textContent = x === 'print' ? (E ? 'Certificate (PDF)' : 'Dyplom (PDF)') : (E ? 'Image to share' : 'Obraz do udostępnienia');
    b.classList.toggle('on', x === m);
  });
  document.getElementById('aw-name-l').textContent = E ? 'Name on the certificate' : 'Imię i nazwisko na dyplomie';
  document.getElementById('aw-show-l').textContent = E ? 'show my name' : 'pokaż moje imię';
  document.getElementById('aw-show-w').hidden = m !== 'share';
  var canShare = shareSupported();
  document.getElementById('aw-go').textContent = m === 'share' ? (canShare ? (E ? 'Share' : 'Udostępnij') : (E ? 'Download PNG' : 'Pobierz PNG'))
                                                                : (E ? 'Print / save as PDF' : 'Drukuj / zapisz PDF');
  document.getElementById('aw-hint').textContent = m === 'share'
    ? (canShare ? (E ? 'The image is created on your device; nothing is sent to our server.' : 'Obraz powstaje na Twoim urządzeniu, nic nie wysyłamy na nasz serwer.')
                : (E ? 'You can add the downloaded image to a Facebook post.' : 'Pobrany obraz możesz dodać do posta na Facebooku.'))
    : (E ? 'In the print window choose “Save as PDF” or a printer. The name is not saved anywhere.'
         : 'W oknie drukowania wybierz „Zapisz jako PDF” albo drukarkę. Wpisane imię nie jest nigdzie zapisywane.');
  document.getElementById('aw-stage').hidden = m !== 'print';
  document.getElementById('aw-share').hidden = m !== 'share';
  renderSheet();
  if(m === 'share') drawShare();
}
function nameVal(){ return String(document.getElementById('aw-name').value || '').trim(); }

/* sylweta łańcucha: szczyty poziomu z zachodu na wschód, wysokość z alt */
function ridge(t, w, h){
  var ps = peaks(t).slice().sort(function(a, b){ return a.lng - b.lng; });
  if(!ps.length) return '';
  var lo = Math.min.apply(null, ps.map(function(p){ return p.lng; })), hi = Math.max.apply(null, ps.map(function(p){ return p.lng; }));
  var amax = Math.max.apply(null, ps.map(function(p){ return p.alt; }));
  var pts = [[0, h * .75]];
  ps.forEach(function(p, i){
    var x = 30 + (hi > lo ? (p.lng - lo) / (hi - lo) : .5) * (w - 60);
    var y = h - (p.alt / amax) * h * .9;
    pts.push([x - 14, Math.min(h, y + h * .22)], [x, y]);
  });
  pts.push([w, h * .7], [w, h], [0, h]);
  return pts.map(function(p, i){ return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ') + 'Z';
}

/* znak na dyplomie i obrazie (Promocja 2026-11-23): ikona korony poziomu (symbole #ci-* z index.html),
   napis „Wielka Korona Sudetów”, pod nim adres. Marką jest nazwa, viasudetica.eu tylko adresem. */
var BRAND = 'Wielka Korona Sudetów';
function markHtml(t){
  return '<div class="aw-mark"><svg class="aw-mark-ic" viewBox="0 0 72 64" aria-hidden="true"><use href="#ci-' + t + '"/></svg>' +
         '<div><b>' + BRAND + '</b><small>' + SITE + '</small></div></div>';
}
/* numer dyplomu = numer w Kręgu Sudetczyków (nadany raz przez serwer), np. KS-001 */
function dipNo(t, no){ return t.toUpperCase() + '-' + ('00' + no).slice(-3); }
var crownCache = {};
function crownImg(t){
  if(crownCache[t]) return crownCache[t].complete && crownCache[t].naturalWidth ? crownCache[t] : null;
  var sym = document.getElementById('ci-' + t);
  if(!sym) return null;
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + sym.getAttribute('viewBox') + '" width="144" height="128" overflow="visible">' + sym.innerHTML + '</svg>';
  var im = new Image();
  im.onload = function(){ if(dip.mode === 'share' && dip.t === t) drawShare(); };
  im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  crownCache[t] = im;
  return null;
}
function drawMark(g, t, x, y, align){
  // y = linia bazowa napisu; litery adresu ok. 24 px — czytelne w miniaturze
  g.font = '600 24px Georgia, serif';
  var w1 = g.measureText(BRAND.toUpperCase()).width;
  g.font = 'bold 28px Georgia, serif';
  var w2 = g.measureText(SITE).width, tw = Math.max(w1, w2), iw = 64, ih = 57, gap = 14, all = iw + gap + tw;
  var x0 = align === 'right' ? x - all : align === 'center' ? x - all / 2 : x;
  var im = crownImg(t);
  if(im) g.drawImage(im, x0, y - 44, iw, ih);
  g.textAlign = 'left';
  g.fillStyle = C.moss; g.font = '600 24px Georgia, serif'; g.fillText(BRAND.toUpperCase(), x0 + iw + gap, y - 18);
  g.fillStyle = C.rust; g.font = 'bold 28px Georgia, serif'; g.fillText(SITE, x0 + iw + gap, y + 14);
}

function renderSheet(){
  if(!dip.no) return;   // bez numeru z Kręgu nie ma dyplomu
  var t = dip.t, E = dip.isEn, d = tierDates(t), nm = NAME[t], ps = peaks(t);
  var name = nameVal() || (E ? '[Name and surname]' : '[Imię i nazwisko]');
  var many = ps.length > 10;   // dwie kolumny, kody krajów (WKS, DKS); gęsty druk dopiero > 16 (DKS)
  // kolejność wg daty pierwszego wejścia (autor 2026-11-23); bez daty na końcu
  var sorted = ps.slice().sort(function(a, b){
    var x = d.dates[a.id], y = d.dates[b.id];
    return x && y ? (x.date < y.date ? -1 : x.date > y.date ? 1 : 0) : x ? -1 : y ? 1 : 0;
  });
  var multi = false;
  var rows = sorted.map(function(p){
    var x = d.dates[p.id], star = x && x.n > 1;
    if(star) multi = true;
    return '<tr><td>' + esc(E && p.en ? p.en : p.name) + (star ? '<sup class="aw-star">*</sup>' : '') + '</td><td class="n">' + esc(String(p.alt).replace('.', ',')) + ' m</td><td>' +
      esc(many ? String(p.kraj || '').replace(/\//g, ' / ') : countryName(p.kraj, E)) + '</td><td class="n">' + (x ? esc(day(x.date)) + (x.approx ? (E ? ' (approx.)' : ' (ok.)') : '') : '—') + '</td></tr>';
  });
  var head = '<thead><tr><th>' + (E ? 'Summit' : 'Szczyt') + '</th><th class="n">' + (E ? 'Elevation' : 'Wysokość') + '</th><th>' +
             (E ? 'Country' : 'Kraj') + '</th><th class="n">' + (E ? 'Date of first ascent' : 'Data pierwszego wejścia') + '</th></tr></thead>';
  var cols = many ? 2 : 1, per = Math.ceil(rows.length / cols), tables = '';
  for(var i = 0; i < cols; i++) tables += '<table class="aw-tbl">' + head + '<tbody>' + rows.slice(i * per, (i + 1) * per).join('') + '</tbody></table>';
  var period = d.first && d.last
    ? (E ? 'Time taken: from ' + day(d.first) + ' to ' + day(d.last) : 'Czas zdobywania: od ' + day(d.first) + ' do ' + day(d.last))
    : '';
  var sheet = document.getElementById('aw-sheet');
  sheet.className = 'aw-sheet t-' + t + (many ? ' cols2' : '') + (rows.length > 16 ? ' many' : '');
  if(!document.getElementById('aw-in')) sheet.innerHTML = '<div class="aw-bgsvg" id="aw-bgsvg"></div><div class="aw-in" id="aw-in"></div>';
  bgOutline(t);
  document.getElementById('aw-in').innerHTML =
      markHtml(t) +
      (dip.no ? '<div class="aw-serial">' + (E ? 'No. ' : 'Nr ') + '<b>' + dipNo(t, dip.no) + '</b></div>' : '') +
      '<div class="aw-kicker">' + (E ? 'Certificate' : 'Dyplom') + '</div>' +
      '<h1 class="aw-title">' + esc(nm[E ? 1 : 0]) + '</h1>' +
      '<div class="aw-who">' + esc(name) + '</div>' +
      '<p class="aw-text">' + esc(dipText(t, E)) + (prior(t, E) ? '<br>' + esc(prior(t, E)) : '') + '</p>' +
      '<div class="aw-tables">' + tables + '</div>' +
      '<div class="aw-meta">' + esc(period) + '<span class="aw-no">' + (dip.no ? esc(titleNo(t, dip.no, dip.form, E)) + ' · ' + CIRCLE[E ? 1 : 0] : esc(title(t, dip.form, E) + (t === 'dks' ? ' · ' + title('all', dip.form, E) : ''))) + '</span>' + '</div>' +
      '<div class="aw-foot"><small>' +
        (multi ? (E ? '* climbed more than once · ' : '* zdobyty wielokrotnie · ') : '') +
        (E ? 'Certificate based on entries in the ascent diary · issued ' : 'Dyplom na podstawie wpisów w dzienniku wejść · wystawiono ') +
        esc(day(new Date().toISOString().slice(0, 10))) + '</small></div>';
  fitSheet();
}
/* tło dyplomu (autor 2026-11-23): obrys Sudetów z grup pasm i zdobyte szczyty, jak na obrazie do udostępnienia
   (pierwsza próba z mapą standardową była zbyt szczegółowa). SVG, bez kafelków — od razu gotowe do druku. */
function outlineRings(){
  var feats = (typeof GRUPY_GEOJSON !== 'undefined' && GRUPY_GEOJSON && GRUPY_GEOJSON.features) || [], rings = [];
  feats.forEach(function(f){
    var gm = f.geometry; if(!gm) return;
    var polys = gm.type === 'Polygon' ? [gm.coordinates] : gm.type === 'MultiPolygon' ? gm.coordinates : [];
    polys.forEach(function(q){ if(q[0]) rings.push(q[0]); });
  });
  return rings;
}
function bgOutline(t){
  var el = document.getElementById('aw-bgsvg');
  if(!el || el.getAttribute('data-t') === t) return;
  var W = 640, H = 330, rings = outlineRings(), lo = [180, 90], hi = [-180, -90];
  rings.forEach(function(r){ r.forEach(function(c){ lo = [Math.min(lo[0], c[0]), Math.min(lo[1], c[1])]; hi = [Math.max(hi[0], c[0]), Math.max(hi[1], c[1])]; }); });
  if(!rings.length) return;
  var kx = Math.cos((lo[1] + hi[1]) / 2 * Math.PI / 180), sw = (hi[0] - lo[0]) * kx, sh = hi[1] - lo[1];
  var s = Math.min((W - 20) / sw, (H - 20) / sh), ox = (W - sw * s) / 2, oy = (H - sh * s) / 2;
  function P(lng, lat){ return [(ox + (lng - lo[0]) * kx * s).toFixed(1), (oy + (hi[1] - lat) * s).toFixed(1)]; }
  var d = rings.map(function(r){ return 'M' + r.map(function(c){ return P(c[0], c[1]).join(' '); }).join('L') + 'Z'; }).join('');
  var dots = '';
  tierChain(t).forEach(function(c){
    var own = c === t;
    peaks(c).forEach(function(p){
      var q = P(p.lng, p.lat);
      dots += '<circle cx="' + q[0] + '" cy="' + q[1] + '" r="' + (own ? 5.5 : 3) + '" class="' + (own ? 'own' : 'prev') + '"/>';
    });
  });
  // obrys całości: grube linie grup pod wypełnieniem — granice wewnętrzne znikają
  el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true"><path class="edge" d="' + d + '"/><path class="fill" d="' + d + '"/>' + dots + '</svg>';
  el.setAttribute('data-t', t);
}
/* arkusz ma stały rozmiar A4 przy 96 dpi (1123×794 px); na ekranie skalowany do szerokości okna */
function fitSheet(){
  var st = document.getElementById('aw-stage'), sc = document.getElementById('aw-scale');
  if(!st || st.hidden) return;
  var k = Math.min(1, (st.clientWidth - 24) / 1123);
  sc.style.transform = 'scale(' + k + ')';
  sc.style.height = (794 * k) + 'px'; sc.style.width = (1123 * k) + 'px';
}
function printDip(){
  var s = document.createElement('style');
  s.id = 'aw-page';
  s.textContent = '@page{size:A4 landscape;margin:0}';
  document.head.appendChild(s);
  document.body.classList.add('aw-printing');
  var done = function(){ document.body.classList.remove('aw-printing'); var x = document.getElementById('aw-page'); if(x) x.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(function(){ window.print(); setTimeout(done, 1000); }, 50);
}

/* ── obraz do udostępnienia (canvas) ── */
var SIZES = {wide: [1200, 630], square: [1080, 1080]};
function drawOutline(g, x, y, w, h, t){
  var feats = (typeof GRUPY_GEOJSON !== 'undefined' && GRUPY_GEOJSON && GRUPY_GEOJSON.features) || [];
  var rings = [];
  feats.forEach(function(f){
    var gm = f.geometry; if(!gm) return;
    var polys = gm.type === 'Polygon' ? [gm.coordinates] : gm.type === 'MultiPolygon' ? gm.coordinates : [];
    polys.forEach(function(p){ if(p[0]) rings.push(p[0]); });
  });
  var pts = peaks(t);
  var lo = [180, 90], hi = [-180, -90];
  rings.forEach(function(r){ r.forEach(function(c){ lo = [Math.min(lo[0], c[0]), Math.min(lo[1], c[1])]; hi = [Math.max(hi[0], c[0]), Math.max(hi[1], c[1])]; }); });
  pts.forEach(function(p){ lo = [Math.min(lo[0], p.lng), Math.min(lo[1], p.lat)]; hi = [Math.max(hi[0], p.lng), Math.max(hi[1], p.lat)]; });
  var kx = Math.cos((lo[1] + hi[1]) / 2 * Math.PI / 180), sw = (hi[0] - lo[0]) * kx, sh = hi[1] - lo[1];
  var s = Math.min(w / sw, h / sh), ox = x + (w - sw * s) / 2, oy = y + (h - sh * s) / 2;
  function P(lng, lat){ return [ox + (lng - lo[0]) * kx * s, oy + (hi[1] - lat) * s]; }
  function path(r){ g.beginPath(); r.forEach(function(c, i){ var q = P(c[0], c[1]); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.closePath(); }
  // obrys całości: grube linie wszystkich grup, potem wypełnienie przykrywa granice wewnętrzne
  g.lineJoin = 'round'; g.strokeStyle = C.moss; g.lineWidth = 5;
  rings.forEach(function(r){ path(r); g.stroke(); });
  g.fillStyle = C.parchment;
  rings.forEach(function(r){ path(r); g.fill(); });
  pts.forEach(function(p){
    var q = P(p.lng, p.lat);
    g.beginPath(); g.arc(q[0], q[1], t === 'dks' ? 6 : 9, 0, 2 * Math.PI);
    g.fillStyle = C.rust; g.fill(); g.lineWidth = 2.5; g.strokeStyle = C.cream; g.stroke();
  });
}
function fitText(g, s, max, size, font){
  var z = size;
  do { g.font = font.replace('{}', z + 'px'); z -= 2; } while(g.measureText(s).width > max && z > 12);
}
function drawShare(){
  var cv = document.getElementById('aw-canvas');
  if(!cv || dip.mode !== 'share' || !dip.no) return;
  var E = dip.isEn, t = dip.t, sz = SIZES[dip.fmt] || SIZES.wide, W = sz[0], H = sz[1], g = cv.getContext('2d');
  cv.width = W; cv.height = H;
  document.getElementById('aw-fmt').innerHTML = ['wide', 'square'].map(function(f){
    return '<button type="button" data-fmt="' + f + '" class="' + (f === dip.fmt ? 'on' : '') + '">' +
      (f === 'wide' ? (E ? 'Landscape 1200×630' : 'Poziomy 1200×630') : (E ? 'Square 1080×1080' : 'Kwadrat 1080×1080')) + '</button>';
  }).join('');
  var d = tierDates(t), n = peaks(t).length, nc = countries(t).length, year = (d.last || '').slice(0, 4);
  g.fillStyle = C.cream; g.fillRect(0, 0, W, H);
  g.strokeStyle = C.bark; g.lineWidth = 6; g.strokeRect(24, 24, W - 48, H - 48);
  g.strokeStyle = C.fog; g.lineWidth = 2; g.strokeRect(38, 38, W - 76, H - 76);
  var wide = dip.fmt === 'wide', tx = wide ? 80 : 90, tw = wide ? 600 : W - 180;
  var top = wide ? 110 : 620;
  drawOutline(g, wide ? 690 : 140, wide ? 70 : 160, wide ? 440 : 800, wide ? 390 : 410, t);
  if(wide) drawMark(g, t, W - 80, H - 92, 'right'); else drawMark(g, t, W / 2, 118, 'center');
  g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  var lines = [];
  g.fillStyle = C.moss; g.font = '600 22px Georgia, serif';
  g.fillText((E ? 'CERTIFICATE' : 'DYPLOM') + (dip.no ? (E ? ' NO. ' : ' NR ') + dipNo(t, dip.no) : ''), tx, top);
  var nm = NAME[t][E ? 1 : 0], ttl = E ? nm + ' completed' : nm + ' ukończona';
  g.fillStyle = C.stone;
  // tytuł w dwóch wierszach: nazwa poziomu + „ukończona”
  fitText(g, nm, tw, wide ? 58 : 64, 'bold {} Georgia, serif');
  g.fillText(nm, tx, top + 70);
  g.fillStyle = C.rust; fitText(g, E ? 'completed' : 'ukończona', tw, wide ? 50 : 56, 'italic bold {} Georgia, serif');
  g.fillText(E ? 'completed' : 'ukończona', tx, top + 132);
  var y = top + 200, show = document.getElementById('aw-show').checked, who = nameVal();
  if(show && who){ g.fillStyle = C.stone; fitText(g, who, tw, 40, '{} Georgia, serif'); g.fillText(who, tx, y); y += 58; }
  g.fillStyle = C.bark; g.font = '30px Georgia, serif';
  var stat = E ? n + ' summits · ' + nc + ' countr' + (nc === 1 ? 'y' : 'ies') + (year ? ' · ' + year : '')
               : n + ' ' + plPlural(n, 'szczyt', 'szczyty', 'szczytów') + ' · ' + nc + ' ' + plPlural(nc, 'kraj', 'kraje', 'krajów') + (year ? ' · ' + year : '');
  g.fillText(stat, tx, y); y += 46;
  if(d.first && d.last && d.first !== d.last){
    g.font = '24px Georgia, serif'; g.fillStyle = C.bark;
    g.fillText(E ? 'from ' + day(d.first) + ' to ' + day(d.last) : 'od ' + day(d.first) + ' do ' + day(d.last), tx, y); y += 42;
  }
  if(!dip.no){ g.fillStyle = C.moss; g.font = 'bold 28px Georgia, serif'; g.fillText(title(t, dip.form, E) + (t === 'dks' ? ' · ' + title('all', dip.form, E) : ''), tx, y); y += 44; }
  if(dip.no){
    g.fillStyle = C.moss; fitText(g, titleNo(t, dip.no, dip.form, E), tw, 28, 'bold {} Georgia, serif'); g.fillText(titleNo(t, dip.no, dip.form, E), tx, y); y += 34;
    g.font = '22px Georgia, serif'; g.fillText(CIRCLE[E ? 1 : 0], tx, y); y += 40;
  }
  g.textAlign = 'left';
  dip.title = ttl;
}
function shareSupported(){
  try { return !!(navigator.canShare && navigator.share && navigator.canShare({files: [new File([''], 'x.png', {type: 'image/png'})]})); }
  catch(e){ return false; }
}
function shareImg(){
  var cv = document.getElementById('aw-canvas'), E = dip.isEn, t = dip.t;
  var fname = 'dyplom-' + t + '-' + (dip.fmt === 'square' ? '1080x1080' : '1200x630') + '.png';
  var text = (E ? NAME[t][1] + ' completed: ' + desc(t, true) : 'Ukończona ' + NAME[t][0] + ': ' + desc(t, false)) + ' https://' + SITE;
  cv.toBlob(function(blob){
    if(!blob) return;
    var file = new File([blob], fname, {type: 'image/png'});
    if(shareSupported()){
      navigator.share({files: [file], text: text, title: dip.title}).catch(function(){});
      return;
    }
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = fname;
    document.body.appendChild(a); a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }, 'image/png');
}

/* przycisk Kręgu w nakładce rankingu */
function addRankLink(){
  var tabs = document.querySelector('#ranking-overlay .rank-tabs');
  if(!tabs || tabs.querySelector('.fin-link')) return;
  var b = document.createElement('button');
  b.type = 'button'; b.className = 'rank-tab fin-link';
  b.innerHTML = '🎖 ' + langSpans('Krąg Sudetczyków', 'Sudetes Circle');
  b.onclick = function(){ if(window.closeRanking) closeRanking(); openList(); };
  tabs.appendChild(b);
}
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addRankLink); else addRankLink();

window.Awards = {doneBlock: doneBlock, diploma: diploma, openList: openList, closeList: closeList, recommend: recommend};
})();
