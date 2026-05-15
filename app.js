import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, query, orderBy, onSnapshot,
  doc, getDoc, setDoc, updateDoc, serverTimestamp, writeBatch
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
const MOBILE_JOIN_URL = "konehoot.pages.dev";
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
  const joinUrlEl = document.getElementById('join-url');
  if (joinUrlEl) joinUrlEl.textContent = MOBILE_JOIN_URL;
  document.getElementById('pw').focus();
  document.getElementById('pw').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
});

// ── Iniciar subscripcions ─────────────────────────────────────────────
function iniciarJoc() {
  // Preguntes del joc
  onSnapshot(query(collection(db, 'preguntes'), orderBy('ordre', 'asc')), snap => {
    preguntes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  });

  // Estat partida
  onSnapshot(doc(db, 'partida', 'estat'), snap => {
    if (!snap.exists()) {
      mostrarEspera();
      return;
    }
    partida = snap.data();
    renderEstat();
  });

  if (jugadorsSnap) jugadorsSnap();
  jugadorsSnap = onSnapshot(collection(db, 'partida', 'jugadors'), snap => {
    const jugadorsConnectats = snap.size;
    const el = document.getElementById('espera-jugadors');
    if (el) el.textContent = jugadorsConnectats;
    const startBtn = document.getElementById('espera-start-btn');
    if (startBtn) startBtn.disabled = jugadorsConnectats < 1;
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
  document.getElementById('espera-total').textContent = preguntes.length;
}

// ── PANTALLA PREGUNTA ─────────────────────────────────────────────────
function mostrarPregunta() {
  const screen = document.getElementById('screen-pregunta');
  screen.style.display = 'flex';

  const idx = partida.preguntaIndex ?? 0;
  const p   = preguntes[idx];
  if (!p) return;

  document.getElementById('pq-numero').textContent = `${idx + 1} / ${preguntes.length}`;
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
  respostesSnap = onSnapshot(
    collection(db, 'partida', 'estat', 'respostes'),
    snap => {
      document.getElementById('pq-respostes-cnt').textContent = snap.size;
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

  const idx = partida.preguntaIndex ?? 0;
  const p   = preguntes[idx];
  if (!p) return;

  document.getElementById('res-numero').textContent = `Pregunta ${idx + 1} de ${preguntes.length}`;
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
    .then(m => m.getDocs(collection(db, 'partida', 'jugadors')));

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
    .then(m => m.getDocs(collection(db, 'partida', 'jugadors')));

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
  if (!preguntes.length) { alert('No hi ha preguntes al joc!'); return; }
  // Esborra jugadors i respostes anteriors
  const batch = (await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js")).writeBatch(db);
  await setDoc(doc(db, 'partida', 'estat'), {
    fase: 'pregunta',
    preguntaIndex: 0,
    tempsPregunta: 20,
    iniciatAt: serverTimestamp()
  });
};

window.seguentPregunta = async function() {
  const idx = (partida.preguntaIndex ?? 0) + 1;
  if (idx >= preguntes.length) {
    await updateDoc(doc(db, 'partida', 'estat'), { fase: 'final' });
  } else {
    // Esborra respostes de la ronda anterior
    const { getDocs, deleteDoc } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const rSnap = await getDocs(collection(db, 'partida', 'estat', 'respostes'));
    const batch = writeBatch(db);
    rSnap.forEach(d => batch.delete(d.ref));
    batch.update(doc(db, 'partida', 'estat'), { fase: 'pregunta', preguntaIndex: idx });
    await batch.commit();
  }
};

window.mostrarResultatsAdmin = async function() {
  await updateDoc(doc(db, 'partida', 'estat'), { fase: 'resultats' });
};

window.resetJoc = async function() {
  if (!confirm('Reiniciar tot el joc?')) return;
  const { getDocs, deleteDoc } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
  const batch = writeBatch(db);
  const rSnap = await getDocs(collection(db, 'partida', 'estat', 'respostes'));
  rSnap.forEach(d => batch.delete(d.ref));
  const jSnap = await getDocs(collection(db, 'partida', 'jugadors'));
  jSnap.forEach(d => batch.delete(d.ref));
  batch.set(doc(db, 'partida', 'estat'), { fase: 'espera' });
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
  document.getElementById('btn-iniciar').style.display  = fase === 'espera'    ? '' : 'none';
  document.getElementById('btn-resultats').style.display = fase === 'pregunta'  ? '' : 'none';
  document.getElementById('btn-seguent').style.display   = fase === 'resultats' ? '' : 'none';
});
observer.observe(document.getElementById('joc'), { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
