/* ═══════════════════════════════════════════════════════════════════════
   script.js  –  Real-Time CPU Scheduling Simulator
   Subject : CS25C11 – Operating Systems
   Covers  : FCFS · SJF · SRTF · Priority · Round Robin
   ═══════════════════════════════════════════════════════════════════════ */

"use strict";

/* ══════════════════════════════════════════════════════════════════════
   SECTION 1 : GLOBAL STATE
   ══════════════════════════════════════════════════════════════════════ */

/** @type {Array<{pid:string,arrival:number,burst:number,priority:number,state:string,color:number}>} */
let processes = [];           // All user-defined processes (the PCB list)

let simInterval  = null;      // setInterval handle for the main simulation loop
let simRunning   = false;     // Is simulation actively ticking?
let simPaused    = false;     // Is simulation paused?
let currentTick  = 0;         // Current simulation time unit
let ganttData    = [];        // Array of {pid, start, end} for Gantt chart
let simSchedule  = [];        // Full precomputed or tick-by-tick schedule (array of pids per tick)
let resultMetrics = [];       // Per-process metrics after simulation completes

/* Process-colour palette length (must match CSS .p-color-N count) */
const COLOR_COUNT = 10;

/* Process states (mimics real PCB states) */
const STATE = { NEW: "new", READY: "ready", RUNNING: "running", WAITING: "waiting", TERMINATED: "terminated" };

/* ══════════════════════════════════════════════════════════════════════
   SECTION 2 : DOM ELEMENT REFERENCES
   ══════════════════════════════════════════════════════════════════════ */
const $  = id => document.getElementById(id);

const dom = {
  pid:          $("pid"),
  arrival:      $("arrivalTime"),
  burst:        $("burstTime"),
  priority:     $("priority"),
  formError:    $("formError"),
  simError:     $("simError"),
  addBtn:       $("addProcessBtn"),
  randomBtn:    $("randomBtn"),
  clearBtn:     $("clearAllBtn"),
  presetSelect: $("presetSelect"),
  algorithm:    $("algorithm"),
  quantum:      $("quantum"),
  quantumGroup: $("quantumGroup"),
  speed:        $("speed"),
  startBtn:     $("startBtn"),
  pauseBtn:     $("pauseBtn"),
  resumeBtn:    $("resumeBtn"),
  resetBtn:     $("resetBtn"),
  tableBody:    $("processTableBody"),
  emptyRow:     $("emptyRow"),
  cpuProcess:   $("cpuProcess"),
  cpuTimer:     $("cpuTimer"),
  readyQueue:   $("readyQueue"),
  ganttChart:   $("ganttChart"),
  ganttTimeline:$("ganttTimeline"),
  ganttEmpty:   $("ganttEmpty"),
  ganttContainer:$("ganttContainer"),
  resultsCard:  $("resultsCard"),
  resultsBody:  $("resultsBody"),
  averages:     $("averages"),
  compareBtn:   $("compareBtn"),
  compareResult:$("compareResult"),
  compareChart: $("compareChart"),
  recommendation:$("recommendation"),
  themeToggle:  $("themeToggle"),
};

/* ══════════════════════════════════════════════════════════════════════
   SECTION 3 : THEME TOGGLE
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Toggles between dark and light themes by flipping the
 * data-theme attribute on <html>.
 */
function toggleTheme() {
  const html = document.documentElement;
  const isDark = html.getAttribute("data-theme") === "dark";
  html.setAttribute("data-theme", isDark ? "light" : "dark");
  dom.themeToggle.textContent = isDark ? "🌞" : "🌙";
}

dom.themeToggle.addEventListener("click", toggleTheme);

/* ══════════════════════════════════════════════════════════════════════
   SECTION 4 : ALGORITHM SELECTOR  (show/hide quantum)
   ══════════════════════════════════════════════════════════════════════ */
dom.algorithm.addEventListener("change", () => {
  dom.quantumGroup.style.display = dom.algorithm.value === "RR" ? "block" : "none";
});

/* ══════════════════════════════════════════════════════════════════════
   SECTION 5 : INPUT VALIDATION & PROCESS MANAGEMENT
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Shows an error message in the form error div.
 * @param {string} msg
 */
function showFormError(msg) {
  dom.formError.textContent = msg;
  setTimeout(() => { dom.formError.textContent = ""; }, 3000);
}

/**
 * Validates all form fields and returns a process object or null.
 * @returns {{pid:string,arrival:number,burst:number,priority:number}|null}
 */
function validateForm() {
  const pid      = dom.pid.value.trim();
  const arrival  = parseInt(dom.arrival.value);
  const burst    = parseInt(dom.burst.value);
  const priority = parseInt(dom.priority.value);

  if (!pid)                      { showFormError("❌ Process ID cannot be empty."); return null; }
  if (processes.some(p => p.pid === pid))
                                 { showFormError(`❌ PID "${pid}" already exists.`); return null; }
  if (isNaN(arrival) || arrival < 0)
                                 { showFormError("❌ Arrival Time must be ≥ 0."); return null; }
  if (isNaN(burst)   || burst   < 1)
                                 { showFormError("❌ Burst Time must be ≥ 1."); return null; }
  if (isNaN(priority) || priority < 1)
                                 { showFormError("❌ Priority must be ≥ 1."); return null; }

  return { pid, arrival, burst, priority };
}

/**
 * Adds a new process to the global list and re-renders the table.
 */
function addProcess() {
  const p = validateForm();
  if (!p) return;

  processes.push({
    ...p,
    state: STATE.NEW,
    color: processes.length % COLOR_COUNT,
  });

  clearForm();
  renderProcessTable();
  dom.formError.textContent = "";
}

/** Clears all form input fields. */
function clearForm() {
  dom.pid.value = dom.arrival.value = dom.burst.value = dom.priority.value = "";
  dom.pid.focus();
}

/**
 * Removes a process by PID.
 * @param {string} pid
 */
function removeProcess(pid) {
  processes = processes.filter(p => p.pid !== pid);
  renderProcessTable();
}

/**
 * Generates 4-6 random processes for quick demo use.
 */
function generateRandom() {
  processes = [];
  const count = Math.floor(Math.random() * 3) + 4;  // 4-6 processes
  for (let i = 1; i <= count; i++) {
    processes.push({
      pid:      `P${i}`,
      arrival:  Math.floor(Math.random() * 8),
      burst:    Math.floor(Math.random() * 10) + 1,
      priority: Math.floor(Math.random() * 5) + 1,
      state:    STATE.NEW,
      color:    (i - 1) % COLOR_COUNT,
    });
  }
  renderProcessTable();
}

/** Clears all processes from the list. */
function clearAll() {
  if (simRunning) return;
  processes = [];
  if (dom.presetSelect) dom.presetSelect.value = "";
  renderProcessTable();
  resetSimulation();
}

/** Pre-configured application workloads for demonstration & benchmark */
const PRESETS = {
  textbook: {
    name: "Classic OS Benchmark (Silberschatz / Galvin)",
    algorithm: "RR",
    quantum: 2,
    processes: [
      { pid: "P1", arrival: 0, burst: 8, priority: 3 },
      { pid: "P2", arrival: 1, burst: 4, priority: 1 },
      { pid: "P3", arrival: 2, burst: 9, priority: 4 },
      { pid: "P4", arrival: 3, burst: 5, priority: 2 }
    ]
  },
  desktop: {
    name: "Interactive Desktop / Time-Sharing",
    algorithm: "RR",
    quantum: 2,
    processes: [
      { pid: "P1", arrival: 0, burst: 8, priority: 3 }, // Web Browser
      { pid: "P2", arrival: 1, burst: 4, priority: 2 }, // Text Editor
      { pid: "P3", arrival: 2, burst: 7, priority: 4 }, // Music Player
      { pid: "P4", arrival: 3, burst: 5, priority: 3 }  // Background Sync
    ]
  },
  convoy: {
    name: "Batch Processing & Convoy Effect",
    algorithm: "FCFS",
    processes: [
      { pid: "P1", arrival: 0, burst: 18, priority: 3 }, // Large Batch Job
      { pid: "P2", arrival: 1, burst: 2,  priority: 1 }, // Quick I/O
      { pid: "P3", arrival: 2, burst: 1,  priority: 2 }, // Health Ping
      { pid: "P4", arrival: 3, burst: 3,  priority: 2 }  // Status Check
    ]
  },
  srtf: {
    name: "Preemption Showcase (SRTF)",
    algorithm: "SRTF",
    processes: [
      { pid: "P1", arrival: 0, burst: 10, priority: 3 }, // Long task
      { pid: "P2", arrival: 2, burst: 3,  priority: 2 }, // Preempts P1
      { pid: "P3", arrival: 4, burst: 1,  priority: 1 }, // Preempts P2
      { pid: "P4", arrival: 6, burst: 4,  priority: 2 }  // Standard task
    ]
  },
  realtime: {
    name: "Real-Time & Kernel Tasks (Priority)",
    algorithm: "PRIORITY",
    processes: [
      { pid: "P1", arrival: 2, burst: 2,  priority: 1 }, // Hardware Interrupt
      { pid: "P2", arrival: 0, burst: 6,  priority: 2 }, // UI Compositor
      { pid: "P3", arrival: 0, burst: 8,  priority: 4 }, // File Download
      { pid: "P4", arrival: 1, burst: 12, priority: 5 }  // Antivirus Scan
    ]
  }
};

/**
 * Loads a workload preset into the process table and selects its recommended algorithm.
 * @param {string} presetKey
 */
function loadPreset(presetKey) {
  if (simRunning) return;
  const preset = PRESETS[presetKey];
  if (!preset) return;

  processes = preset.processes.map((p, idx) => ({
    ...p,
    state: STATE.NEW,
    color: idx % COLOR_COUNT,
  }));

  if (preset.algorithm && dom.algorithm) {
    dom.algorithm.value = preset.algorithm;
    if (preset.quantum && dom.quantum) {
      dom.quantum.value = preset.quantum;
    }
    dom.algorithm.dispatchEvent(new Event("change"));
  }

  renderProcessTable();
  resetSimulation();
  dom.formError.textContent = "";
}

/* ──────────────────────────── RENDER PROCESS TABLE ──────────────────────────── */

/**
 * Re-renders the process table from the global `processes` array.
 * Each row shows PID, arrival, burst, priority, state badge, and a delete button.
 */
function renderProcessTable() {
  const tbody = dom.tableBody;
  tbody.innerHTML = "";

  if (processes.length === 0) {
    tbody.innerHTML = `<tr id="emptyRow"><td colspan="6" class="empty-msg">No processes added yet.</td></tr>`;
    return;
  }

  processes.forEach(p => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${p.pid}</strong></td>
      <td>${p.arrival}</td>
      <td>${p.burst}</td>
      <td>${p.priority}</td>
      <td><span class="state-badge state-${p.state}">${p.state}</span></td>
      <td><button class="btn-del" onclick="removeProcess('${p.pid}')" ${simRunning ? "disabled" : ""}>✕</button></td>
    `;
    tbody.appendChild(tr);
  });
}

/* ──────────────────────────── EVENT LISTENERS ──────────────────────────── */
dom.addBtn.addEventListener("click",    addProcess);
dom.randomBtn.addEventListener("click", generateRandom);
dom.clearBtn.addEventListener("click",  clearAll);
if (dom.presetSelect) {
  dom.presetSelect.addEventListener("change", e => {
    if (e.target.value) {
      loadPreset(e.target.value);
    }
  });
}

// Allow pressing Enter in PID field to submit
dom.pid.addEventListener("keydown", e => { if (e.key === "Enter") addProcess(); });

/* ══════════════════════════════════════════════════════════════════════
   SECTION 6 : SCHEDULING ALGORITHMS
   Each algorithm receives a deep copy of processes and returns:
     schedule[] → array of string (pid or "IDLE") for each time unit
     metrics[]  → {pid, completion, turnaround, waiting, response}
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Deep-copies the process list so algorithms don't mutate global state.
 * @returns {Array}
 */
function deepCopy(arr) {
  return JSON.parse(JSON.stringify(arr));
}

/* ──────────────────────────── FCFS ──────────────────────────── */
/**
 * First Come First Served (non-preemptive).
 * Processes execute in arrival order; ties broken by PID index.
 * @param {Array} procs - Original process list
 * @returns {{schedule:string[], metrics:Array}}
 */
function scheduleFCFS(procs) {
  const ps = deepCopy(procs).sort((a, b) => a.arrival - b.arrival || procs.indexOf(a) - procs.indexOf(b));
  const schedule = [];
  const metrics  = [];
  let time = 0;

  for (const p of ps) {
    if (time < p.arrival) {
      // CPU is idle until this process arrives
      for (let t = time; t < p.arrival; t++) schedule.push("IDLE");
      time = p.arrival;
    }
    const start = time;
    for (let t = 0; t < p.burst; t++) schedule.push(p.pid);
    time += p.burst;
    metrics.push({ pid: p.pid, completion: time, response: start - p.arrival,
                   turnaround: time - p.arrival, waiting: start - p.arrival });
  }
  return { schedule, metrics };
}

/* ──────────────────────────── SJF (Non-Preemptive) ──────────────────────────── */
/**
 * Shortest Job First – non-preemptive.
 * At each idle decision point, picks the arrived process with shortest burst.
 * @param {Array} procs
 * @returns {{schedule:string[], metrics:Array}}
 */
function scheduleSJF(procs) {
  const ps = deepCopy(procs);
  const schedule = [];
  const metrics  = [];
  let time = 0;
  const done = new Set();

  while (done.size < ps.length) {
    // Available processes: arrived and not yet done
    const ready = ps.filter(p => p.arrival <= time && !done.has(p.pid))
                    .sort((a, b) => a.burst - b.burst || a.arrival - b.arrival);

    if (ready.length === 0) {
      schedule.push("IDLE");
      time++;
      continue;
    }

    const p = ready[0];
    const start = time;
    for (let t = 0; t < p.burst; t++) schedule.push(p.pid);
    time += p.burst;
    done.add(p.pid);
    metrics.push({ pid: p.pid, completion: time, response: start - p.arrival,
                   turnaround: time - p.arrival, waiting: start - p.arrival });
  }
  return { schedule, metrics };
}

/* ──────────────────────────── SRTF (Preemptive SJF) ──────────────────────────── */
/**
 * Shortest Remaining Time First – preemptive.
 * Every tick, the process with the least remaining burst time is chosen.
 * @param {Array} procs
 * @returns {{schedule:string[], metrics:Array}}
 */
function scheduleSRTF(procs) {
  const ps = deepCopy(procs).map(p => ({ ...p, remaining: p.burst, startTime: -1 }));
  const schedule = [];
  const metrics  = [];
  let time = 0;
  let done = 0;
  const totalBurst = ps.reduce((s, p) => s + p.burst, 0);
  const maxTime = ps.reduce((s, p) => s + p.burst, 0) + ps.reduce((m, p) => Math.max(m, p.arrival), 0);

  while (done < ps.length && schedule.length <= maxTime) {
    const ready = ps.filter(p => p.arrival <= time && p.remaining > 0)
                    .sort((a, b) => a.remaining - b.remaining || a.arrival - b.arrival);

    if (ready.length === 0) {
      schedule.push("IDLE");
      time++;
      continue;
    }

    const p = ready[0];
    if (p.startTime === -1) p.startTime = time;    // Record first time on CPU
    schedule.push(p.pid);
    p.remaining--;
    time++;

    if (p.remaining === 0) {
      done++;
      metrics.push({
        pid: p.pid,
        completion: time,
        turnaround: time - p.arrival,
        waiting:    time - p.arrival - p.burst,
        response:   p.startTime - p.arrival,
      });
    }
  }
  return { schedule, metrics };
}

/* ──────────────────────────── PRIORITY (Non-Preemptive) ──────────────────────────── */
/**
 * Non-preemptive Priority Scheduling.
 * Lower priority number = higher priority (convention used here).
 * @param {Array} procs
 * @returns {{schedule:string[], metrics:Array}}
 */
function schedulePriority(procs) {
  const ps = deepCopy(procs);
  const schedule = [];
  const metrics  = [];
  let time = 0;
  const done = new Set();

  while (done.size < ps.length) {
    const ready = ps.filter(p => p.arrival <= time && !done.has(p.pid))
                    .sort((a, b) => a.priority - b.priority || a.arrival - b.arrival);

    if (ready.length === 0) {
      schedule.push("IDLE");
      time++;
      continue;
    }

    const p = ready[0];
    const start = time;
    for (let t = 0; t < p.burst; t++) schedule.push(p.pid);
    time += p.burst;
    done.add(p.pid);
    metrics.push({ pid: p.pid, completion: time, response: start - p.arrival,
                   turnaround: time - p.arrival, waiting: start - p.arrival });
  }
  return { schedule, metrics };
}

/* ──────────────────────────── ROUND ROBIN ──────────────────────────── */
/**
 * Round Robin scheduling with a user-defined time quantum.
 * Processes that haven't finished are re-added to the end of the ready queue.
 * @param {Array} procs
 * @param {number} quantum - Time slice in units
 * @returns {{schedule:string[], metrics:Array}}
 */
function scheduleRR(procs, quantum) {
  const ps = deepCopy(procs).map(p => ({ ...p, remaining: p.burst, startTime: -1 }))
                             .sort((a, b) => a.arrival - b.arrival);
  const schedule = [];
  const metrics  = [];
  let time = 0;
  const readyQ = [];
  let arrived = 0;

  // Seed ready queue with processes that arrive at t=0
  while (arrived < ps.length && ps[arrived].arrival <= time) readyQ.push(ps[arrived++]);

  while (readyQ.length > 0 || arrived < ps.length) {
    if (readyQ.length === 0) {
      // CPU idle until next arrival
      schedule.push("IDLE");
      time++;
      while (arrived < ps.length && ps[arrived].arrival <= time) readyQ.push(ps[arrived++]);
      continue;
    }

    const p = readyQ.shift();
    if (p.startTime === -1) p.startTime = time;    // First CPU access = response time reference

    const slice = Math.min(quantum, p.remaining);
    for (let t = 0; t < slice; t++) schedule.push(p.pid);
    p.remaining -= slice;
    time += slice;

    // Enqueue newly arrived processes BEFORE re-queuing current process
    while (arrived < ps.length && ps[arrived].arrival <= time) readyQ.push(ps[arrived++]);

    if (p.remaining > 0) {
      readyQ.push(p);                              // Not finished – back to tail
    } else {
      metrics.push({
        pid:        p.pid,
        completion: time,
        turnaround: time - p.arrival,
        waiting:    time - p.arrival - p.burst,
        response:   p.startTime - p.arrival,
      });
    }
  }
  return { schedule, metrics };
}

/* ──────────────────────────── DISPATCHER ──────────────────────────── */
/**
 * Runs the selected algorithm and returns {schedule, metrics}.
 * @param {string} algo - Algorithm key
 * @param {Array}  procs - Process list
 * @param {number} [q=2] - Quantum for RR
 */
function runAlgorithm(algo, procs, q = 2) {
  switch (algo) {
    case "FCFS":     return scheduleFCFS(procs);
    case "SJF":      return scheduleSJF(procs);
    case "SRTF":     return scheduleSRTF(procs);
    case "PRIORITY": return schedulePriority(procs);
    case "RR":       return scheduleRR(procs, q);
    default:         return scheduleFCFS(procs);
  }
}

/* ══════════════════════════════════════════════════════════════════════
   SECTION 7 : SIMULATION ENGINE  (setInterval main loop)
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Returns the interval delay in ms based on the speed slider value.
 * Speed 1 → 1000 ms, Speed 10 → 100 ms.
 */
function getDelay() {
  return Math.round(1100 - dom.speed.value * 100);
}

/** Colour lookup for a given PID (matches processes array colour index). */
function colorForPid(pid) {
  const p = processes.find(q => q.pid === pid);
  return p ? p.color : 0;
}

/**
 * Starts the simulation:
 * 1. Validates that processes exist.
 * 2. Computes the full schedule with the chosen algorithm.
 * 3. Launches the setInterval main loop that advances one tick per interval.
 */
function startSimulation() {
  dom.simError.textContent = "";

  if (processes.length === 0) {
    dom.simError.textContent = "❌ Add at least one process before starting.";
    return;
  }

  const algo    = dom.algorithm.value;
  const quantum = parseInt(dom.quantum.value) || 2;

  if (algo === "RR" && (isNaN(quantum) || quantum < 1)) {
    dom.simError.textContent = "❌ Time Quantum must be ≥ 1.";
    return;
  }

  // Reset state from any previous run
  resetSimulation(true);

  // Compute full schedule upfront
  const result = runAlgorithm(algo, processes, quantum);
  simSchedule   = result.schedule;
  resultMetrics = result.metrics;

  // Reset process states to NEW
  processes.forEach(p => { p.state = STATE.NEW; });
  renderProcessTable();

  // Hide old results
  dom.resultsCard.style.display = "none";
  dom.ganttEmpty.style.display  = "none";
  dom.ganttContainer.style.display = "block";
  dom.ganttChart.innerHTML   = "";
  dom.ganttTimeline.innerHTML = "";

  simRunning = true;
  simPaused  = false;
  currentTick = 0;

  updateControlButtons();
  simInterval = setInterval(tick, getDelay());
}

/**
 * One simulation tick: advances time by one unit,
 * updates CPU box, ready queue, Gantt chart, and process states.
 */
function tick() {
  if (currentTick >= simSchedule.length) {
    // Simulation finished
    clearInterval(simInterval);
    simRunning = false;
    updateControlButtons();
    showResults();
    setAllTerminated();
    renderProcessTable();
    return;
  }

  const pid = simSchedule[currentTick];

  // ── Update CPU box ──
  if (pid === "IDLE") {
    dom.cpuProcess.textContent = "IDLE";
    dom.cpuProcess.className   = "cpu-process idle";
  } else {
    dom.cpuProcess.textContent = pid;
    dom.cpuProcess.className   = "cpu-process running";
  }
  dom.cpuTimer.textContent = `t = ${currentTick}`;

  // ── Update process states ──
  processes.forEach(p => {
    if (p.state === STATE.TERMINATED) return;
    if (p.arrival > currentTick) {
      p.state = STATE.NEW;
    } else if (p.pid === pid) {
      p.state = STATE.RUNNING;
    } else if (p.arrival <= currentTick) {
      // Check if already finished
      const done = resultMetrics.find(m => m.pid === p.pid);
      if (done && currentTick >= done.completion) {
        p.state = STATE.TERMINATED;
      } else {
        p.state = STATE.READY;
      }
    }
  });
  renderProcessTable();

  // ── Update Ready Queue display ──
  const readyPids = processes
    .filter(p => p.state === STATE.READY)
    .map(p => p.pid);
  renderReadyQueue(readyPids);

  // ── Append Gantt block ──
  appendGanttBlock(pid, currentTick);

  currentTick++;
}

/**
 * Sets all processes to TERMINATED state at end of simulation.
 */
function setAllTerminated() {
  processes.forEach(p => { p.state = STATE.TERMINATED; });
  dom.cpuProcess.textContent = "IDLE";
  dom.cpuProcess.className   = "cpu-process idle";
  dom.readyQueue.innerHTML   = `<span class="rq-empty">Empty</span>`;
  dom.cpuTimer.textContent   = `t = ${simSchedule.length}`;
}

/** Pauses the running simulation. */
function pauseSimulation() {
  if (!simRunning || simPaused) return;
  clearInterval(simInterval);
  simPaused = true;
  updateControlButtons();
}

/** Resumes a paused simulation. */
function resumeSimulation() {
  if (!simPaused) return;
  simPaused = false;
  simInterval = setInterval(tick, getDelay());
  updateControlButtons();
}

/**
 * Resets everything to the initial empty state.
 * @param {boolean} [soft=false] – If true, don't reset processes array.
 */
function resetSimulation(soft = false) {
  clearInterval(simInterval);
  simRunning  = false;
  simPaused   = false;
  currentTick = 0;
  simSchedule = [];

  dom.cpuProcess.textContent = "IDLE";
  dom.cpuProcess.className   = "cpu-process idle";
  dom.cpuTimer.textContent   = "t = 0";
  dom.readyQueue.innerHTML   = `<span class="rq-empty">Empty</span>`;
  dom.ganttChart.innerHTML   = "";
  dom.ganttTimeline.innerHTML = "";
  dom.ganttEmpty.style.display    = "block";
  dom.ganttContainer.style.display = "none";
  dom.resultsCard.style.display   = "none";
  dom.simError.textContent = "";

  if (!soft) {
    processes.forEach(p => { p.state = STATE.NEW; });
    renderProcessTable();
  }

  updateControlButtons();
}

/** Enables/disables control buttons based on current simulation state. */
function updateControlButtons() {
  dom.startBtn.disabled  = simRunning;
  dom.pauseBtn.disabled  = !simRunning || simPaused;
  dom.resumeBtn.disabled = !simPaused;
  dom.resetBtn.disabled  = !simRunning && !simPaused && currentTick === 0;
}

/* Hook up control buttons */
dom.startBtn.addEventListener("click",  startSimulation);
dom.pauseBtn.addEventListener("click",  pauseSimulation);
dom.resumeBtn.addEventListener("click", resumeSimulation);
dom.resetBtn.addEventListener("click",  () => resetSimulation(false));

/* Speed slider live-update during simulation */
dom.speed.addEventListener("input", () => {
  if (simRunning && !simPaused) {
    clearInterval(simInterval);
    simInterval = setInterval(tick, getDelay());
  }
});

/* ══════════════════════════════════════════════════════════════════════
   SECTION 8 : GANTT CHART RENDERING
   ══════════════════════════════════════════════════════════════════════ */

/** Process-colour hex values (matching CSS palette) */
const COLORS = [
  "#58a6ff","#3fb950","#f0883e","#bc8cff","#f85149",
  "#39d353","#d29922","#79c0ff","#56d364","#ff7b72",
];

/**
 * Appends a single coloured block to the Gantt chart and a tick marker.
 * Consecutive blocks with the same PID are merged for readability.
 * @param {string} pid
 * @param {number} tick
 */
function appendGanttBlock(pid, tick) {
  const chart    = dom.ganttChart;
  const timeline = dom.ganttTimeline;

  // Merge consecutive same-PID blocks by widening the last block
  const blocks = chart.querySelectorAll(".gantt-block");
  const last   = blocks[blocks.length - 1];
  if (last && last.dataset.pid === pid) {
    // Increase width by one unit (36px)
    const w = parseInt(last.style.minWidth || "36") + 36;
    last.style.minWidth = `${w}px`;
    last.dataset.tip = `${pid}  [${parseInt(last.dataset.start)} – ${tick + 1}]`;
  } else {
    // New block
    const div = document.createElement("div");
    div.className = `gantt-block ${pid === "IDLE" ? "idle-block" : ""}`;
    div.textContent = pid;
    div.dataset.pid   = pid;
    div.dataset.start = tick;
    div.dataset.tip   = `${pid}  [${tick} – ${tick + 1}]`;
    if (pid !== "IDLE") {
      const c = colorForPid(pid);
      div.style.background = COLORS[c % COLORS.length];
    }
    chart.appendChild(div);
  }

  // Add a time tick marker every step
  const tickDiv = document.createElement("div");
  tickDiv.className   = "gantt-tick";
  tickDiv.textContent = tick;
  timeline.appendChild(tickDiv);

  // Auto-scroll Gantt to the right
  dom.ganttContainer.scrollLeft = dom.ganttContainer.scrollWidth;
}

/* ══════════════════════════════════════════════════════════════════════
   SECTION 9 : READY QUEUE DISPLAY
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Re-renders the ready queue visualisation.
 * @param {string[]} pids - PIDs currently in the ready queue
 */
function renderReadyQueue(pids) {
  if (pids.length === 0) {
    dom.readyQueue.innerHTML = `<span class="rq-empty">Empty</span>`;
    return;
  }
  dom.readyQueue.innerHTML = pids.map(pid => {
    const c = colorForPid(pid);
    return `<span class="rq-item" style="background:${COLORS[c % COLORS.length]}">${pid}</span>`;
  }).join("");
}

/* ══════════════════════════════════════════════════════════════════════
   SECTION 10 : RESULTS TABLE
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Shows the per-process metrics table and computed averages.
 * Also shows CPU Utilisation and Throughput for the full workload.
 */
function showResults() {
  dom.resultsCard.style.display = "block";
  const tbody = dom.resultsBody;
  tbody.innerHTML = "";

  // Sort metrics by PID name for consistent display
  const sorted = [...resultMetrics].sort((a, b) => a.pid.localeCompare(b.pid, undefined, { numeric: true }));

  let totalTAT = 0, totalWT = 0, totalRT = 0;

  sorted.forEach(m => {
    totalTAT += m.turnaround;
    totalWT  += m.waiting;
    totalRT  += m.response;
    const p = processes.find(x => x.pid === m.pid);
    const c = p ? COLORS[p.color % COLORS.length] : "#58a6ff";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong style="color:${c}">${m.pid}</strong></td>
      <td>${processes.find(x=>x.pid===m.pid)?.arrival ?? "—"}</td>
      <td>${processes.find(x=>x.pid===m.pid)?.burst ?? "—"}</td>
      <td>${processes.find(x=>x.pid===m.pid)?.priority ?? "—"}</td>
      <td>${m.completion}</td>
      <td>${m.turnaround}</td>
      <td>${m.waiting}</td>
      <td>${m.response}</td>
    `;
    tbody.appendChild(tr);
  });

  const n       = sorted.length;
  const avgTAT  = (totalTAT / n).toFixed(2);
  const avgWT   = (totalWT  / n).toFixed(2);
  const avgRT   = (totalRT  / n).toFixed(2);
  const totalTime = simSchedule.length;
  const busyTime  = simSchedule.filter(p => p !== "IDLE").length;
  const utilPct   = totalTime > 0 ? ((busyTime / totalTime) * 100).toFixed(1) : 0;
  const throughput = (n / totalTime).toFixed(3);

  dom.averages.innerHTML = `
    <div class="avg-chip">Avg Turnaround: <strong>${avgTAT}</strong></div>
    <div class="avg-chip">Avg Waiting: <strong>${avgWT}</strong></div>
    <div class="avg-chip">Avg Response: <strong>${avgRT}</strong></div>
    <div class="avg-chip">CPU Utilisation: <strong>${utilPct}%</strong></div>
    <div class="avg-chip">Throughput: <strong>${throughput} proc/unit</strong></div>
  `;
}

/* ══════════════════════════════════════════════════════════════════════
   SECTION 11 : COMPARE ALL ALGORITHMS (Canvas Bar Chart)
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Runs all 5 algorithms on the current process set, computes average
 * waiting time for each, draws a grouped Canvas bar chart, and
 * recommends the best algorithm.
 */
function compareAllAlgorithms() {
  if (processes.length === 0) {
    alert("Please add processes first!");
    return;
  }

  const quantum = parseInt(dom.quantum.value) || 2;
  const algos   = ["FCFS", "SJF", "SRTF", "PRIORITY", "RR"];
  const labels  = ["FCFS", "SJF", "SRTF", "Priority", `RR (q=${quantum})`];

  // Compute metrics for each algorithm
  const results = algos.map(a => {
    const { metrics } = runAlgorithm(a, processes, quantum);
    const n    = metrics.length || 1;
    const avgWT  = metrics.reduce((s, m) => s + m.waiting,    0) / n;
    const avgTAT = metrics.reduce((s, m) => s + m.turnaround, 0) / n;
    const avgRT  = metrics.reduce((s, m) => s + m.response,   0) / n;
    return { algo: a, avgWT, avgTAT, avgRT };
  });

  dom.compareResult.style.display = "block";
  drawBarChart(results, labels, quantum);
  showRecommendation(results, labels, quantum);
}

/**
 * Draws a grouped bar chart on the compare canvas.
 * Bars represent Avg Waiting Time, Turnaround Time, and Response Time.
 * @param {Array} results
 * @param {string[]} labels
 * @param {number} quantum
 */
function drawBarChart(results, labels, quantum) {
  const canvas  = dom.compareChart;
  const ctx     = canvas.getContext("2d");
  const isDark  = document.documentElement.getAttribute("data-theme") === "dark";

  // Responsive canvas width
  canvas.width  = canvas.parentElement.clientWidth || 700;
  canvas.height = 260;

  const W = canvas.width;
  const H = canvas.height;

  // Clear
  ctx.fillStyle = isDark ? "#0d1117" : "#f0f2f5";
  ctx.fillRect(0, 0, W, H);

  const padL = 50, padR = 20, padT = 30, padB = 50;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  const groupCount  = results.length;      // 5 algorithms
  const barPerGroup = 3;                   // WT, TAT, RT
  const groupW      = chartW / groupCount;
  const barW        = (groupW * 0.7) / barPerGroup;
  const gap         = groupW * 0.3 / (barPerGroup + 1);

  // Max value for Y-axis scaling
  const maxVal = Math.max(
    ...results.flatMap(r => [r.avgWT, r.avgTAT, r.avgRT])
  ) || 1;

  const barColors = ["#58a6ff", "#3fb950", "#f0883e"];  // WT, TAT, RT

  // Draw Y-axis grid lines
  ctx.strokeStyle = isDark ? "#30363d" : "#d0d7de";
  ctx.lineWidth   = 0.8;
  for (let i = 0; i <= 5; i++) {
    const y = padT + chartH - (i / 5) * chartH;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + chartW, y);
    ctx.stroke();
    ctx.fillStyle = isDark ? "#8b949e" : "#57606a";
    ctx.font      = "10px Segoe UI";
    ctx.textAlign = "right";
    ctx.fillText(((maxVal * i) / 5).toFixed(1), padL - 5, y + 3);
  }

  // Draw bars
  results.forEach((r, gi) => {
    const vals = [r.avgWT, r.avgTAT, r.avgRT];
    vals.forEach((v, bi) => {
      const x = padL + gi * groupW + gap * (bi + 1) + barW * bi;
      const barH = (v / maxVal) * chartH;
      const y    = padT + chartH - barH;

      ctx.fillStyle = barColors[bi];
      ctx.beginPath();
      ctx.roundRect(x, y, barW, barH, 3);
      ctx.fill();

      // Value label on top
      ctx.fillStyle = isDark ? "#e6edf3" : "#1f2328";
      ctx.font      = "9px Segoe UI";
      ctx.textAlign = "center";
      ctx.fillText(v.toFixed(1), x + barW / 2, y - 3);
    });

    // Algorithm label below group
    ctx.fillStyle = isDark ? "#8b949e" : "#57606a";
    ctx.font      = "10px Segoe UI";
    ctx.textAlign = "center";
    ctx.fillText(labels[gi], padL + gi * groupW + groupW / 2, H - padB + 16);
  });

  // Legend
  const legendX = padL;
  const legendY = padT - 14;
  const legendItems = [
    { label: "Avg Wait", color: "#58a6ff" },
    { label: "Avg TAT",  color: "#3fb950" },
    { label: "Avg Resp", color: "#f0883e" },
  ];
  legendItems.forEach((item, i) => {
    const lx = legendX + i * 110;
    ctx.fillStyle = item.color;
    ctx.fillRect(lx, legendY, 12, 12);
    ctx.fillStyle = isDark ? "#e6edf3" : "#1f2328";
    ctx.font = "10px Segoe UI";
    ctx.textAlign = "left";
    ctx.fillText(item.label, lx + 16, legendY + 10);
  });

  // Y-axis label
  ctx.save();
  ctx.translate(14, padT + chartH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = isDark ? "#8b949e" : "#57606a";
  ctx.font      = "11px Segoe UI";
  ctx.textAlign = "center";
  ctx.fillText("Time Units", 0, 0);
  ctx.restore();
}

/**
 * Picks the algorithm with the minimum average waiting time
 * and renders a recommendation box.
 * @param {Array} results
 * @param {string[]} labels
 * @param {number} quantum
 */
function showRecommendation(results, labels, quantum) {
  const best = results.reduce((a, b) => a.avgWT < b.avgWT ? a : b);
  const idx  = results.indexOf(best);

  const explanations = {
    FCFS:     "FCFS is simple and fair. Best for batch systems where all processes arrive at similar times.",
    SJF:      "SJF minimises average waiting time among non-preemptive algorithms. Ideal when burst times are known in advance.",
    SRTF:     "SRTF (preemptive SJF) gives the theoretical minimum average waiting time. Great for interactive systems but requires knowing remaining burst times.",
    PRIORITY: "Priority Scheduling is good when processes have known importance levels (e.g., OS kernel > user tasks).",
    RR:       `Round Robin (q=${quantum}) gives each process a fair share of the CPU. Best for time-sharing and interactive environments.`,
  };

  dom.recommendation.innerHTML = `
    <strong>🏆 Best Algorithm: ${labels[idx]}</strong><br/>
    <br/>
    Avg Waiting: <strong>${best.avgWT.toFixed(2)}</strong> units &nbsp;|&nbsp;
    Avg Turnaround: <strong>${best.avgTAT.toFixed(2)}</strong> units &nbsp;|&nbsp;
    Avg Response: <strong>${best.avgRT.toFixed(2)}</strong> units<br/>
    <br/>
    💡 ${explanations[best.algo]}
  `;
}

dom.compareBtn.addEventListener("click", compareAllAlgorithms);

/* ══════════════════════════════════════════════════════════════════════
   SECTION 12 : INITIALISATION
   ══════════════════════════════════════════════════════════════════════ */

/** Bootstrap the UI on page load. */
function init() {
  updateControlButtons();
  dom.ganttContainer.style.display = "none";
  // Pre-load a sample set for first-time visitors
  generateRandom();
}

init();

/* ══════════════════════════════════════════════════════════════════════
   END OF script.js
   ══════════════════════════════════════════════════════════════════════ */
