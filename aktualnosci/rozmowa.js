/* rozmowa.js — ramka „Twoje zdanie” pod wpisem w Aktualnościach (Interfejs, prośba Promocji 2026-11-11).
   Znacznik we wpisie (treść: Promocja):
     <section class="talk" data-post="<id-wpisu>" hidden> … form#talk-form, textarea#talk-msg, input#talk-email,
     button#talk-send, div#talk-status … </section>
     <script src="rozmowa.js?v=…" defer></script>
   Zapis do kolekcji feedback w tym samym kształcie co „Zgłoś uwagi” w app.js (message, email, userId, displayName,
   createdAt) + post (data-post). Czyta panel administratora (#zgloszenia). Firebase (../firebase-init.js) ładowany
   dopiero przy pierwszym kontakcie z formularzem, żeby nie spowalniać wpisu. Bez JS ramka zostaje ukryta. */
(function(){
'use strict';
var box = document.querySelector('section.talk[data-post]');
if(!box) return;
var form = box.querySelector('#talk-form'), msg = box.querySelector('#talk-msg'), mail = box.querySelector('#talk-email'),
    send = box.querySelector('#talk-send'), status = box.querySelector('#talk-status');
var post = box.getAttribute('data-post');
if(!form || !msg || !send || !status || !/^[a-z0-9-]{1,80}$/.test(post || '')) return;

var MAX = 3000;
var me = document.currentScript || document.querySelector('script[src*="rozmowa.js"]');
var INIT = new URL('../firebase-init.js?v=20261026', me ? me.src : location.href).href;

var fbPromise = null;
function loadFb(){
  if(window._fb) return Promise.resolve(window._fb);
  if(!fbPromise){
    fbPromise = new Promise(function(resolve, reject){
      if(!document.querySelector('script[src*="firebase-init.js"]')){
        var s = document.createElement('script');
        s.type = 'module'; s.src = INIT;
        s.onerror = function(){ reject(new Error('firebase-init')); };
        document.head.appendChild(s);
      }
      var t0 = Date.now();
      (function wait(){
        if(window._fb) return resolve(window._fb);
        if(Date.now() - t0 > 15000) return reject(new Error('timeout'));
        setTimeout(wait, 100);
      })();
    });
    fbPromise.catch(function(){ fbPromise = null; });   // następna próba po błędzie sieci
  }
  return fbPromise;
}

function say(text, err){
  status.textContent = text;
  status.classList.toggle('err', !!err);
}

msg.addEventListener('focus', function(){ loadFb().catch(function(){}); }, {once: true});

form.addEventListener('submit', function(ev){
  ev.preventDefault();
  var message = msg.value.trim(), email = mail ? mail.value.trim() : '';
  if(!message){ say('Wpisz treść wiadomości.', true); msg.focus(); return; }
  if(message.length > MAX){ say('Wiadomość może mieć najwyżej ' + MAX + ' znaków.', true); return; }
  if(email && (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))){ say('Sprawdź adres e-mail albo zostaw to pole puste.', true); if(mail) mail.focus(); return; }
  send.disabled = true;
  say('Wysyłam…');
  loadFb().then(function(fb){
    // zalogowany na stronie głównej → ta sama sesja (ta sama domena); poczekaj, aż Firebase ją odtworzy
    var ready = fb.auth.authStateReady ? fb.auth.authStateReady() : Promise.resolve();
    return ready.then(function(){
      var user = fb.auth.currentUser;
      return fb.setDoc(fb.doc(fb.collection(fb.db, 'feedback')), {
        message: message,
        email: email || null,
        userId: user ? user.uid : null,
        displayName: user ? (user.displayName || user.email) : null,
        post: post,
        createdAt: fb.serverTimestamp()
      });
    });
  }).then(function(){
    form.reset();
    say('Dziękuję! Wiadomość trafiła do autora.');
    send.disabled = false;
  }).catch(function(e){
    if(window.console) console.warn('Zapis wiadomości nieudany', e);
    say('Nie udało się wysłać. Spróbuj ponownie za chwilę.', true);
    send.disabled = false;
  });
});

box.hidden = false;
})();
