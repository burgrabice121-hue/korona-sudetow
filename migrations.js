/* ═══════════════════════════════════════════════════════════
   migrations.js — migracje zapisanego postępu (ks/wks/dks to numery pozycji na listach z peaks-data.js).
   Wydzielone z app.js (P45), żeby strona i panel administracyjny liczyły to samo: strona migruje
   stan użytkownika (loadState, loadUserState, clearProgress), panel przelicza kopię do podglądu
   kont w starym schemacie. Ładować PRZED app.js (oba index.html) i w admin/index.html.
   Zmiana list szczytów = nowa migrateVN tutaj + wpis w migrateAll + flaga schemaVN w app.js
   (saveUserState/loadUserState) i w SCHEMA_FLAGS w functions/admin.js.
   ═══════════════════════════════════════════════════════════ */
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
/* Nowe kryterium DKS — wybitność >270 m lub izolacja >10 km, plus reprezentacja
   pasm bez reprezentanta w KS/WKS (v1.8). Usunięto Lázka i Borową, dodano 12
   szczytów (w tym drugi szczyt o nazwie "Smrek" — stąd mapowanie po pozycji,
   nie po nazwie, żeby nie pomylić obu). Mapowanie budowane wprost ze stanu
   DKS(27) sprzed tej zmiany na DKS(37) obecny. KS/WKS nie ruszone. */
function migrateV9(s){
  if(s.schemaV9) return s;
  const DKS_TO_NEW = [0,1,2,3,4,null,5,6,7,null,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24];
  const newDks = new Set();
  (s.dks||[]).forEach(i=>{
    const dest = DKS_TO_NEW[i];
    if(dest===null || dest===undefined) return;
    newDks.add(dest);
  });
  s.dks = Array.from(newDks);
  s.schemaV9 = true;
  return s;
}
/* Podmiana reprezentanta Pogórza Izerskiego: Andělský vrch (był DKS[10])
   zastąpiony przez Humrich (v1.9). Był ani pierwszym, ani ostatnim elementem,
   więc wszystkie indeksy DKS powyżej 10 przesuwają się o 1 w dół. Zdobycie
   Andělský vrch po prostu przepada — to inny szczyt, nie ma dokąd go
   przenieść (analogicznie do Spitzbergu w migrateV7). Humrich dodany na
   końcu, zaczyna niezdobyty. */
function migrateV10(s){
  if(s.schemaV10) return s;
  const oldDks = s.dks || [];
  const newDks = [];
  oldDks.forEach(i=>{
    if(i===10) return;                        // Andělský vrch: był DKS[10], usunięty
    else if(i>10) newDks.push(i-1);           // reszta DKS powyżej niego przesuwa się o 1 w dół
    else newDks.push(i);
  });
  s.dks = newDks;
  s.schemaV10 = true;
  return s;
}
/* Usunięcie Sasa (był DKS[11]): po zmianie granic Pogórza Wałbrzyskiego nie
   jest jego najwyższym szczytem, a na pogórzu nie ma szczytu o znacznej
   wybitności (v1.10). Zdobycie Sasa przepada, indeksy DKS powyżej 11
   przesuwają się o 1 w dół (jak w migrateV10). */
function migrateV11(s){
  if(s.schemaV11) return s;
  const oldDks = s.dks || [];
  const newDks = [];
  oldDks.forEach(i=>{
    if(i===11) return;                        // Sas: był DKS[11], usunięty
    else if(i>11) newDks.push(i-1);           // reszta DKS powyżej niego przesuwa się o 1 w dół
    else newDks.push(i);
  });
  s.dks = newDks;
  s.schemaV11 = true;
  return s;
}
function migrateV12(s){
  if(s.schemaV12) return s;
  const oldDks = s.dks || [];
  const newDks = [];
  oldDks.forEach(i=>{
    if(i===6) return;                         // Włodzicka Góra: była DKS[6], zastąpiona Górą Wszystkich Świętych (na końcu DKS)
    else if(i>6) newDks.push(i-1);            // reszta DKS powyżej niej przesuwa się o 1 w dół
    else newDks.push(i);
  });
  s.dks = newDks;
  s.schemaV12 = true;
  return s;
}
/* Valtenberg: WKS[8] -> koniec DKS (nowy DKS[39]) (v1.13). Izolacja wg NMT
   12,3 km (do Tanečnicy) < 14 km, więc nie spełnia kryterium WKS. Zdobycie
   przechodzi do DKS; indeksy WKS powyżej 8 przesuwają się o 1 w dół. */
function migrateV13(s){
  if(s.schemaV13) return s;
  const oldWks = s.wks || [];
  const newWks = [];
  let had = false;
  oldWks.forEach(i=>{
    if(i===8) had = true;                     // Valtenberg: był WKS[8]
    else if(i>8) newWks.push(i-1);            // reszta WKS powyżej niego przesuwa się o 1 w dół
    else newWks.push(i);
  });
  s.wks = newWks;
  const dks = s.dks || [];
  if(had && !dks.includes(39)) dks.push(39);  // Valtenberg: teraz DKS[39]
  s.dks = dks;
  s.schemaV13 = true;
  return s;
}
/* Wszystkie migracje po kolei. Nowa migracja (migrateVN) trafia TYLKO tutaj;
   korzystają z tego loadState, loadUserState i clearProgress (app.js) oraz panel (admin/admin.js). */
function migrateAll(s){
  s = migratePeakTiers(s);
  s = migrateOkoleToWks(s);
  s = migrateV4(s);
  s = migrateV5(s);
  s = migrateV6(s);
  s = migrateV7(s);
  s = migrateV8(s);
  s = migrateV9(s);
  s = migrateV10(s);
  s = migrateV11(s);
  s = migrateV12(s);
  s = migrateV13(s);
  return s;
}
