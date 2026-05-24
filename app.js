import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, query, orderBy, onSnapshot,
  doc, getDoc, getDocs, setDoc, updateDoc, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── CONFIGURA AQUÍ ────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyDuHxOAU3hiL-8uUYuFyzP-mTyUCTR-wmw",
  authDomain: "konehoot.firebaseapp.com",
  projectId: "konehoot",
  storageBucket: "konehoot.firebasestorage.app",
  messagingSenderId: "357275257330",
  appId: "1:357275257330:web:a45bd66abb86a0747e836b"
};
const ADMIN_PASSWORD = "konehoot2025";
// ─────────────────────────────────────────────────────────────────────

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

// ── Estat ─────────────────────────────────────────────────────────────
let preguntes    = [];
let partida      = {};
let timerInterval = null;
let tempsRestant  = 0;
let respostesSnap = null;
let jugadorsSnap = null;
let jocs = [];
let configJoc = { tempsPregunta: 20, puntsBase: 1000, puntsRapidesa: 500 };
let jocSeleccionat = '';
let jugadorsActiusCount = 0;
let respostesActualsCount = 0;
let canviResultatsManualPermes = false;
let ultimaFase = 'espera';

async function comptarJugadorsActius(jocId) {
  if (!jocId) return 0;
  const resetAtMs = tsMillis(partida.resetAt);
  const snap = await getDocs(collection(db, 'partida', 'estat', 'jugadors'));
  return snap.docs.filter(d => {
    const dat = d.data() || {};
    return (dat.jocId || '') === jocId && tsMillis(dat.connectatAt) >= resetAtMs;
  }).length;
}

function getJocActiu() {
  return jocs.find(j => j.actiu !== false) || null;
}

function tsMillis(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.seconds === 'number') return ts.seconds * 1000 + Math.floor((ts.nanoseconds || 0) / 1e6);
  return 0;
}

// ── Login ─────────────────────────────────────────────────────────────
function login() {
  const pw = document.getElementById('pw').value;
  if (pw === ADMIN_PASSWORD) {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('joc').style.display = 'block';
    iniciarJoc();
  } else {
    document.getElementById('login-err').style.display = 'block';
    document.getElementById('pw').value = '';
  }
}
window.login = login;
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('pw').focus();
  document.getElementById('pw').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
});

// ── Iniciar subscripcions ─────────────────────────────────────────────
function iniciarJoc() {
  // Preguntes del joc
  onSnapshot(query(collection(db, 'preguntes'), orderBy('ordre', 'asc')), snap => {
    preguntes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    mostrarEspera();
  });

  onSnapshot(query(collection(db, 'jocs'), orderBy('createdAt', 'asc')), snap => {
    jocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const jocActiu = getJocActiu();
    jocSeleccionat = jocActiu?.id || '';
    const jocLabel = document.getElementById('pantalla-joc-actiu');
    if (jocLabel) jocLabel.textContent = jocActiu ? (jocActiu.nom || jocActiu.id) : 'Cap joc actiu';
    mostrarEspera();
  });

  // Estat partida
  onSnapshot(doc(db, 'partida', 'estat'), snap => {
    if (!snap.exists()) {
      mostrarEspera();
      return;
    }
    const novaPartida = snap.data();
    const faseNova = novaPartida.fase || 'espera';
    const esPasNoManual = ultimaFase === 'pregunta' && faseNova === 'resultats' && !canviResultatsManualPermes;
    if (esPasNoManual) {
      updateDoc(doc(db, 'partida', 'estat'), { fase: 'pregunta' }).catch(() => {});
      return;
    }
    partida = novaPartida;
    ultimaFase = faseNova;
    if (partida.jocId) {
      jocSeleccionat = partida.jocId;
    }
    actualitzarTemaPerJoc();
    renderEstat();
  });

  getDoc(doc(db, 'partida', 'config')).then(cfg => {
    if (cfg.exists()) configJoc = { ...configJoc, ...cfg.data() };
  }).catch(() => {});

  const connEl = document.getElementById('conn-status');
  if (connEl) connEl.textContent = 'Connexio: connectant a jugadors…';

  if (jugadorsSnap) jugadorsSnap();
  jugadorsSnap = onSnapshot(collection(db, 'partida', 'estat', 'jugadors'), snap => {
    const resetAtMs = tsMillis(partida.resetAt);
    const docsActius = snap.docs.filter(d => tsMillis(d.data().connectatAt) >= resetAtMs);
    const jocCursId = partida.jocId || jocSeleccionat;
    const jugadorsActius = jocCursId
      ? docsActius.filter(d => (d.data().jocId || '') === jocCursId)
      : docsActius;
    const jugadorsConnectats = jugadorsActius.length;
    jugadorsActiusCount = jugadorsConnectats;
    const el = document.getElementById('espera-jugadors');
    if (el) el.textContent = jugadorsConnectats;
    const startBtn = document.getElementById('espera-start-btn');
    if (startBtn) startBtn.disabled = jugadorsConnectats < 1;
    const playersEl = document.getElementById('espera-players');
    if (playersEl) {
      const noms = jugadorsActius.map(d => (d.data().nom || d.id)).filter(Boolean).sort((a, b) => String(a).localeCompare(String(b), 'ca'));
      playersEl.innerHTML = noms.map(n => `<span class="player-chip">${esc(n)}</span>`).join('');
    }
    actualitzarBotoResultats();
    if (connEl) connEl.textContent = 'Connexio: en linia';
  }, err => {
    console.error('Error llegint jugadors connectats:', err);
    const el = document.getElementById('espera-jugadors');
    if (el) el.textContent = '0';
    const playersEl = document.getElementById('espera-players');
    if (playersEl) playersEl.innerHTML = '';
    jugadorsActiusCount = 0;
    actualitzarBotoResultats();
    if (connEl) connEl.textContent = 'Connexio: error llegint jugadors';
  });
}

// ── Render principal ──────────────────────────────────────────────────
function renderEstat() {
  const fase = partida.fase || 'espera';
  ocultarTot();

  if (fase === 'espera')       mostrarEspera();
  else if (fase === 'pregunta') mostrarPregunta();
  else if (fase === 'resultats') mostrarResultats();
  else if (fase === 'final')    mostrarFinal();
}

function ocultarTot() {
  ['screen-espera','screen-pregunta','screen-resultats','screen-final'].forEach(id => {
    document.getElementById(id).style.display = 'none';
  });
  clearInterval(timerInterval);
}

// ── PANTALLA ESPERA ───────────────────────────────────────────────────
function mostrarEspera() {
  document.getElementById('screen-espera').style.display = 'flex';
  const jocActiu = partida.jocId || jocSeleccionat;
  const total = preguntes.filter(p => (p.jocId || '') === jocActiu).length;
  document.getElementById('espera-total').textContent = total;
}

function actualitzarTemaPerJoc() {
  const jocActiu = partida.jocNom || (jocs.find(j => j.id === jocSeleccionat)?.nom || '');
  document.body.classList.toggle('theme-finde', String(jocActiu).trim().toLowerCase() === 'finde rural 2026');
}

function preguntesActives() {
  const jocActiu = partida.jocId || jocSeleccionat;
  return preguntes.filter(p => (p.jocId || '') === jocActiu);
}

// ── PANTALLA PREGUNTA ─────────────────────────────────────────────────
function mostrarPregunta() {
  const screen = document.getElementById('screen-pregunta');
  screen.style.display = 'flex';

  const idx = partida.preguntaIndex ?? 0;
  const p   = preguntesActives()[idx];
  if (!p) return;

  const bloc = preguntesActives();
  document.getElementById('pq-numero').textContent = `${idx + 1} / ${bloc.length}`;
  document.getElementById('pq-autor').textContent  = p.autor;
  document.getElementById('pq-text').textContent   = p.pregunta;

  const colors = ['--c1','--c2','--c3','--c4'];
  const lletres = ['A','B','C','D'];
  p.respostes.forEach((r, i) => {
    document.getElementById(`pq-resp-${i}`).querySelector('.resp-text').textContent = r;
    document.getElementById(`pq-resp-${i}`).querySelector('.resp-lletra').textContent = lletres[i];
    document.getElementById(`pq-resp-${i}`).classList.remove('revelada','correcta','incorrecta');
  });

  // Comptador de respostes en temps real
  if (respostesSnap) respostesSnap(); // unsub anterior
  respostesActualsCount = 0;
  respostesSnap = onSnapshot(
    collection(db, 'partida', 'estat', 'respostes'),
    snap => {
      respostesActualsCount = snap.size;
      document.getElementById('pq-respostes-cnt').textContent = respostesActualsCount;
      actualitzarBotoResultats();
    }
  );

  // Timer
  tempsRestant = partida.tempsPregunta || 20;
  renderTimer();
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    tempsRestant--;
    renderTimer();
    if (tempsRestant <= 0) clearInterval(timerInterval);
  }, 1000);
}

function renderTimer() {
  const el  = document.getElementById('pq-timer');
  const arc = document.getElementById('timer-arc');
  const total = partida.tempsPregunta || 20;
  const pct   = tempsRestant / total;
  const r = 44;
  const circ = 2 * Math.PI * r;
  arc.style.strokeDashoffset = circ * (1 - pct);
  el.textContent = tempsRestant;
  arc.style.stroke = tempsRestant > total * 0.4 ? 'var(--c2)' : tempsRestant > total * 0.2 ? '#ffb800' : 'var(--c3)';
}

// ── PANTALLA RESULTATS ────────────────────────────────────────────────
async function mostrarResultats() {
  const screen = document.getElementById('screen-resultats');
  screen.style.display = 'flex';
  if (respostesSnap) { respostesSnap(); respostesSnap = null; }
  actualitzarBotoResultats();

  const idx = partida.preguntaIndex ?? 0;
  const p   = preguntesActives()[idx];
  if (!p) return;

  document.getElementById('res-numero').textContent = `Pregunta ${idx + 1} de ${preguntesActives().length}`;
  document.getElementById('res-text').textContent   = p.pregunta;
  document.getElementById('res-autor').textContent  = p.autor;

  // Llegir respostes
  const resSnap = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js")
    .then(m => m.getDocs(collection(db, 'partida', 'estat', 'respostes')));

  const comptes = [0,0,0,0];
  resSnap.forEach(d => {
    const v = d.data().resposta;
    if (v >= 0 && v <= 3) comptes[v]++;
  });
  const total = comptes.reduce((a,b) => a+b, 0);
  const lletres = ['A','B','C','D'];

  p.respostes.forEach((r, i) => {
    const el    = document.getElementById(`res-resp-${i}`);
    const bar   = el.querySelector('.res-bar-fill');
    const label = el.querySelector('.res-label');
    const pct   = total > 0 ? Math.round(comptes[i]/total*100) : 0;
    bar.style.width = pct + '%';
    label.textContent = `${lletres[i]}. ${r}  —  ${comptes[i]} vot${comptes[i]!==1?'s':''}`;
    el.classList.toggle('correcta', i === p.correcta);
    el.classList.toggle('incorrecta', i !== p.correcta);
  });

  // Rànquing top 5
  const jugadors = {};
  resSnap.forEach(d => {
    const dat = d.data();
    const nom = dat.nom || d.id;
    if (!jugadors[nom]) jugadors[nom] = { nom, punts: 0 };
    if (dat.resposta === p.correcta) jugadors[nom].punts += dat.punts || 0;
  });

  // Puntuació acumulada de Firestore
  const rankSnap = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js")
    .then(m => m.getDocs(collection(db, 'partida', 'estat', 'jugadors')));

  const rank = [];
  rankSnap.forEach(d => rank.push({ nom: d.id, ...d.data() }));
  rank.sort((a,b) => b.punts - a.punts);

  const rankEl = document.getElementById('res-ranking');
  rankEl.innerHTML = rank.slice(0,5).map((j, i) => `
    <div class="rank-row">
      <span class="rank-pos">${['🥇','🥈','🥉','4','5'][i]}</span>
      <span class="rank-nom">${esc(j.nom)}</span>
      <span class="rank-punts">${j.punts} pts</span>
    </div>
  `).join('') || '<div style="opacity:.4;font-size:14px">Cap resposta registrada</div>';
}

// ── PANTALLA FINAL ────────────────────────────────────────────────────
async function mostrarFinal() {
  document.getElementById('screen-final').style.display = 'flex';

  const rankSnap = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js")
    .then(m => m.getDocs(collection(db, 'partida', 'estat', 'jugadors')));

  const rank = [];
  rankSnap.forEach(d => rank.push({ nom: d.id, ...d.data() }));
  rank.sort((a,b) => b.punts - a.punts);

  const medalles = ['🥇','🥈','🥉'];
  document.getElementById('final-ranking').innerHTML = rank.map((j, i) => `
    <div class="final-row" style="animation-delay:${i*0.1}s">
      <span class="final-pos">${medalles[i] || (i+1)}</span>
      <span class="final-nom">${esc(j.nom)}</span>
      <span class="final-punts">${j.punts}<small> pts</small></span>
    </div>
  `).join('');
}

// ── CONTROLS ADMIN (botons de la pantalla) ────────────────────────────
window.iniciarPartida = async function() {
  const bloc = preguntes.filter(p => (p.jocId || '') === jocSeleccionat);
  if (!jocSeleccionat) { alert('Selecciona un joc.'); return; }
  if (!bloc.length) { alert('No hi ha preguntes al joc seleccionat!'); return; }
  const joc = jocs.find(j => j.id === jocSeleccionat);
  const jugadorsEsperats = await comptarJugadorsActius(jocSeleccionat);
  // Esborra respostes anteriors
  const batch = writeBatch(db);
  const rSnap = await getDocs(collection(db, 'partida', 'estat', 'respostes'));
  rSnap.forEach(d => batch.delete(d.ref));
  respostesActualsCount = 0;
  await batch.commit();
  await setDoc(doc(db, 'partida', 'estat'), {
    fase: 'pregunta',
    jocId: jocSeleccionat,
    jocNom: joc?.nom || jocSeleccionat,
    preguntaIndex: 0,
    jugadorsEsperats,
    tempsPregunta: configJoc.tempsPregunta || 20,
    puntsBase: configJoc.puntsBase || 1000,
    puntsRapidesa: configJoc.puntsRapidesa || 500,
    iniciatAt: serverTimestamp()
  });
};

window.seguentPregunta = async function() {
  const bloc = preguntesActives();
  const idx = (partida.preguntaIndex ?? 0) + 1;
  if (idx >= bloc.length) {
    await updateDoc(doc(db, 'partida', 'estat'), { fase: 'final' });
  } else {
    const jugadorsEsperats = await comptarJugadorsActius(partida.jocId || jocSeleccionat);
    // Esborra respostes de la ronda anterior
    const rSnap = await getDocs(collection(db, 'partida', 'estat', 'respostes'));
    const batch = writeBatch(db);
    rSnap.forEach(d => batch.delete(d.ref));
    batch.update(doc(db, 'partida', 'estat'), { fase: 'pregunta', preguntaIndex: idx, jugadorsEsperats });
    await batch.commit();
  }
};

window.mostrarResultatsAdmin = async function() {
  if ((partida.fase || 'espera') !== 'pregunta') return;
  canviResultatsManualPermes = true;
  await updateDoc(doc(db, 'partida', 'estat'), { fase: 'resultats' });
  setTimeout(() => {
    canviResultatsManualPermes = false;
  }, 1500);
};

function actualitzarBotoResultats() {
  const btn = document.getElementById('btn-resultats');
  if (!btn) return;
  const fasePregunta = (partida.fase || 'espera') === 'pregunta';
  btn.disabled = !fasePregunta;
}

window.resetJoc = async function() {
  if (!confirm('Reiniciar tot el joc?')) return;
  const batch = writeBatch(db);
  const rSnap = await getDocs(collection(db, 'partida', 'estat', 'respostes'));
  rSnap.forEach(d => batch.delete(d.ref));
  const jSnap = await getDocs(collection(db, 'partida', 'estat', 'jugadors'));
  jSnap.forEach(d => batch.delete(d.ref));
  batch.set(doc(db, 'partida', 'estat'), { fase: 'espera', resetAt: serverTimestamp() });
  await batch.commit();
};

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Actualitza botons admin segons la fase
const observer = new MutationObserver(() => {
  const fase = document.getElementById('screen-pregunta').style.display !== 'none' ? 'pregunta'
             : document.getElementById('screen-resultats').style.display !== 'none' ? 'resultats'
             : document.getElementById('screen-final').style.display !== 'none' ? 'final'
             : 'espera';
  document.getElementById('btn-resultats').style.display = fase === 'pregunta'  ? '' : 'none';
  document.getElementById('btn-seguent').style.display   = fase === 'resultats' ? '' : 'none';
});
observer.observe(document.getElementById('joc'), { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
