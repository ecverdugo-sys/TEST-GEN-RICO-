// script.js — auto-scroll al iniciar + orden numérico de temas + parser robusto + aleatorio + persistencia falladas + GUARDADO/CARGA SESIÓN

(() => {

// Estado
let questions = [];
let allQuestions = [];
let temasPorPregunta = {};
let selectedThemes = [];
let statsByTopic = {};
let previousFailedQuestions = [];
let currentFailedQuestions = [];
let currentQuestionIndex = 0;
let answeredQuestions = 0;
let score = 0;
let correctAnswersCount = 0;
let incorrectAnswersCount = 0;
let startTime = null;
let timerInterval = null;

// Persistencia del listado de falladas del intento anterior durante el "reinicio con falladas"
let isRetryRun = false;
let retryRunInitialList = [];

// Clave para localStorage de sesión
const SESSION_KEY = 'quizSessionSave.v1';

// Utilidades
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const norm = s => (s||'').replace(/\r/g,'').replace(/[\u2012\u2013\u2014\u2212]/g,'-');
const numFromTema = t => {
  const m = String(t||'').match(/tema\s+(\d+)/i);
  return m ? parseInt(m[1],10) : Number.POSITIVE_INFINITY;
};

function logStatus(msg, isError=false){
  const el = $('#loadStatus');
  if(!el) return;
  el.textContent = msg;
  el.style.color = isError ? 'crimson' : '#64748b';
}

function shuffleInPlace(arr){
  for(let i=arr.length-1; i>0; i--){
    const j = Math.floor(Math.random()*(i+1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function scrollToQuiz(){
  const qc = document.getElementById('quizContainer');
  if (qc) qc.scrollIntoView({ behavior: 'smooth', block: 'start' });
}



// === Cuestionarios disponibles en la app (PWA) ===
const QUIZZES_BUILTIN = [
  {
    id: 'A1_GENERAL',
    nombre: 'A1 GENERAL 2020-23 (definitivo)',
    fichero: 'A1_GENERAL_2020-23__DEFINITIVO REVISADO.txt'
  },
  {
    id: 'A2_GENERAL',
    nombre: 'A2 GENERAL 2020-23',
    fichero: 'A2_GENERAL_2020-23.txt'
  },
  {
    id: 'C1_GENERAL',
    nombre: 'C1 GENERAL 2020-23',
    fichero: 'C1_GENERAL_2020-23.txt'
  },
  {
    id: 'C1_ESPECIFICO',
    nombre: 'C1 ESPECÍFICO 2020-23',
    fichero: 'C1_ESPECÍFICO_2020-23.txt'
  },
  {
    id: 'PSICOLOGIA',
    nombre: 'PSICOLOGÍA 2020-23 (definitivo)',
    fichero: 'PSICOLOGIA_2020-23__DEFINITIVO REVISADO.txt'
  }
];

function inicializarSelectorCuestionarios(){
  const select = document.getElementById('quizSelect');
  if (!select) return;
  select.innerHTML = '';

  QUIZZES_BUILTIN.forEach(q => {
    const opt = document.createElement('option');
    opt.value = q.fichero;
    opt.textContent = q.nombre;
    select.appendChild(opt);
  });

  const first = QUIZZES_BUILTIN[0];
  if (first) select.value = first.fichero;

  logStatus('Selecciona un cuestionario y pulsa "Cargar cuestionario".');
}

function obtenerQuizPorFichero(fichero){
  return QUIZZES_BUILTIN.find(q => q.fichero === fichero) || null;
}

async function cargarCuestionarioSeleccionado(){
  if (location.protocol === 'file:') {
    alert(
      'La app no puede cargar cuestionarios si se abre como file://\n\n' +
      'Debes abrirla desde un servidor web.\n' +
      'Ejemplo en tu PC: http://localhost:8000/'
    );
    return;
  }

  const select = document.getElementById('quizSelect');
  if (!select || !select.value){
    alert('Elige un cuestionario.');
    return;
  }
  const quiz = obtenerQuizPorFichero(select.value);
  if (!quiz){
    alert('No se reconoce el cuestionario seleccionado.');
    return;
  }

  try {
    logStatus(`Cargando "${quiz.nombre}"...`);
    const resp = await fetch(quiz.fichero);
    if (!resp.ok){
      throw new Error('HTTP ' + resp.status);
    }
    const text = await resp.text();
    startFromEmbedded(text, quiz.nombre);
  } catch(err){
    console.error('Error cargando cuestionario:', err);
    logStatus('No se pudo cargar el cuestionario seleccionado.', true);
    alert('No se pudo cargar el cuestionario seleccionado. Comprueba la conexión la primera vez.');
  }
}

async function actualizarCuestionariosRemotos(){
  try {
    logStatus('Actualizando cuestionarios desde la red...');
    let ok = 0, fail = 0;
    for (const quiz of QUIZZES_BUILTIN){
      try {
        const resp = await fetch(quiz.fichero, { cache: 'no-store' });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        await resp.text(); // fuerza paso por el Service Worker
        ok++;
      } catch (e){
        console.error('No se pudo actualizar', quiz.fichero, e);
        fail++;
      }
    }
    if (fail === 0){
      logStatus('Cuestionarios actualizados. Puedes usarlos sin conexión.');
      alert('Cuestionarios actualizados correctamente.');
    } else {
      logStatus(`Actualización completada con ${ok} correctos y ${fail} errores.`, true);
      alert('La actualización se ha completado con algunos errores. Revisa la conexión.');
    }
  } catch(err){
    console.error('Error general actualizando cuestionarios:', err);
    logStatus('Error actualizando los cuestionarios.', true);
    alert('Error actualizando los cuestionarios.');
  }
}

// ========== GUARDADO Y CARGA DE SESIÓN ==========

function saveSession(){
  try {
    const elapsed = startTime ? (Date.now() - startTime) : 0;
    const sessionData = {
      questions: questions, // incluye el estado de cada pregunta (selectedAnswer, skipped, etc.)
      allQuestions: allQuestions,
      temasPorPregunta: temasPorPregunta,
      selectedThemes: selectedThemes,
      statsByTopic: statsByTopic,
      previousFailedQuestions: previousFailedQuestions,
      currentFailedQuestions: currentFailedQuestions,
      currentQuestionIndex: currentQuestionIndex,
      answeredQuestions: answeredQuestions,
      score: score,
      correctAnswersCount: correctAnswersCount,
      incorrectAnswersCount: incorrectAnswersCount,
      elapsedTime: elapsed,
      isRetryRun: isRetryRun,
      retryRunInitialList: retryRunInitialList
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));
  } catch(e) {
    console.error('Error guardando sesión:', e);
  }
}

function loadSession(){
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch(e) {
    console.error('Error cargando sesión:', e);
    return null;
  }
}

function clearSession(){
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch(e) {
    console.error('Error borrando sesión:', e);
  }
}

function restoreSession(sessionData){
  questions = sessionData.questions || [];
  allQuestions = sessionData.allQuestions || [];
  temasPorPregunta = sessionData.temasPorPregunta || {};
  selectedThemes = sessionData.selectedThemes || [];
  statsByTopic = sessionData.statsByTopic || {};
  previousFailedQuestions = sessionData.previousFailedQuestions || [];
  currentFailedQuestions = sessionData.currentFailedQuestions || [];
  currentQuestionIndex = sessionData.currentQuestionIndex || 0;
  answeredQuestions = sessionData.answeredQuestions || 0;
  score = sessionData.score || 0;
  correctAnswersCount = sessionData.correctAnswersCount || 0;
  incorrectAnswersCount = sessionData.incorrectAnswersCount || 0;
  isRetryRun = sessionData.isRetryRun || false;
  retryRunInitialList = sessionData.retryRunInitialList || [];
  
  // Restaurar cronómetro con el tiempo acumulado
  const elapsed = sessionData.elapsedTime || 0;
  startTime = Date.now() - elapsed; // Ajustar startTime para que refleje el tiempo transcurrido
  
  // Limpiar intervalo anterior si existe
  if (timerInterval) {
    clearInterval(timerInterval);
  }
  
  // Iniciar el cronómetro continuando desde el tiempo guardado
  timerInterval = setInterval(() => {
    const diff = Date.now() - startTime;
    const h = Math.floor(diff/3600000);
    const m = Math.floor((diff%3600000)/60000);
    const s = Math.floor((diff%60000)/1000);
    $('#timer').textContent = `Tiempo transcurrido: ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }, 1000);
  
  // Actualizar display inmediatamente con el tiempo guardado
  const h = Math.floor(elapsed/3600000);
  const m = Math.floor((elapsed%3600000)/60000);
  const s = Math.floor((elapsed%60000)/1000);
  $('#timer').textContent = `Tiempo transcurrido: ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  
  // Mostrar UI necesaria
  populateThemeDropdown();
  $('#themeSelector').style.display = 'block';
  $('#numberSelector').style.display = 'block';
  $('#quizContainer').style.display = 'block';
  $('#stats').style.display = 'block';
  $('#failedPanel').style.display = 'block';
  
  updateStats();
  createFailedQuestionsDisplay();
  showQuestion();
  scrollToQuiz();
  
  logStatus(`Sesión restaurada: ${questions.length} preguntas.`);
}

function showSessionDialog(sessionData){
  const modal = document.getElementById('sessionRestoreModal');
  if (!modal) return;
  
  modal.style.display = 'flex';
  
  const yesBtn = document.getElementById('sessionRestoreYes');
  const noBtn = document.getElementById('sessionRestoreNo');
  
  yesBtn.onclick = () => {
    modal.style.display = 'none';
    restoreSession(sessionData);
  };
  
  noBtn.onclick = () => {
    modal.style.display = 'none';
    clearSession();
    // Continuar con inicio normal (ya se habrá parseado el contenido)
  };
}

// Listeners base
document.addEventListener('DOMContentLoaded', () => {
  const input = $('#fileInput') || document.querySelector('input[type="file"]');
  if (input) input.addEventListener('change', onFileSelected, { once:false });

  $('#applyThemesBtn')?.addEventListener('click', applyThemeSelection);
  $('#clearThemesBtn')?.addEventListener('click', () => {
    const sel = $('#themeDropdown');
    if (!sel) return;
    Array.from(sel.options).forEach(o => o.selected = false);
    selectedThemes = [];
    updateSelectedThemesList();
    isRetryRun = false;
    retryRunInitialList = [];
  });
  $('#selectAllThemes')?.addEventListener('change', e => toggleSelectAllThemes(e.target.checked));
  $('#applyNumbersBtn')?.addEventListener('click', applyNumberSelection);
  $('#clearNumbersBtn')?.addEventListener('click', () => {
    const inp = document.getElementById('numbersInput');
    if (inp) inp.value = '';
    isRetryRun = false;
    retryRunInitialList = [];
  });
  $('#nextButton')?.addEventListener('click', showNextQuestion);
  $('#prevButton')?.addEventListener('click', prevQuestion);
  $('#statsButton')?.addEventListener('click', showStats);
  $('#closeStatsBtn')?.addEventListener('click', closeStats);

  // Inicializar selector de cuestionarios (PWA)
  inicializarSelectorCuestionarios();
  const loadBtn = document.getElementById('loadQuizBtn');
  if (loadBtn) {
    loadBtn.addEventListener('click', cargarCuestionarioSeleccionado);
  }
  const updateBtn = document.getElementById('updateQuizzesBtn');
  if (updateBtn) {
    updateBtn.addEventListener('click', actualizarCuestionariosRemotos);
  }

  // Botón guardar sesión
  const saveBtn = document.getElementById('saveSessionBtn');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      saveSession();
      alert('Sesión guardada correctamente');
    });
  }
});

// --- Arranque embebido (sin FileReader) ---
function startFromEmbedded(content, name){
  // Verificar si hay sesión guardada
  const savedSession = loadSession();
  
  if (savedSession && savedSession.questions && savedSession.questions.length > 0) {
    // Hay sesión guardada: preguntar al usuario
    showSessionDialog(savedSession);
    return;
  }
  
  // No hay sesión guardada: inicio normal
  try {
    logStatus(`Cargando (embebido) "${name||''}"...`);
    const ok = parseAll(content);
    if (!ok){
      alert('No se detectaron preguntas. Revisa el TXT.');
      logStatus('No se detectaron preguntas en el archivo.', true);
      return;
    }
    
    allQuestions = [...questions];
    populateThemeDropdown();
    
    $('#themeSelector').style.display = 'block';
    $('#numberSelector').style.display = 'block';
    $('#quizContainer').style.display = 'block';
    $('#stats').style.display = 'block';
    $('#failedPanel').style.display = 'block';
    
    updateStats();
    startTimer();
    createFailedQuestionsDisplay();
    scrollToQuiz();
    
    logStatus(`Cargado: ${questions.length} preguntas.`);
  } catch(err){
    console.error(err);
    logStatus('Error procesando el archivo.', true);
    alert('Error procesando el archivo. Revisa la consola (F12).');
  }
}

// Carga de archivo
function onFileSelected(e){
  const file = e.target.files?.[0];
  if(!file){ logStatus('No se seleccionó archivo.'); return; }
  
  logStatus(`Leyendo "${file.name}"...`);
  const reader = new FileReader();
  reader.onload = ev => {
    // Verificar si hay sesión guardada
    const savedSession = loadSession();
    
    if (savedSession && savedSession.questions && savedSession.questions.length > 0) {
      // Hay sesión guardada: preguntar al usuario
      showSessionDialog(savedSession);
      return;
    }
    
    // No hay sesión guardada: inicio normal
    try {
      const content = ev.target.result;
      const ok = parseAll(content);
      if (!ok){
        alert('No se detectaron preguntas. Revisa el TXT.');
        logStatus('No se detectaron preguntas en el archivo.', true);
        return;
      }
      
      allQuestions = [...questions];
      populateThemeDropdown();
      
      $('#themeSelector').style.display = 'block';
      $('#numberSelector').style.display = 'block';
      $('#quizContainer').style.display = 'block';
      $('#stats').style.display = 'block';
      $('#failedPanel').style.display = 'block';
      
      updateStats();
      startTimer();
      createFailedQuestionsDisplay();
      
      logStatus(`Cargado: ${questions.length} preguntas.`);
    } catch(err){
      console.error(err);
      logStatus('Error procesando el archivo.', true);
      alert('Error procesando el archivo. Revisa la consola (F12).');
    }
  };
  reader.onerror = () => {
    logStatus('No se pudo leer el archivo.', true);
    alert('No se pudo leer el archivo.');
  };
  reader.readAsText(file);
}

function parseAll(content){
  parseTemario(content);
  parseQuestions(content);
  return questions.length > 0;
}

// ---- Parser Temario
function parseTemario(content){
  temasPorPregunta = {};
  const lines = norm(content).split('\n');
  let currentBloque = '';
  let temaPend = null;
  const temaLinea = /^\s*TEMA\s+(\d+)\.?\s*(.*)$/i;
  const preguntasLinea = /^\s*PREGUNTAS?\s*:?\s*(\d+)\s*[-–—]\s*(\d+)\s*$/i;
  const bloqueLinea = /^\s*BLOQUE\s+\d+.*$/i;
  
  for (let i=0;i<lines.length;i++){
    const l = lines[i];
    if (bloqueLinea.test(l)){ currentBloque = l.trim(); continue; }
    const tM = temaLinea.exec(l);
    if (tM){
      const num = parseInt(tM[1],10);
      const desc = (tM[2]||'').trim();
      temaPend = { bloque: currentBloque, tema: `Tema ${num}${desc?' - '+desc:''}` };
      continue;
    }
    if (temaPend){
      const pM = preguntasLinea.exec(l);
      if (pM){
        const st = parseInt(pM[1],10), end = parseInt(pM[2],10);
        for (let n=st; n<=end; n++){ temasPorPregunta[n] = {...temaPend}; }
        temaPend = null;
      }
    }
  }
}

// ---- Parser Preguntas
function parseQuestions(content){
  questions = [];
  const lines = norm(content).split('\n');
  const idxAnswers = lines.findIndex(l => /RESPUESTAS\s+CORRECTAS\s*:?\s*$/i.test(norm(l)));
  const partQ = idxAnswers >= 0 ? lines.slice(0, idxAnswers) : lines;
  const partA = idxAnswers >= 0 ? lines.slice(idxAnswers+1) : [];
  
  let cur = null;
  const startRegexes = [
    /^\s*PREGUNTA\s*N[ºo°]\s*(\d+)\s*[.\-–—]?\s*(.*)$/i,
    /^\s*(\d+)\s*[.\-–—]\s*(.*)$/
  ];
  const optRegex = /^\s*([a-dA-D])\)\s*(.*)$/;
  
  for (let i=0;i<partQ.length;i++){
    const l = partQ[i].trim();
    if (!l) continue;
    let matched = false;
    for (const rx of startRegexes){
      const m = rx.exec(l);
      if (m){
        if (cur && cur.options.length){ questions.push(cur); }
        cur = { number:parseInt(m[1],10), text:m[2].trim(), options:[], correctAnswer:null, selectedAnswer:null, skipped:false };
        matched = true;
        break;
      }
    }
    if (matched) continue;
    const oM = optRegex.exec(l);
    if (oM && cur){
      cur.options.push(oM[2].trim());
      continue;
    }
    if (cur && !cur.text){ cur.text = l; }
    else if (cur && cur.options.length<4){ cur.options.push(l); }
  }
  if (cur && cur.options.length){ questions.push(cur); }
  
  const answers = {};
  partA.forEach(l => {
    const m = /^\s*(\d+)\s*[.\-–—)]\s*([a-dA-D])\s*$/i.exec(l.trim());
    if (m){ answers[parseInt(m[1],10)] = m[2].toLowerCase(); }
  });
  questions.forEach(q => { if (q.number in answers) q.correctAnswer = (answers[q.number]||'').toLowerCase(); });
}

// --- UI helpers
function populateThemeDropdown(){
  const dd = $('#themeDropdown');
  dd.innerHTML = '';
  const temas = new Map();
  Object.entries(temasPorPregunta).forEach(([num, info]) => {
    if (!info?.tema) return;
    temas.set(info.tema, true);
  });
  const sorted = [...temas.keys()].sort((a,b) => numFromTema(a) - numFromTema(b) || String(a).localeCompare(String(b)));
  sorted.forEach(tema => {
    const opt = document.createElement('option');
    opt.value = tema; opt.textContent = tema;
    dd.appendChild(opt);
  });
}

function toggleSelectAllThemes(all){
  const dd = $('#themeDropdown');
  const opts = Array.from(dd.options);
  // ordenar por número de tema
  const sorted = opts.sort((a,b) => numFromTema(a.value) - numFromTema(b.value) || a.value.localeCompare(b.value));
  // aplicar selección respetando el orden
  sorted.forEach(o => o.selected = all);
  selectedThemes = all ? sorted.map(o => o.value) : [];
  updateSelectedThemesList(); // mostrará orden creciente
}

function updateSelectedThemesList(){
  const ul = $('#selectedThemesList');
  ul.innerHTML = '';
  const sorted = selectedThemes.slice().sort((a,b) => numFromTema(a) - numFromTema(b) || String(a).localeCompare(String(b)));
  sorted.forEach(t => {
    const li = document.createElement('li');
    li.textContent = t; ul.appendChild(li);
  });
}

// Aleatorización: barajar preguntas seleccionadas (no opciones)
function applyThemeSelection(){
  isRetryRun = false; retryRunInitialList = [];
  const dd = $('#themeDropdown');
  selectedThemes = Array.from(dd.selectedOptions).map(o=>o.value);
  updateSelectedThemesList();
  if (!selectedThemes.length){ alert('Selecciona al menos un tema.'); return; }
  
  questions = allQuestions.filter(q => selectedThemes.includes(temasPorPregunta[q.number]?.tema));
  if (!questions.length){ alert('No hay preguntas para los temas elegidos.'); return; }
  
  shuffleInPlace(questions);
  currentQuestionIndex = 0;
  resetQuizState();
  showQuestion();
  scrollToQuiz(); // auto-scroll al iniciar
}

function applyNumberSelection(){
  isRetryRun = false; retryRunInitialList = [];
  const raw = $('#numbersInput').value.trim();
  if (!raw){ alert('Introduce números de pregunta.'); return; }
  
  const nums = raw.split(',').map(s=>parseInt(s.trim(),10)).filter(n=>!isNaN(n));
  questions = allQuestions.filter(q => nums.includes(q.number));
  if (!questions.length){ alert('No hay coincidencias para esos números.'); return; }
  
  shuffleInPlace(questions);
  currentQuestionIndex = 0;
  resetQuizState();
  showQuestion();
  scrollToQuiz(); // auto-scroll al iniciar
}

function resetQuizState(){
  answeredQuestions = 0; score = 0;
  correctAnswersCount = 0; incorrectAnswersCount = 0;
  statsByTopic = {}; currentFailedQuestions = [];
  updateStats();
}

function showQuestion(){
  if (currentQuestionIndex >= questions.length){ showFinalResult(); return; }
  
  const q = questions[currentQuestionIndex];
  $('#questionNumber').textContent = `Pregunta Nº ${q.number}`;
  
  const meta = temasPorPregunta[q.number] || { bloque:'', tema:'Sin tema' };
  $('#questionMeta').innerHTML = `${meta.bloque||''} · ${meta.tema||''}`;
  $('#questionText').textContent = q.text;
  
  const cont = $('#answerOptions'); cont.innerHTML = '';
  // Orden alfabético fijo a), b), c), d)
  q.optionOrder = q.options.map((_,i)=>i); // sin barajar opciones
  q.options.forEach((opt, idx) => {
    const btn = document.createElement('button');
    btn.textContent = opt;
    btn.addEventListener('click', () => selectAnswer(idx));
    cont.appendChild(btn);
  });
  
  // Si ya fue contestada o saltada, mostrar estado previo y bloquear edición
  if (q.selectedAnswer){
    const cont2 = $('#answerOptions');
    const btns2 = cont2.querySelectorAll('button');
    const selectedChar = String(q.selectedAnswer).toLowerCase();
    const correctChar = String(q.correctAnswer||'').toLowerCase();
    btns2.forEach((b,i)=>{
      const optChar = String.fromCharCode(97 + (q.optionOrder?.[i] ?? i));
      if (optChar === selectedChar){ b.classList.add(selectedChar===correctChar?'correct':'incorrect'); }
      if (optChar === correctChar){ b.classList.add('correct'); }
      b.disabled = true;
    });
    $('#feedback').textContent = (selectedChar===correctChar)?'¡Correcto!':(q.correctAnswer?`Incorrecto. La correcta era ${String(q.correctAnswer).toUpperCase()}.`:'');
    $('#nextButton').style.display = 'inline-block';
  } else if (q.skipped){
    $('#answerOptions').querySelectorAll('button').forEach(b=>b.disabled=true);
    $('#feedback').textContent = 'Pregunta saltada. No suma ni resta.';
    $('#nextButton').style.display = 'inline-block';
  } else {
    $('#feedback').textContent = '';
    $('#nextButton').style.display = 'none';
  }
  
  // Auto-guardar al cambiar de pregunta
  saveSession();
}

function selectAnswer(visibleIdx){
  const q = questions[currentQuestionIndex];
  const origIdx = q.optionOrder?.[visibleIdx] ?? visibleIdx;
  const selected = String.fromCharCode(97 + origIdx);
  const isCorrect = String(selected).toLowerCase() === String(q.correctAnswer||'').toLowerCase();
  q.selectedAnswer = selected;
  
  if (!q.correctAnswer){
    $('#feedback').textContent = 'Sin respuesta oficial en el TXT. No computa.';
  } else {
    $('#feedback').textContent = isCorrect ? '¡Correcto!' : `Incorrecto. La correcta era ${q.correctAnswer.toUpperCase()}.`;
  }
  
  answeredQuestions++;
  if (isCorrect) { correctAnswersCount++; score += 1; }
  else { incorrectAnswersCount++; score -= 0.33; if (!currentFailedQuestions.some(p=>p.number===q.number)) currentFailedQuestions.push(q); previousFailedQuestions = [...currentFailedQuestions]; }
  
  updateFailedQuestionsDisplay();
  updateStats();
  
  const cont = $('#answerOptions');
  const btns = cont.querySelectorAll('button');
  const correctIdx = q.optionOrder.findIndex(i => String.fromCharCode(97+i) === String(q.correctAnswer).toLowerCase());
  btns.forEach((b,i)=>{
    if (i === visibleIdx) b.classList.add(isCorrect ? 'correct':'incorrect');
    if (i === correctIdx) b.classList.add('correct');
    b.disabled = true;
  });
  
  $('#nextButton').style.display = 'inline-block';
  
  // Guardar después de contestar
  saveSession();
}

function showNextQuestion(){ 
  currentQuestionIndex++; 
  showQuestion(); 
}

function prevQuestion(){ 
  if (currentQuestionIndex>0){ 
    currentQuestionIndex--; 
    showQuestion(); 
  } 
}

function updateStats(){
  $('#totalQuestions').textContent = questions.length;
  $('#answeredCount').textContent = answeredQuestions;
  $('#remainingCount').textContent = Math.max(0, questions.length-answeredQuestions);
  $('#correctCount').textContent = correctAnswersCount;
  $('#incorrectCount').textContent = incorrectAnswersCount;
  $('#score').textContent = score.toFixed(2);
}

function showFinalResult(){
  alert(`Test finalizado.\nPuntuación: ${score.toFixed(2)}\nAciertos: ${correctAnswersCount}\nFallos: ${incorrectAnswersCount}`);
  // Limpiar sesión guardada al finalizar
  clearSession();
}

function showStats(){
  const tbody = $('#statsTable tbody'); tbody.innerHTML='';
  // Solo estadísticas de preguntas que YA han aparecido hasta el momento
  const presented = questions.slice(0, Math.min(currentQuestionIndex + 1, questions.length));
  const map = {};
  
  presented.forEach(q => {
    const tema = (temasPorPregunta[q.number]?.tema) || 'Sin tema';
    if (!map[tema]) map[tema] = { total:0, correct:0, incorrect:0 };
    map[tema].total++;
    if (q.selectedAnswer){
      if (String(q.selectedAnswer).toLowerCase() === String(q.correctAnswer||'').toLowerCase()) map[tema].correct++;
      else map[tema].incorrect++;
    }
  });
  
  // Orden creciente por nº de tema y SOLO los temas que han aparecido
  const rows = Object.entries(map)
    .filter(([tema, st]) => st.total > 0)
    .sort((a,b) => {
      const na = (String(a[0]).match(/tema\s+(\d+)/i)||[0,Infinity])[1];
      const nb = (String(b[0]).match(/tema\s+(\d+)/i)||[0,Infinity])[1];
      const pa = isFinite(+na) ? +na : Number.POSITIVE_INFINITY;
      const pb = isFinite(+nb) ? +nb : Number.POSITIVE_INFINITY;
      if (pa !== pb) return pa - pb;
      return String(a[0]).localeCompare(String(b[0]));
    });
  
  rows.forEach(([tema, st]) => {
    const pct = st.total ? Math.round((st.correct/st.total)*100) : 0;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${tema}</td><td>${st.total}</td><td>${st.correct}</td><td>${st.incorrect}</td><td>${pct}%</td>`;
    tbody.appendChild(tr);
  });
  
  $('#statsModal').style.display = 'flex';
}

function closeStats(){ $('#statsModal').style.display = 'none'; }

function createFailedQuestionsDisplay(){
  const panel = $('#failedPanel'); panel.style.display='block';
  updateFailedQuestionsDisplay();
}

function updateFailedQuestionsDisplay(){
  const cont = $('#failedQuestionsDisplay');
  if (!cont) return;
  
  // elegir lista a mostrar: si estamos en retry, mostrar SIEMPRE el snapshot inicial
  let numbers = [];
  if (isRetryRun && retryRunInitialList.length){
    numbers = retryRunInitialList.slice();
  } else if (Array.isArray(previousFailedQuestions) && previousFailedQuestions.length){
    numbers = previousFailedQuestions.map(q => q.number);
  }
  
  numbers = numbers.filter(n => typeof n === 'number' && !Number.isNaN(n)).sort((a,b)=>a-b);
  cont.innerHTML = numbers.length
    ? `<p>Preguntas falladas en el intento anterior: <strong>${numbers.join(', ')}</strong></p>
       <button id="restartFailedBtn">Reiniciar SOLO con estas</button>`
    : `<p>No hay preguntas falladas en intentos anteriores.</p>`;
  
  document.getElementById('restartFailedBtn')?.addEventListener('click', () => {
    // Fijar snapshot y activar retry
    if (Array.isArray(previousFailedQuestions) && previousFailedQuestions.length){
      retryRunInitialList = previousFailedQuestions
        .map(q=>q.number)
        .filter(n=>typeof n==='number' && !Number.isNaN(n))
        .sort((a,b)=>a-b);
    } else {
      retryRunInitialList = [];
    }
    isRetryRun = true;
    
    // Clonar "en limpio" las preguntas falladas para NO arrastrar respuestas ni estados
    questions = previousFailedQuestions.map(q => ({
      number: q.number,
      text: q.text,
      options: Array.isArray(q.options) ? q.options.slice() : [],
      correctAnswer: (q.correctAnswer || '').toLowerCase(),
      selectedAnswer: null,
      skipped: false,
      optionOrder: null,
      answered: false
    }));
    
    // Aleatorizar el orden de las preguntas (no las opciones)
    if (typeof shuffleInPlace === 'function') {
      shuffleInPlace(questions);
    } else if (Array.isArray(questions)) {
      // fallback simple
      for (let i = questions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [questions[i], questions[j]] = [questions[j], questions[i]];
      }
    }
    
    // Reinicio total
    currentQuestionIndex = 0;
    if (typeof resetQuizState === 'function') resetQuizState(); // estadísticas, puntuación, falladas en curso
    if (typeof startTimer === 'function') startTimer(); // reinicia el cronómetro
    
    // Pintar primera pregunta y mantener visible el snapshot de falladas
    if (typeof showQuestion === 'function') showQuestion();
    if (typeof updateFailedQuestionsDisplay === 'function') updateFailedQuestionsDisplay();
    if (typeof scrollToQuiz === 'function') scrollToQuiz();
  });
}

// Timer
function startTimer(){
  startTime = Date.now();
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const diff = Date.now()-startTime;
    const h = Math.floor(diff/3600000);
    const m = Math.floor((diff%3600000)/60000);
    const s = Math.floor((diff%60000)/1000);
    $('#timer').textContent = `Tiempo transcurrido: ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }, 1000);
}

})();

// === Persistencia mínima para tamaños (opcional) ===
(function(){
const LS_KEY = "quizTypographyPrefs.v1"; // solo tamaños y flag persist
function byId(id){ return document.getElementById(id); }
function setVar(name, value){ document.documentElement.style.setProperty(name, value); }

function loadPrefs(){
  try{ return JSON.parse(localStorage.getItem(LS_KEY)||"{}"); }catch(e){ return {}; }
}

function savePrefs(obj){
  try{ localStorage.setItem(LS_KEY, JSON.stringify(obj)); }catch(e){}
}

function clearPrefs(){
  try{ localStorage.removeItem(LS_KEY); }catch(e){}
}

function initPersist(){
  const q = byId('qFontSize');
  const o = byId('optFontSize');
  const qv = byId('qFontSizeValue');
  const ov = byId('optFontSizeValue');
  const persistSel = byId('persistTypography');
  
  // Defaults
  const defaults = { persist:'off', q:22, o:18 };
  
  // Cargamos
  const stored = loadPrefs();
  const persistMode = stored.persist || defaults.persist;
  
  // Si hay persistencia ON, aplicar tamaños guardados si existen
  let qSize = defaults.q, oSize = defaults.o;
  if(persistMode === 'on'){
    if(typeof stored.q === 'number') qSize = stored.q;
    if(typeof stored.o === 'number') oSize = stored.o;
  }
  
  // Aplicar a UI y CSS vars
  if(q){ q.value = qSize; if(qv) qv.textContent = qSize; setVar('--q-font-size', qSize+'px'); }
  if(o){ o.value = oSize; if(ov) ov.textContent = oSize; setVar('--opt-font-size', oSize+'px'); }
  if(persistSel){ persistSel.value = persistMode; }
  
  function handleSizeChange(kind, value){
    // Actualiza CSS var en caliente
    if(kind==='q'){ setVar('--q-font-size', value+'px'); if(qv) qv.textContent = value; }
    if(kind==='o'){ setVar('--opt-font-size', value+'px'); if(ov) ov.textContent = value; }
    
    // Guardar solo si persist está ON
    const mode = (persistSel && persistSel.value) || 'off';
    if(mode === 'on'){
      const cur = loadPrefs();
      cur.persist = 'on';
      if(kind==='q') cur.q = value;
      if(kind==='o') cur.o = value;
      savePrefs(cur);
    }
  }
  
  if(q){
    q.addEventListener('input', (e)=>{
      const v = parseInt(e.target.value,10);
      handleSizeChange('q', v);
    });
  }
  
  if(o){
    o.addEventListener('input', (e)=>{
      const v = parseInt(e.target.value,10);
      handleSizeChange('o', v);
    });
  }
  
  if(persistSel){
    persistSel.addEventListener('change', (e)=>{
      const mode = e.target.value; // 'on' | 'off'
      if(mode === 'off'){
        // Borramos almacenado y dejamos los valores visibles solo para esta sesión
        clearPrefs();
      }else if(mode === 'on'){
        // Guardamos el estado actual
        const cur = loadPrefs();
        cur.persist = 'on';
        cur.q = q ? parseInt(q.value,10) : defaults.q;
        cur.o = o ? parseInt(o.value,10) : defaults.o;
        savePrefs(cur);
      }
    });
    
    // Limpiar al salir si está OFF (garantiza arranque por defecto)
    window.addEventListener('beforeunload', ()=>{
      if(persistSel.value !== 'on') clearPrefs();
    });
  }
}

if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded', initPersist);
}else{
  initPersist();
}

})();

// === Opciones avanzadas (opt-in, sin tocar tu lógica) ===
(function(){
const $ = (sel)=>document.querySelector(sel);
function on(el, ev, fn){ if(el) el.addEventListener(ev, fn); }

function applyColumns(v){
  const wrap = document.getElementById('answerOptions');
  if(!wrap) return;
  if(String(v)==='2') wrap.classList.add('cols-2'); else wrap.classList.remove('cols-2');
}

function applyBtnPadding(v){
  document.body.classList.toggle('btnpad-custom', true);
  document.documentElement.style.setProperty('--btn-pad', String(v)+'px');
  const lab = $('#btnPaddingValue'); if(lab) lab.textContent = String(v);
}

function applyTheme(preset){
  document.body.classList.remove('theme-dark','theme-contrast','use-theme-vars');
  if(preset==='dark'){ document.body.classList.add('use-theme-vars','theme-dark'); }
  else if(preset==='contrast'){ document.body.classList.add('use-theme-vars','theme-contrast'); }
  // 'off' => no classes => estilo original intacto
}

function applyTimer(v){
  document.body.classList.toggle('hide-timer', v==='hide');
}

function setupShortcuts(onoff){
  const handler = (ev)=>{
    const key = (ev.key||'').toLowerCase();
    if(['a','b','c','d','enter'].includes(key)){
      const options = Array.from(document.querySelectorAll('#answerOptions button')).slice(0,4);
      if(['a','b','c','d'].includes(key)){
        const idx = {a:0,b:1,c:2,d:3}[key];
        if(options[idx]){ options[idx].click(); ev.preventDefault(); }
      }else if(key==='enter'){
        const btn = document.querySelector('[data-next],#next,#nextQuestion,button.next,button[data-action="next"]') ||
          Array.from(document.querySelectorAll('button')).find(b=>(b.textContent||'').trim().toLowerCase()==='siguiente');
        if(btn){ btn.click(); ev.preventDefault(); }
      }
    }
  };
  
  if(onoff==='on'){
    document.addEventListener('keydown', handler, true);
    // Guardar referencia para poder quitarlo si cambian a 'off'
    document._kbdHandler = handler;
  }else{
    if(document._kbdHandler){ document.removeEventListener('keydown', document._kbdHandler, true); document._kbdHandler = null; }
  }
}

function autoNextSetup(onoff, delay){
  const wrap = document.getElementById('answerOptions');
  if(!wrap) return;
  if(wrap._autoNextAttached) wrap.removeEventListener('click', wrap._autoNextAttached, true);
  if(onoff!=='on') return;
  
  const fn = (ev)=>{
    const btn = ev.target && ev.target.closest('button'); if(!btn) return;
    setTimeout(()=>{
      const nx = document.querySelector('[data-next],#next,#nextQuestion,button.next,button[data-action="next"]') ||
        Array.from(document.querySelectorAll('button')).find(b=>(b.textContent||'').trim().toLowerCase()==='siguiente');
      if(nx) nx.click();
    }, parseInt(delay||0,10) || 0);
  };
  wrap.addEventListener('click', fn, true);
  wrap._autoNextAttached = fn;
}

function rememberThemesSetup(onoff){
  const root = document.getElementById('themeSelector');
  if(!root) return;
  const KEY = 'quiz.selectedThemes.v1';
  if(root._rememberAttached) root.removeEventListener('change', root._rememberAttached);
  if(onoff!=='on') return;
  
  const fn = ()=>{
    const checked = Array.from(root.querySelectorAll('input[type="checkbox"]:checked, option:checked')).map(el=>el.value);
    try{ localStorage.setItem(KEY, JSON.stringify(checked)); }catch(e){}
  };
  root.addEventListener('change', fn);
  root._rememberAttached = fn;
  
  try{
    const saved = JSON.parse(localStorage.getItem(KEY)||"[]");
    saved.forEach(v=>{
      const cb = root.querySelector(`input[type="checkbox"][value="${CSS.escape(v)}"]`);
      if(cb) cb.checked = true;
      const opt = root.querySelector(`option[value="${CSS.escape(v)}"]`);
      if(opt) opt.selected = true;
    });
  }catch(e){}
}

function init(){
  const col = $('#optColumns'); on(col,'change', e=>applyColumns(e.target.value));
  const bp = $('#btnPadding'); on(bp,'input', e=>applyBtnPadding(parseInt(e.target.value,10)));
  if(bp) applyBtnPadding(parseInt(bp.value,10));
  on(bp,'change', e=>applyBtnPadding(parseInt(e.target.value,10)));
  if(bp){ const lab = $('#btnPaddingValue'); if(lab) lab.textContent = String(bp.value); }
  
  const th = $('#themePreset'); on(th,'change', e=>applyTheme(e.target.value));
  const ks = $('#kbdShortcuts'); on(ks,'change', e=>setupShortcuts(e.target.value));
  
  const an = $('#autoNext');
  const ad = $('#autoNextDelay');
  on(an,'change', ()=>autoNextSetup(an.value, ad ? ad.value : 0));
  on(ad,'input', ()=>{
    const lab = $('#autoNextDelayValue'); if(lab) lab.textContent = String(ad.value);
    autoNextSetup(an ? an.value : 'off', ad.value);
  });
  
  const tt = $('#toggleTimer'); on(tt,'change', e=>applyTimer(e.target.value));
  const rth = $('#rememberThemes'); on(rth,'change', e=>rememberThemesSetup(e.target.value));
  
  // Inicial: estado "neutral" (no cambia nada). Los listeners activan los cambios.
}

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init);
else init();

})();

// === Persistencia de TODA la configuración (mínimo) ===
(function(){
const LS_KEY_ALL = "quizAppPrefs.v1"; // almacena todos los ajustes
const $ = (s)=>document.querySelector(s);

const defaults = {
  persist: 'off', // 'on'|'off'
  q: 22, // tamaño enunciado
  o: 18, // tamaño opciones
  optColumns: '1', // '1'|'2'
  btnPadding: 10, // px
  themePreset: 'off', // 'off'|'dark'|'contrast'
  kbdShortcuts: 'off', // 'off'|'on'
  autoNext: 'off', // 'off'|'on'
  autoNextDelay: 0, // ms
  toggleTimer: 'show', // 'show'|'hide'
  rememberThemes: 'off' // 'off'|'on'
};

function loadAll(){
  try{ return Object.assign({}, defaults, JSON.parse(localStorage.getItem(LS_KEY_ALL)||"{}")); }
  catch(e){ return Object.assign({}, defaults); }
}

function saveAll(obj){
  try{ localStorage.setItem(LS_KEY_ALL, JSON.stringify(obj)); }catch(e){}
}

function clearAll(){
  try{ localStorage.removeItem(LS_KEY_ALL); }catch(e){}
}

function setVar(name, value){ document.documentElement.style.setProperty(name, value); }

function setSel(id, val){
  const el = document.getElementById(id);
  if(el){ el.value = String(val); }
}

function setRange(id, val, labelId){
  const el = document.getElementById(id);
  if(el){ el.value = String(val); }
  const lab = labelId && document.getElementById(labelId);
  if(lab){ lab.textContent = String(val); }
}

function dispatch(id, type){
  const el = document.getElementById(id);
  if(!el) return;
  const ev = new Event(type, {bubbles:true});
  el.dispatchEvent(ev);
}

function applyToUI(p){
  // Tipografías
  setRange('qFontSize', p.q, 'qFontSizeValue'); setVar('--q-font-size', p.q + 'px');
  setRange('optFontSize', p.o, 'optFontSizeValue'); setVar('--opt-font-size', p.o + 'px');
  
  // Avanzadas
  setSel('optColumns', p.optColumns);
  setRange('btnPadding', p.btnPadding, 'btnPaddingValue');
  setSel('themePreset', p.themePreset);
  setSel('kbdShortcuts', p.kbdShortcuts);
  setSel('autoNext', p.autoNext);
  setRange('autoNextDelay', p.autoNextDelay, 'autoNextDelayValue');
  setSel('toggleTimer', p.toggleTimer);
  setSel('rememberThemes', p.rememberThemes);
  setSel('persistAll', p.persist);
}

function triggerExistingHandlers(){
  // Dispara eventos para que los módulos ya añadidos apliquen los cambios
  dispatch('qFontSize','input');
  dispatch('optFontSize','input');
  dispatch('optColumns','change');
  dispatch('btnPadding','input');
  dispatch('themePreset','change');
  dispatch('kbdShortcuts','change');
  dispatch('autoNext','change');
  dispatch('autoNextDelay','input');
  dispatch('toggleTimer','change');
  dispatch('rememberThemes','change');
}

function collectFromUI(){
  const gv = (id, fallback)=>{
    const el = document.getElementById(id);
    if(!el) return fallback;
    if(el.type === 'range'){ return parseInt(el.value,10); }
    return el.value;
  };
  
  return {
    persist: gv('persistAll', defaults.persist),
    q: gv('qFontSize', defaults.q),
    o: gv('optFontSize', defaults.o),
    optColumns: String(gv('optColumns', defaults.optColumns)),
    btnPadding: gv('btnPadding', defaults.btnPadding),
    themePreset: gv('themePreset', defaults.themePreset),
    kbdShortcuts: gv('kbdShortcuts', defaults.kbdShortcuts),
    autoNext: gv('autoNext', defaults.autoNext),
    autoNextDelay: gv('autoNextDelay', defaults.autoNextDelay),
    toggleTimer: gv('toggleTimer', defaults.toggleTimer),
    rememberThemes: gv('rememberThemes', defaults.rememberThemes)
  };
}

function attachSaving(){
  const ids = ['qFontSize','optFontSize','optColumns','btnPadding','themePreset','kbdShortcuts','autoNext','autoNextDelay','toggleTimer','rememberThemes','persistAll'];
  ids.forEach(id=>{
    const el = document.getElementById(id);
    if(!el) return;
    const evt = (el.tagName==='INPUT' && el.type==='range') ? 'input' : 'change';
    el.addEventListener(evt, ()=>{
      const all = collectFromUI();
      if(all.persist === 'on') saveAll(all);
    });
  });
  
  // Limpieza al salir si no está ON
  window.addEventListener('beforeunload', ()=>{
    const all = collectFromUI();
    if(all.persist !== 'on') clearAll();
  });
}

function init(){
  const all = loadAll();
  applyToUI(all);
  
  // Asegura que el select global exista (compatibilidad con versiones previas que tenían persistTypography)
  const oldPersist = document.getElementById('persistTypography');
  if(oldPersist && !document.getElementById('persistAll')){
    oldPersist.id = 'persistAll';
    const lab = oldPersist.closest('div')?.querySelector('label.label');
    if(lab) lab.textContent = 'Guardar configuración (toda la app)';
  }
  
  triggerExistingHandlers();
  attachSaving();
}

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init);
else init();

})();
