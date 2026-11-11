/* ═══════════════════════════════════════════════════════════
   admin.js — panel administracyjny: etap A (P41) odczyt, etap B (P42) poprawki na karcie użytkownika.
   Dane wyłącznie przez functions adminApi (Admin SDK); przeglądarka nie czyta cudzych dokumentów.
   Widoki (adres po #): lista użytkowników · #u/<uid> karta · #zgloszenia · #dziennik
   Nazwy szczytów z ../peaks-data.js (KS/WKS/DKS); ks/wks/dks w users/{uid} to numery pozycji na tych listach.
   ═══════════════════════════════════════════════════════════ */
(function(){
'use strict';

var overview = null;          // {rows, stats, orphans} z ostatniego pobrania
var card = null;              // {uid, d}: otwarta karta użytkownika (etap B: poprawki)
var sortKey = 'created', sortDir = -1, filterKey = 'all', search = '';
var TIERS = [['ks','Korona',KS],['wks','Wielka',WKS],['dks','Diamentowa',DKS]];
var PEAK = {};
TIERS.forEach(function(t){ t[2].forEach(function(p){ PEAK[p.id] = p.name; }); });

/* ── pomocnicze ── */
function $(id){ return document.getElementById(id); }
function esc(s){
  return String(s==null?'':s).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}
function pad(n){ return n<10 ? '0'+n : ''+n; }
function fmtDay(ms){ if(!ms) return '—'; var d = new Date(ms); return pad(d.getDate())+'.'+pad(d.getMonth()+1)+'.'+d.getFullYear(); }
function fmtTime(ms){ if(!ms) return '—'; var d = new Date(ms); return fmtDay(ms)+' '+pad(d.getHours())+':'+pad(d.getMinutes()); }
function fmtIso(s){ var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s||''); return m ? m[3]+'.'+m[2]+'.'+m[1] : '—'; }
function yesNo(b, yes, no){ return '<span class="ad-pill '+(b?'on':'off')+'">'+(b?yes:no)+'</span>'; }
function main(html){ $('ad-main').innerHTML = html; }

function whenFb(cb){
  if(window._fb && window._fb.auth) return cb(window._fb);
  setTimeout(function(){ whenFb(cb); }, 50);
}
/* wywołanie adminApi; błąd serwera po polsku do pokazania */
function api(action, data){
  return window._fb.callable('adminApi').then(function(fn){
    return fn(Object.assign({action:action}, data||{}));
  }).then(function(r){ return r.data; });
}
function errBox(e){
  var msg = e && e.message && e.message!=='internal' ? e.message : 'Nie udało się pobrać danych.';
  var relog = /ponownie/.test(msg);
  return '<div class="ad-err">'+esc(msg)+(relog ? ' <button type="button" class="ad-btn" data-relog="1">Zaloguj ponownie</button>' : '')+'</div>';
}

/* ── logowanie ── */
function renderLogin(msg){
  $('ad-who').innerHTML = '';
  main('<form class="ad-login" id="ad-login">'+
    '<h2>Zaloguj się</h2>'+
    '<label>E-mail<input type="email" id="ad-email" autocomplete="username" required></label>'+
    '<label>Hasło<input type="password" id="ad-pass" autocomplete="current-password" required></label>'+
    '<button type="submit" class="ad-btn primary">Zaloguj</button>'+
    '<p class="ad-err-line" id="ad-login-err">'+esc(msg||'')+'</p>'+
  '</form>');
  $('ad-login').addEventListener('submit', function(ev){
    ev.preventDefault();
    var fb = window._fb;
    $('ad-login-err').textContent = '';
    fb.signInWithEmailAndPassword(fb.auth, $('ad-email').value.trim(), $('ad-pass').value).catch(function(){
      $('ad-login-err').textContent = 'Nieprawidłowy e-mail lub hasło.';
    });
  });
}
function renderWho(user){
  $('ad-who').innerHTML = esc(user.email)+' <button type="button" class="ad-btn" data-logout="1">Wyloguj</button>';
}

/* ── nawigacja ── */
function nav(active){
  var t = [['','Użytkownicy'],['#zgloszenia','Zgłoszenia'],['#dziennik','Dziennik zmian']];
  return '<nav class="ad-nav">'+t.map(function(x){
    return '<a href="'+(x[0]||'#')+'" class="'+(active===x[0]?'on':'')+'">'+x[1]+'</a>';
  }).join('')+'</nav>';
}
function route(){
  var h = location.hash;
  if(/^#u\//.test(h)) return showUser(decodeURIComponent(h.slice(3)));
  if(h==='#zgloszenia') return showFeedback();
  if(h==='#dziennik') return showLog();
  showUsers(false);
}

/* ── lista użytkowników ── */
var COLS = [
  ['name','Nazwa'],['email','E-mail'],['created','Rejestracja'],['lastActive','Ostatnio'],['verified','Potw.'],
  ['ks','KS'],['wks','WKS'],['dks','DKS'],['visits','Wejścia'],['ranking','Ranking'],['news','Wiadomości']
];
var FILTERS = [['all','Wszyscy'],['unverified','Niepotwierdzony adres'],['hidden','Ukryci w rankingu'],
  ['newsOff','Bez wiadomości'],['diary','Chcą pamiętnik'],['noPeaks','Bez zdobytych szczytów'],['noDoc','Bez danych postępu'],['disabled','Zablokowani']];
function passes(r){
  if(filterKey==='unverified' && r.verified) return false;
  if(filterKey==='hidden' && r.ranking) return false;
  if(filterKey==='newsOff' && r.news) return false;
  if(filterKey==='noPeaks' && r.ks+r.wks+r.dks>0) return false;
  if(filterKey==='noDoc' && r.hasDoc) return false;
  if(filterKey==='disabled' && !r.disabled) return false;
  if(filterKey==='diary' && !(r.diaryWanted||[]).length) return false;
  if(search){
    var q = search.toLowerCase();
    if(String(r.name||'').toLowerCase().indexOf(q)===-1 && String(r.email||'').toLowerCase().indexOf(q)===-1 && r.uid.toLowerCase()!==q) return false;
  }
  return true;
}
function sorted(rows){
  return rows.slice().sort(function(a, b){
    var x = a[sortKey], y = b[sortKey];
    if(typeof x==='string' || typeof y==='string') return sortDir * String(x||'').localeCompare(String(y||''), 'pl');
    return sortDir * ((x===true?1:x===false?0:x||0) - (y===true?1:y===false?0:y||0));
  });
}
function showUsers(refresh){
  if(overview && !refresh) return drawUsers();
  main(nav('')+'<p class="ad-muted">Pobieram listę użytkowników…</p>');
  api('overview').then(function(d){ overview = fixOld(d); drawUsers(); }).catch(function(e){ main(nav('')+errBox(e)); });
}
/* P47: konta w starym schemacie (r.old z serwera) — liczby po przeliczeniu kopii tą samą migracją co strona;
   r.oldSchema = gwiazdka w tabeli. Bez r.old (functions sprzed P47) liczby jak z serwera. */
function fixOld(d){
  if(typeof migrateAll !== 'function') return d;
  (d.rows||[]).forEach(function(r){
    if(!r.old) return;
    var c = {ks: r.old.ks.slice(), wks: r.old.wks.slice(), dks: r.old.dks.slice()};
    (r.old.flags||[]).forEach(function(f){ c[f] = true; });
    try { migrateAll(c); } catch(e){ return; }
    r.ks = c.ks.length; r.wks = c.wks.length; r.dks = c.dks.length; r.oldSchema = true;
  });
  if(d.stats) d.stats.withPeaks = (d.rows||[]).filter(function(r){ return r.ks + r.wks + r.dks > 0; }).length;
  return d;
}
function drawUsers(){
  var s = overview.stats, inv = s.invites || {};
  var tiles = [
    [s.users,'kont'],[s.verified,'z potwierdzonym adresem'],[s.last7,'nowych w 7 dni'],[s.last30,'nowych w 30 dni'],
    [s.withPeaks,'ze zdobytym szczytem'],[s.visits,'wejść w pamiętnikach'],[inv.accepted||0,'przyjętych zaproszeń'],
    [s.hidden,'ukrytych w rankingu'],[s.newsOff,'bez wiadomości'],[s.diaryWanted||0,'chce pamiętnik']
  ];
  main(nav('')+
    '<div class="ad-tiles">'+tiles.map(function(t){ return '<div class="ad-tile"><b>'+t[0]+'</b><span>'+t[1]+'</span></div>'; }).join('')+'</div>'+
    (overview.orphans ? '<p class="ad-muted">Dokumenty postępu bez konta w Authentication (konto usunięte): '+overview.orphans+'.</p>' : '')+
    '<div class="ad-bar">'+
      '<input type="search" id="ad-search" placeholder="Szukaj: nazwa, e-mail albo uid" value="'+esc(search)+'">'+
      '<select id="ad-filter">'+FILTERS.map(function(f){ return '<option value="'+f[0]+'"'+(f[0]===filterKey?' selected':'')+'>'+f[1]+'</option>'; }).join('')+'</select>'+
      '<button type="button" class="ad-btn" data-csv="1">Eksport CSV</button>'+
      '<button type="button" class="ad-btn" data-refresh="1">Odśwież</button>'+
    '</div>'+
    '<div id="ad-table"></div>');
  drawTable();
}
function drawTable(){
  var rows = sorted(overview.rows.filter(passes));
  $('ad-table').innerHTML = '<p class="ad-muted">Pokazano '+rows.length+' z '+overview.rows.length+'.'+
      (rows.some(function(r){ return r.oldSchema; }) ? ' * — stary schemat danych: liczby szczytów po przeliczeniu (podgląd).' : '')+'</p>'+
    '<div class="ad-scroll"><table class="ad-table"><thead><tr>'+COLS.map(function(c){
      return '<th data-sort="'+c[0]+'" class="'+(sortKey===c[0]?'on':'')+'">'+c[1]+(sortKey===c[0]?(sortDir>0?' ▲':' ▼'):'')+'</th>';
    }).join('')+'</tr></thead><tbody>'+rows.map(function(r){
      return '<tr data-uid="'+esc(r.uid)+'" tabindex="0" class="'+(r.disabled?'dis':'')+'">'+
        '<td>'+esc(r.name||'—')+'</td><td>'+esc(r.email||'—')+'</td>'+
        '<td>'+fmtDay(r.created)+'</td><td>'+fmtDay(r.lastActive)+'</td>'+
        '<td>'+(r.verified?'✓':'<span class="ad-warn">✗</span>')+'</td>'+
        '<td class="n">'+r.ks+'/'+KS.length+'</td><td class="n">'+r.wks+'/'+WKS.length+'</td><td class="n">'+r.dks+'/'+DKS.length+
          (r.oldSchema ? ' <span class="ad-muted" title="Stary schemat danych: liczby po przeliczeniu (podgląd); baza zmieni się, gdy użytkownik otworzy stronę">*</span>' : '')+'</td>'+
        '<td class="n">'+r.visits+'</td><td>'+(r.ranking?'widoczny':'<span class="ad-muted">ukryty</span>')+'</td>'+
        '<td>'+(r.news?'tak':'<span class="ad-muted">nie</span>')+'</td></tr>';
    }).join('')+'</tbody></table></div>';
}
function csv(){
  var rows = sorted(overview.rows.filter(passes));
  var head = ['uid','nazwa','email','rejestracja','ostatnio','potwierdzony','KS','WKS','DKS','wejscia','ranking','wiadomosci','zablokowany'];
  var cell = function(v){ v = v==null ? '' : String(v); return /[";\n]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v; };
  var lines = [head.join(';')].concat(rows.map(function(r){
    return [r.uid, r.name, r.email, fmtDay(r.created), fmtDay(r.lastActive), r.verified?'tak':'nie', r.ks, r.wks, r.dks,
      r.visits, r.ranking?'widoczny':'ukryty', r.news?'tak':'nie', r.disabled?'tak':'nie'].map(cell).join(';');
  }));
  var blob = new Blob(['﻿'+lines.join('\r\n')], {type:'text/csv;charset=utf-8'});
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'uzytkownicy-'+new Date().toISOString().slice(0,10)+'.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){ URL.revokeObjectURL(a.href); }, 1000);
}

/* ── karta użytkownika ── */
function showUser(uid, keep){
  if(!keep) main(nav('#u')+'<p><a href="#">← Lista użytkowników</a></p><p class="ad-muted">Pobieram dane konta…</p>');
  return api('user', {uid:uid}).then(function(d){ card = {uid:uid, d:d}; drawUser(uid, d); }).catch(function(e){
    main(nav('#u')+'<p><a href="#">← Lista użytkowników</a></p>'+errBox(e));
  });
}
function section(title, body){ return '<section class="ad-sec"><h3>'+title+'</h3>'+body+'</section>'; }
function kv(rows){
  return '<dl class="ad-kv">'+rows.map(function(r){ return '<dt>'+r[0]+'</dt><dd>'+r[1]+'</dd>'; }).join('')+'</dl>';
}
function statusPl(s){
  return {pending:'oczekuje', accepting:'w trakcie przyjmowania', accepted:'przyjęte', declined:'odrzucone',
    cancelled:'anulowane', expired:'wygasło'}[s] || esc(s||'—');
}
function drawUser(uid, d){
  var a = d.account, doc = d.doc;
  var head = a ? esc(a.name || a.email || uid) : 'Konto nie istnieje w Authentication';
  var out = nav('#u')+'<p><a href="#">← Lista użytkowników</a></p><h2 class="ad-h2">'+head+'</h2>'+
    '<div id="ad-flash" class="ad-flash" hidden></div>';
  var me = window._fb.auth.currentUser && window._fb.auth.currentUser.uid;
  var btn = function(act, label, extra, cls){ return '<button type="button" class="ad-btn '+(cls||'')+'" data-act="'+act+'"'+(extra||'')+'>'+label+'</button>'; };

  out += section('Konto', a ? kv([
    ['uid', '<code>'+esc(a.uid)+'</code>'],
    ['E-mail', esc(a.email||'—')+' '+yesNo(a.verified,'potwierdzony','niepotwierdzony')],
    ['Nazwa (konto)', esc(a.name||'—')],
    ['Logowanie', esc((a.providers||[]).join(', ')||'—')],
    ['Rejestracja', fmtTime(a.created)],
    ['Ostatnie logowanie', fmtTime(a.lastSignIn)],
    ['Ostatnia aktywność', fmtTime(a.lastActive)],
    ['Stan', a.disabled ? '<span class="ad-warn">zablokowane</span>' : 'aktywne']
  ])+'<div class="ad-actions">'+
    (a.verified ? '' : btn('sendVerify','Wyślij ponownie mail potwierdzający')+(a.uid!==me ? btn('setVerified','Oznacz adres jako potwierdzony') : ''))+
    btn('sendReset','Wyślij link do zmiany hasła')+
    (a.uid!==me ? btn('setDisabled', a.disabled ? 'Odblokuj konto' : 'Zablokuj konto', ' data-on="'+(a.disabled?'0':'1')+'"')+
      btn('deleteAccount','Usuń konto…','','danger') : '')+
  '</div>' : '<p class="ad-muted">Brak konta (usunięte?). Poniżej dane, które zostały w bazie.</p>');

  out += section('Ustawienia', kv([
    ['Ranking', (doc ? yesNo(doc.ranking,'widoczny','ukryty') : yesNo(true,'widoczny',''))+' '+
      btn('setRanking', doc && !doc.ranking ? 'Pokaż (na prośbę)' : 'Ukryj (na prośbę)', ' data-on="'+(doc && !doc.ranking ? '1' : '0')+'"', 'small')],
    ['Nazwa publiczna', esc(doc && doc.displayName || '—')+(a ? ' '+btn('setName','Zmień','','small') : '')],
    ['Wiadomości e-mail', yesNo(d.news,'włączone','wyłączone')+(d.newsVia ? ' <span class="ad-muted">(zmiana: '+esc(d.newsVia)+')</span>' : '')+' '+
      btn('setNews', d.news ? 'Wyłącz (na prośbę)' : 'Włącz (na prośbę)', ' data-on="'+(d.news?'0':'1')+'"', 'small')],
    ['Chce pamiętnik', doc && doc.diaryWanted && doc.diaryWanted.length ? doc.diaryWanted.map(function(t){ return {ks:'Korona',wks:'Wielka',dks:'Diamentowa'}[t]; }).join(', ') : '—'],
    ['Ostatni zapis postępu', fmtTime(doc && doc.updated)],
    ['Schemat danych', doc ? (doc.schemaOk ? 'aktualny' : '<span class="ad-warn">stary (konto nie otwierało strony po zmianach list)</span>') : '—']
  ]));

  var editPeaks = doc && doc.schemaOk;
  /* P45: stary schemat → podgląd po przeliczeniu kopii tą samą migracją co strona (../migrations.js).
     Bez flag z serwera (functions sprzed P45) albo bez migrations.js — tylko surowe numery. */
  var view = null;
  if(doc && !doc.schemaOk && Array.isArray(doc.flags) && typeof migrateAll === 'function'){
    var copy = {ks: doc.ks.slice(), wks: doc.wks.slice(), dks: doc.dks.slice()};
    doc.flags.forEach(function(f){ copy[f] = true; });
    try { view = migrateAll(copy); } catch(e){ view = null; }
  }
  out += section('Zdobyte szczyty', (doc ? (editPeaks
      ? '<p class="ad-muted">Kliknij szczyt, aby go zaznaczyć lub odznaczyć. Jeśli użytkownik ma teraz otwartą stronę, poproś go o odświeżenie — inaczej jego przeglądarka może nadpisać zmianę.</p>'
      : view
      ? '<p class="ad-warn">Dane w starym schemacie: nazwy poniżej to podgląd po przeliczeniu (ta sama migracja co na stronie). '+
        'W bazie zmienią się, gdy użytkownik otworzy stronę zalogowany; dopiero wtedy będą możliwe poprawki.</p>'
      : '<p class="ad-warn">Dane w starym schemacie: numery szczytów odnoszą się do dawnych list, więc panel nie pokazuje nazw (byłyby przesunięte). '+
        'Strona przeliczy je sama, gdy użytkownik otworzy ją zalogowany; wtedy będą też możliwe poprawki.</p>') : '')+
    (doc ? TIERS.map(function(t){
    var raw = doc[t[0]] || [], unlocked = t[0]==='ks' || doc['unlocked_'+t[0]];
    var rawLine = '<p class="ad-muted small">Numery w bazie (stary schemat): '+(raw.length ? raw.join(', ') : '—')+'</p>';
    if(!editPeaks && !view) return '<div class="ad-tier"><h4>'+t[1]+' <span class="ad-muted">'+raw.length+' zapisanych'+
      (unlocked ? '' : ' · nieodblokowana')+'</span></h4>'+rawLine+'</div>';
    var have = view ? (view[t[0]] || []) : raw;
    return '<div class="ad-tier"><h4>'+t[1]+' <span class="ad-muted">'+have.length+'/'+t[2].length+
      (unlocked ? '' : ' · nieodblokowana')+(view ? ' · podgląd po przeliczeniu' : '')+'</span>'+
      (t[0]!=='ks' && editPeaks ? ' '+btn('setUnlock', unlocked ? 'Zablokuj koronę' : 'Odblokuj koronę', ' data-tier="'+t[0]+'" data-on="'+(unlocked?'0':'1')+'"', 'small') : '')+
      '</h4><div class="ad-peaks">'+t[2].map(function(p, i){
        var on = have.indexOf(i)!==-1;
        return editPeaks
          ? '<button type="button" class="ad-peak'+(on?' on':'')+'" data-act="setPeak" data-tier="'+t[0]+'" data-peak="'+esc(p.id)+'" data-on="'+(on?'0':'1')+'" title="'+esc(p.pasmo||'')+'">'+esc(p.name)+'</button>'
          : '<span class="ad-peak'+(on?' on':'')+'" title="'+esc(p.pasmo||'')+'">'+esc(p.name)+'</span>';
      }).join('')+'</div>'+
      (have.some(function(i){ return i>=t[2].length; }) ? '<p class="ad-warn">Numery spoza listy: '+have.filter(function(i){ return i>=t[2].length; }).join(', ')+'</p>' : '')+
      (view ? rawLine : '')+
    '</div>';
  }).join('') : '<p class="ad-muted">Brak dokumentu postępu.</p>'));

  var vis = (d.visits||[]).slice().sort(function(x, y){ return String(y.date||'').localeCompare(String(x.date||'')); });
  out += section('Wejścia w pamiętniku ('+vis.length+')', vis.length ? '<div class="ad-scroll"><table class="ad-table small"><thead><tr>'+
    '<th>Data</th><th>Szczyt</th><th>Trasa</th><th>km</th><th>↑ m</th><th>Towarzysze</th><th>Zdj.</th><th>Wspólne</th><th>Notatka</th><th></th></tr></thead><tbody>'+
    vis.map(function(v){
      return '<tr><td>'+fmtIso(v.date)+(v.dateApprox?' <span class="ad-muted">(ok.)</span>':'')+'</td>'+
        '<td>'+esc(PEAK[v.peakId] || v.peakId || '—')+'</td>'+
        '<td>'+(v.from||v.to ? esc((v.from||'?')+' → '+(v.to||'?')) : '—')+'</td>'+
        '<td class="n">'+(v.km!=null?v.km:'—')+'</td><td class="n">'+(v.ascent!=null?v.ascent:'—')+'</td>'+
        '<td>'+esc(v.companions.join(', ')||'—')+'</td><td class="n">'+v.photos+'</td>'+
        '<td class="n">'+(v.partners||'—')+'</td>'+
        '<td class="note">'+esc(v.note.length>200 ? v.note.slice(0,200)+'…' : v.note)+'</td>'+
        '<td class="acts">'+btn('editVisit','Popraw',' data-vid="'+esc(v.id)+'"','small')+btn('deleteVisit','Usuń',' data-vid="'+esc(v.id)+'"','small danger')+'</td></tr>';
    }).join('')+'</tbody></table></div>' : '<p class="ad-muted">Brak wejść.</p>');

  function invTable(list, mine){
    if(!list.length) return '<p class="ad-muted">Brak.</p>';
    return '<div class="ad-scroll"><table class="ad-table small"><thead><tr><th>Utworzone</th><th>Szczyt</th><th>Data wejścia</th>'+
      (mine ? '<th>Do</th>' : '<th>Od</th>')+'<th>Status</th><th>Przypomnienia</th>'+(mine ? '<th></th>' : '')+'</tr></thead><tbody>'+
      list.slice().sort(function(x, y){ return (y.created||0)-(x.created||0); }).map(function(i){
        var who = mine ? esc(i.toEmail||'—')+(i.toName?' <span class="ad-muted">('+esc(i.toName)+')</span>':'')
                       : (i.fromUid ? '<a href="#u/'+encodeURIComponent(i.fromUid)+'">'+esc(i.fromName||i.fromUid)+'</a>' : '—');
        return '<tr><td>'+fmtDay(i.created)+'</td><td>'+esc(PEAK[i.peakId]||i.peakId||'—')+'</td><td>'+fmtIso(i.date)+'</td>'+
          '<td>'+who+'</td><td>'+statusPl(i.status)+'</td><td class="n">'+i.reminders+'</td>'+
          (mine ? '<td class="acts">'+(i.status==='pending'
            ? btn('remindInvite','Przypomnij',' data-inv="'+esc(i.id)+'"','small')+btn('cancelInvite','Anuluj',' data-inv="'+esc(i.id)+'"','small danger') : '')+'</td>' : '')+'</tr>';
      }).join('')+'</tbody></table></div>';
  }
  out += section('Zaproszenia wysłane ('+(d.sent||[]).length+')', invTable(d.sent||[], true));
  out += section('Zaproszenia otrzymane ('+(d.received||[]).length+')', invTable(d.received||[], false));

  out += section('Połączone osoby ('+(d.people||[]).length+')', (d.people||[]).length ? '<ul class="ad-list">'+d.people.map(function(p){
    return '<li><a href="#u/'+encodeURIComponent(p.uid)+'">'+esc(p.label)+'</a>'+
      (p.aliases.length ? ' <span class="ad-muted">pisownie: '+esc(p.aliases.join(', '))+'</span>' : '')+'</li>';
  }).join('')+'</ul>' : '<p class="ad-muted">Brak połączeń z innymi kontami.</p>');

  out += section('Historia zmian administratora', logTable(d.log||[], false));
  main(out);
}

/* ── zgłoszenia ── */
function showFeedback(){
  main(nav('#zgloszenia')+'<p class="ad-muted">Pobieram zgłoszenia…</p>');
  api('feedback').then(function(d){
    var items = d.items || [], open = items.filter(function(x){ return !x.done; }).length;
    main(nav('#zgloszenia')+'<p class="ad-muted">Zgłoszeń: '+items.length+', niezałatwionych: '+open+'.</p>'+
      (items.length ? items.map(function(f){
        return '<article class="ad-fb'+(f.done?' done':'')+'"><header>'+fmtTime(f.created)+' · '+
          (f.userId ? '<a href="#u/'+encodeURIComponent(f.userId)+'">'+esc(f.name||f.userId)+'</a>' : esc(f.name||'niezalogowany'))+
          (f.email ? ' · '+esc(f.email) : '')+
          (f.post ? ' · wpis: <a href="../aktualnosci/'+encodeURIComponent(f.post)+'.html" target="_blank" rel="noopener">'+esc(f.post)+'</a>' : '')+
          ' <button type="button" class="ad-btn" data-fb="'+esc(f.id)+'" data-done="'+(f.done?'0':'1')+'">'+(f.done?'Przywróć':'Załatwione')+'</button>'+
          (f.done ? ' <span class="ad-muted">załatwione '+fmtDay(f.doneAt)+'</span>' : '')+
        '</header><p>'+esc(f.message).replace(/\n/g,'<br>')+'</p></article>';
      }).join('') : '<p class="ad-muted">Brak zgłoszeń.</p>'));
  }).catch(function(e){ main(nav('#zgloszenia')+errBox(e)); });
}

/* ── dziennik ── */
var ACTION_PL = {feedbackDone:'zgłoszenie załatwione / przywrócone', setPeak:'zdobyty szczyt', setUnlock:'odblokowanie korony',
  setName:'nazwa', setRanking:'ranking', setNews:'wiadomości e-mail', editVisit:'poprawka wejścia', deleteVisit:'usunięcie wejścia',
  cancelInvite:'anulowanie zaproszenia', remindInvite:'przypomnienie o zaproszeniu', sendVerify:'mail potwierdzający',
  sendReset:'link do zmiany hasła', setVerified:'adres oznaczony jako potwierdzony', setDisabled:'blokada konta', deleteAccount:'usunięcie konta'};

/* ── poprawki na karcie (etap B, P42): potwierdzenie → adminApi → odświeżenie karty ── */
function flash(msg, isErr){
  var f = $('ad-flash'); if(!f) return;
  f.hidden = false; f.className = 'ad-flash'+(isErr?' err':''); f.textContent = msg;
  if(!isErr) setTimeout(function(){ if(f.textContent===msg) f.hidden = true; }, 4000);
}
function peakName(tier, id){
  var t = TIERS.filter(function(x){ return x[0]===tier; })[0];
  var p = t && t[2].filter(function(x){ return x.id===id; })[0];
  return p ? p.name+' ('+t[1]+')' : id;
}
function run(el, action, data, ok){
  el.disabled = true;
  return api(action, Object.assign({uid: card.uid}, data)).then(function(){
    overview = null;                                   // lista odświeży się przy następnym wejściu
    if(action==='deleteAccount'){ location.hash = ''; return; }
    return showUser(card.uid, true).then(function(){ flash(ok || 'Zapisano.'); });
  }).catch(function(e){
    el.disabled = false;
    flash(e && e.message && e.message!=='internal' ? e.message : 'Nie udało się zapisać.', true);
  });
}
function doAct(el){
  var act = el.getAttribute('data-act'), on = el.getAttribute('data-on')==='1';
  var a = card.d.account || {}, who = a.email || card.uid;
  var visit = function(){ var id = el.getAttribute('data-vid'); return (card.d.visits||[]).filter(function(v){ return v.id===id; })[0]; };
  var inv = function(){ var id = el.getAttribute('data-inv'); return (card.d.sent||[]).filter(function(i){ return i.id===id; })[0]; };
  if(act==='setPeak'){
    var nm = peakName(el.getAttribute('data-tier'), el.getAttribute('data-peak'));
    if(!confirm((on ? 'Zaznaczyć jako zdobyty: ' : 'Odznaczyć zdobycie: ')+nm+'?')) return;
    return run(el, act, {tier: el.getAttribute('data-tier'), peakId: el.getAttribute('data-peak'), on: on}, (on?'Zaznaczono: ':'Odznaczono: ')+nm);
  }
  if(act==='setUnlock'){
    var tn = el.getAttribute('data-tier')==='wks' ? 'Wielką Koronę' : 'Diamentową Koronę';
    if(!confirm((on ? 'Odblokować ' : 'Zablokować ')+tn+'?')) return;
    return run(el, act, {tier: el.getAttribute('data-tier'), on: on});
  }
  if(act==='setName'){
    var cur = card.d.doc && card.d.doc.displayName || a.name || '';
    var nn = prompt('Nowa nazwa (widoczna w rankingu i w zaproszeniach). Teraz: „'+cur+'”', cur);
    if(nn==null || nn.trim()===cur) return;
    return run(el, act, {name: nn});
  }
  if(act==='setRanking' || act==='setNews'){
    var what = act==='setRanking' ? (on ? 'pokazać w rankingu' : 'ukryć w rankingu') : (on ? 'włączyć wiadomości e-mail' : 'wyłączyć wiadomości e-mail');
    if(!confirm('To wybór użytkownika. Czy '+who+' prosił(a), żeby '+what+'?\n\nOK = tak, prosił(a) o to.')) return;
    return run(el, act, {on: on, requested: true});
  }
  if(act==='sendVerify' && confirm('Wysłać mail z linkiem potwierdzającym na '+who+'?')) return run(el, act, {}, 'Mail wysłany.');
  if(act==='sendReset' && confirm('Wysłać link do ustawienia nowego hasła na '+who+'?')) return run(el, act, {}, 'Link wysłany.');
  if(act==='setVerified' && confirm('Oznaczyć '+who+' jako potwierdzony bez klikania w link?\n\nTylko gdy użytkownik napisał z tego adresu, a mail nie dochodzi.')) return run(el, act, {});
  if(act==='setDisabled' && confirm(on ? 'Zablokować konto '+who+'? Użytkownik zostanie wylogowany i nie zaloguje się, dopóki nie odblokujesz.' : 'Odblokować konto '+who+'?')) return run(el, act, {on: on});
  if(act==='deleteAccount'){
    var c = prompt('Usunąć konto '+who+' razem ze wszystkimi wejściami, zdjęciami i ustawieniami? Tej operacji nie można cofnąć.\n\nAby potwierdzić, wpisz adres e-mail konta:');
    if(c==null) return;
    if(c.trim().toLowerCase() !== String(a.email || card.uid).toLowerCase()){ flash('Adres się nie zgadza — konta nie usunięto.', true); return; }
    return run(el, act, {confirm: c.trim()});
  }
  if(act==='deleteVisit'){
    var v = visit(); if(!v) return;
    if(!confirm('Usunąć wejście na „'+(PEAK[v.peakId]||v.peakId)+'” z '+fmtIso(v.date)+' (zdjęć: '+v.photos+')? Tej operacji nie można cofnąć.')) return;
    return run(el, act, {visitId: v.id}, 'Wejście usunięte.');
  }
  if(act==='editVisit'){ var ev = visit(); if(ev) openVisitDialog(ev); return; }
  if(act==='remindInvite' || act==='cancelInvite'){
    var i = inv(); if(!i) return;
    var q = act==='remindInvite' ? 'Wysłać przypomnienie o zaproszeniu na '+i.toEmail+'?' : 'Anulować zaproszenie dla '+i.toEmail+'?';
    if(confirm(q)) return run(el, act, {inviteId: i.id}, act==='remindInvite' ? 'Przypomnienie wysłane.' : 'Zaproszenie anulowane.');
  }
}

/* okno poprawki wejścia: wysyłamy tylko zmienione pola */
function openVisitDialog(v){
  var dlg = $('ad-dlg');
  if(!dlg){ dlg = document.createElement('dialog'); dlg.id = 'ad-dlg'; dlg.className = 'ad-dlg'; document.body.appendChild(dlg); }
  var opts = TIERS.map(function(t){
    return '<optgroup label="'+t[1]+'">'+t[2].map(function(p){
      return '<option value="'+esc(p.id)+'"'+(p.id===v.peakId?' selected':'')+'>'+esc(p.name)+'</option>';
    }).join('')+'</optgroup>';
  }).join('');
  var f = function(id, label, html){ return '<label>'+label+html+'</label>'; };
  dlg.innerHTML = '<form method="dialog" id="ad-vf"><h3>Poprawka wejścia</h3>'+
    f('vf-peak','Szczyt','<select id="vf-peak">'+opts+'</select>')+
    '<div class="ad-row">'+f('vf-date','Data','<input type="date" id="vf-date" value="'+esc(v.date||'')+'">')+
      '<label class="ad-chk"><input type="checkbox" id="vf-approx"'+(v.dateApprox?' checked':'')+'> data przybliżona</label></div>'+
    '<div class="ad-row">'+f('vf-from','Skąd','<input id="vf-from" maxlength="100" value="'+esc(v.from||'')+'">')+
      f('vf-to','Dokąd','<input id="vf-to" maxlength="100" value="'+esc(v.to||'')+'">')+'</div>'+
    '<div class="ad-row">'+f('vf-km','km','<input id="vf-km" inputmode="decimal" value="'+(v.km!=null?v.km:'')+'">')+
      f('vf-asc','Podejście (m)','<input id="vf-asc" inputmode="numeric" value="'+(v.ascent!=null?v.ascent:'')+'">')+'</div>'+
    f('vf-comp','Towarzysze (jedna osoba w wierszu)','<textarea id="vf-comp" rows="4">'+esc(v.companions.join('\n'))+'</textarea>')+
    f('vf-note','Notatka','<textarea id="vf-note" rows="4" maxlength="5000">'+esc(v.note)+'</textarea>')+
    f('vf-link','Link','<input id="vf-link" maxlength="500" value="'+esc(v.link||'')+'">')+
    '<p class="ad-err-line" id="vf-err"></p>'+
    '<div class="ad-actions"><button type="submit" class="ad-btn primary" id="vf-save">Zapisz</button><button type="button" class="ad-btn" id="vf-cancel">Anuluj</button></div>'+
  '</form>';
  $('vf-cancel').onclick = function(){ dlg.close(); };
  $('ad-vf').onsubmit = function(ev){
    ev.preventDefault();
    var nv = {
      peakId: $('vf-peak').value, date: $('vf-date').value || null, dateApprox: $('vf-approx').checked,
      from: $('vf-from').value.trim() || null, to: $('vf-to').value.trim() || null,
      km: $('vf-km').value.trim()==='' ? null : Number($('vf-km').value.replace(',','.')),
      ascent: $('vf-asc').value.trim()==='' ? null : Number($('vf-asc').value),
      companions: $('vf-comp').value.split('\n').map(function(s){ return s.trim(); }).filter(Boolean),
      note: $('vf-note').value, link: $('vf-link').value.trim() || null
    };
    var fields = {}, lines = [];
    Object.keys(nv).forEach(function(k){
      var o = v[k]==null || v[k]==='' ? null : v[k], n = nv[k];
      if(k==='dateApprox'){ o = !!v.dateApprox; }
      if(JSON.stringify(o)!==JSON.stringify(n)){
        fields[k] = n;
        var show = function(x){ return x==null ? '—' : Array.isArray(x) ? x.join(', ') : k==='peakId' ? (PEAK[x]||x) : String(x); };
        lines.push(k+': '+show(o).slice(0,80)+' → '+show(n).slice(0,80));
      }
    });
    if(!lines.length){ dlg.close(); return; }
    if(!confirm('Zapisać zmiany?\n\n'+lines.join('\n'))) return;
    $('vf-save').disabled = true;
    api('editVisit', {uid: card.uid, visitId: v.id, fields: fields}).then(function(){
      dlg.close(); overview = null;
      return showUser(card.uid, true).then(function(){ flash('Wejście poprawione.'); });
    }).catch(function(e){
      $('vf-save').disabled = false;
      $('vf-err').textContent = e && e.message && e.message!=='internal' ? e.message : 'Nie udało się zapisać.';
    });
  };
  dlg.showModal();
}
function logTable(items, withTarget){
  if(!items.length) return '<p class="ad-muted">Brak wpisów.</p>';
  return '<div class="ad-scroll"><table class="ad-table small"><thead><tr><th>Kiedy</th>'+(withTarget?'<th>Konto</th>':'')+
    '<th>Działanie</th><th>Przed</th><th>Po</th><th>Uwagi</th></tr></thead><tbody>'+items.map(function(l){
      return '<tr><td>'+fmtTime(l.at)+'</td>'+
        (withTarget ? '<td>'+(l.target ? '<a href="#u/'+encodeURIComponent(l.target)+'">'+esc(l.target.slice(0,8))+'…</a>' : '—')+'</td>' : '')+
        '<td>'+esc(ACTION_PL[l.action]||l.action)+'</td><td>'+esc(JSON.stringify(l.before))+'</td><td>'+esc(JSON.stringify(l.after))+'</td>'+
        '<td>'+esc(l.note||'')+'</td></tr>';
    }).join('')+'</tbody></table></div>';
}
function showLog(){
  main(nav('#dziennik')+'<p class="ad-muted">Pobieram dziennik…</p>');
  api('log').then(function(d){
    main(nav('#dziennik')+'<p class="ad-muted">Ostatnie 300 zmian. Wpisy starsze niż rok są usuwane automatycznie.</p>'+logTable(d.items||[], true));
  }).catch(function(e){ main(nav('#dziennik')+errBox(e)); });
}

/* ── zdarzenia ── */
document.addEventListener('click', function(ev){
  var t = ev.target;
  if(t.closest('[data-logout]') || t.closest('[data-relog]')){ window._fb.signOut(window._fb.auth); return; }
  var actEl = t.closest('[data-act]');
  if(actEl && card && !actEl.disabled){ doAct(actEl); return; }
  var th = t.closest('th[data-sort]');
  if(th){ var k = th.getAttribute('data-sort'); if(sortKey===k) sortDir = -sortDir; else { sortKey = k; sortDir = 1; } drawTable(); return; }
  var tr = t.closest('tr[data-uid]');
  if(tr){ location.hash = 'u/'+encodeURIComponent(tr.getAttribute('data-uid')); return; }
  if(t.closest('[data-csv]')) return csv();
  if(t.closest('[data-refresh]')) return showUsers(true);
  var fbBtn = t.closest('[data-fb]');
  if(fbBtn){
    fbBtn.disabled = true;
    api('feedbackDone', {id: fbBtn.getAttribute('data-fb'), done: fbBtn.getAttribute('data-done')==='1'})
      .then(showFeedback).catch(function(e){ fbBtn.disabled = false; alert(e && e.message || 'Nie udało się zapisać.'); });
  }
});
document.addEventListener('keydown', function(ev){
  var tr = ev.target.closest && ev.target.closest('tr[data-uid]');
  if(tr && ev.key==='Enter') location.hash = 'u/'+encodeURIComponent(tr.getAttribute('data-uid'));
});
document.addEventListener('input', function(ev){
  if(ev.target.id==='ad-search'){ search = ev.target.value.trim(); drawTable(); }
});
document.addEventListener('change', function(ev){
  if(ev.target.id==='ad-filter'){ filterKey = ev.target.value; drawTable(); }
});
window.addEventListener('hashchange', function(){ if(window._fb && window._fb.auth.currentUser) route(); });

whenFb(function(fb){
  fb.onAuthStateChanged(fb.auth, function(user){
    overview = null;
    if(!user) return renderLogin();
    renderWho(user);
    route();
  });
});
})();
