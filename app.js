import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  runTransaction,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/** Firebase config */
const firebaseConfig = {
  apiKey: "AIzaSyB23VXC2PvAMx9foZoa22ciyku7Dghf5jQ",
  authDomain: "pit-ballers.firebaseapp.com",
  projectId: "pit-ballers",
  storageBucket: "pit-ballers.appspot.com",
  messagingSenderId: "10961796042",
  appId: "1:10961796042:web:9dcc8d72c204abd7d4ed33"
};

/** PASSCODE (speed bump) */
const PASSCODE = "Keem";

/** Firestore schema */
const COLLECTION_NAME = "teams";
const TEAM_NAME_FIELD = "name";
const SPONSOR_FIELD = "sponsorName";
const DEFAULT_SPONSOR = "Your Name Here";

/** Assets */
const ICONS_DIR = "img/icons/";
const CARDS_DIR = "img/teams/";
const FALLBACK_ICON = "img/icons/team-fallback.png";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const el = (id) => document.getElementById(id);

/** Gate elements */
const appRoot = el("appRoot");
const gate = el("gate");
const gateCode = el("gateCode");
const gateBtn = el("gateBtn");
const gateErr = el("gateErr");

let unlocked = false;
let prevSponsorById = new Map();

/** UI refs */
const teamsGrid = el("teamsGrid");
const teamsMeta = el("teamsMeta"); // hidden in HTML, kept for compatibility
const teamsMetaTop = el("teamsMetaTop");

const revealView = el("revealView");
const revealTeamName = el("revealTeamName");
const revealTeamIcon = el("revealTeamIcon");
const revealSponsorName = el("revealSponsorName");

const modal = el("modal");
const modalError = el("modalError");

const stepSponsor = el("stepSponsor");
const stepType = el("stepType");
const stepPick = el("stepPick");

const sponsorInput = el("sponsorInput");
const pickGrid = el("pickGrid");
const pickMeta = el("pickMeta");

let latestTeams = [];
let currentSponsor = "";

/** Preload cache */
const preloadCache = new Set();

/** ---------- helpers ---------- */
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[m]));
}

function teamKeyFromName(name) {
  // "Lolcow Balls" -> "Lolcow_Balls"
  // "Lolcow Cash (a)" -> "Lolcow_Cash_(a)"
  return String(name || "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_()]/g, "");
}

function getTeamName(team) {
  return team?.[TEAM_NAME_FIELD] ?? "Unknown";
}

function getSponsor(team) {
  return team?.[SPONSOR_FIELD] ?? DEFAULT_SPONSOR;
}

function isAvailable(team) {
  return (getSponsor(team) || DEFAULT_SPONSOR) === DEFAULT_SPONSOR;
}

function iconUrl(team) {
  const key = teamKeyFromName(getTeamName(team));
  return `${ICONS_DIR}${key}.png`;
}

function cardUrl(team) {
  const key = teamKeyFromName(getTeamName(team));
  return `${CARDS_DIR}${key}.png`;
}

function cleanSponsorName(raw) {
  const s = (raw || "").trim().replace(/\s+/g, " ");
  return s ? s.slice(0, 32) : "";
}

function requireUnlocked() {
  if (!unlocked) throw new Error("Locked. Enter passcode.");
}

function preloadImage(url) {
  if (!url || preloadCache.has(url)) return;
  preloadCache.add(url);
  const img = new Image();
  img.decoding = "async";
  img.loading = "eager";
  img.src = url;
}

function preloadAllAssets(teams) {
  teams.forEach(t => {
    preloadImage(iconUrl(t));
    preloadImage(cardUrl(t));
  });
}

function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

/** ---------- PASSCODE GATE ---------- */
function showGateError(msg) {
  gateErr.textContent = msg;
  gateErr.classList.remove("hidden");
}
function clearGateError() {
  gateErr.textContent = "";
  gateErr.classList.add("hidden");
}

function checkPasscode(input) {
  return String(input || "").trim() === PASSCODE;
}

function unlockUI() {
  unlocked = true;
  gate.classList.add("hidden");
  appRoot?.classList.remove("locked");
  clearGateError();
  startRealtime();
}

function initGate() {
  // lock UI by default
  appRoot?.classList.add("locked");

  gateBtn?.addEventListener("click", () => {
    clearGateError();
    if (!checkPasscode(gateCode.value)) {
      showGateError("Incorrect passcode.");
      gateCode.focus();
      return;
    }
    unlockUI();
  });

  gateCode?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") gateBtn?.click();
  });

  // Optional: allow passcode via URL hash: #code=XXXX
  const hash = window.location.hash || "";
  const m = hash.match(/code=([^&]+)/);
  if (m) {
    const fromHash = decodeURIComponent(m[1]);
    if (checkPasscode(fromHash)) unlockUI();
  }
}
initGate();

/** ---------- modal ---------- */
function setStep(which) {
  stepSponsor.classList.toggle("hidden", which !== "sponsor");
  stepType.classList.toggle("hidden", which !== "type");
  stepPick.classList.toggle("hidden", which !== "pick");
}

function showError(msg) {
  modalError.textContent = msg;
  modalError.classList.remove("hidden");
}
function clearError() {
  modalError.classList.add("hidden");
  modalError.textContent = "";
}

function showModal() {
  try { requireUnlocked(); } catch (e) { alert(e.message); return; }

  modal.classList.remove("hidden");
  clearError();
  sponsorInput.value = "";
  currentSponsor = "";
  setStep("sponsor");
  sponsorInput.focus();
}

function hideModal() {
  modal.classList.add("hidden");
}

function showReveal(team, sponsor) {
  const headline = el("revealHeadline");
  if (headline) headline.textContent = `Sponsor Allocated • ${sponsor}`;

  revealTeamName.textContent = getTeamName(team);

  revealTeamIcon.src = cardUrl(team);
  revealTeamIcon.alt = getTeamName(team);

  revealView.classList.remove("hidden");
}

function hideReveal() {
  revealView.classList.add("hidden");
}

/** ---------- highlight animation helpers ---------- */
function clearHighlights() {
  document.querySelectorAll(".teamCard.isHighlight, .teamCard.isWinner").forEach(node => {
    node.classList.remove("isHighlight");
    node.classList.remove("isWinner");
  });
}

function setHighlight(teamId, cls = "isHighlight") {
  clearHighlights();
  const card = document.querySelector(`.teamCard[data-id="${CSS.escape(teamId)}"]`);
  if (card) card.classList.add(cls);
}

/**
 * 5s decelerating highlight animation using main grid cards.
 * Returns the chosen team object.
 */
async function animateRandomPick(availableTeams, durationMs = 5000) {
  if (!availableTeams.length) throw new Error("No teams left to sponsor.");

  const start = performance.now();
  let i = 0;

  while (performance.now() - start < durationMs) {
    const t = performance.now() - start;
    const p = Math.min(1, t / durationMs);

    // interval grows over time (fast -> slow)
    const interval = 60 + Math.floor(440 * (p * p)); // ~60ms .. ~500ms

    const pick = availableTeams[i % availableTeams.length];
    setHighlight(pick.id, "isHighlight");

    i++;
    await sleep(interval);
  }

  const finalPick = availableTeams[Math.floor(Math.random() * availableTeams.length)];
  setHighlight(finalPick.id, "isWinner");
  await sleep(350);

  return finalPick;
}

/** ---------- render ---------- */
function renderTeams(teams) {
  if (!teamsGrid) return;

  const total = teams.length;
  const available = teams.filter(isAvailable).length;
  const sponsored = total - available;

  // Update hidden meta (optional) + topbar meta
  if (teamsMeta) teamsMeta.textContent = `${available} available • ${sponsored} sponsored`;
  if (teamsMetaTop) teamsMetaTop.textContent = `${available} available • ${sponsored} sponsored`;

teamsGrid.innerHTML = teams.map(t => {
  const name = getTeamName(t);
  const sponsor = getSponsor(t);
  const available = isAvailable(t);

  const prev = prevSponsorById.get(t.id) ?? DEFAULT_SPONSOR;
  const justSponsored = (prev === DEFAULT_SPONSOR && sponsor !== DEFAULT_SPONSOR);

  return `
    <div class="teamCard ${available ? "" : "isSponsored"} ${justSponsored ? "justSponsored" : ""}" data-id="${t.id}">
      <div class="teamTop">
        <div class="teamIconWrap">
          <img class="teamIcon"
               src="${escapeHtml(iconUrl(t))}"
               alt="${escapeHtml(name)}"
               onerror="this.onerror=null;this.src='${FALLBACK_ICON}'" />
          ${available ? "" : `<span class="lockBadge" title="Sponsored" aria-label="Sponsored">🔒</span>`}
        </div>

        <div>
          <div class="teamName">${escapeHtml(name)}</div>
        </div>
      </div>

      <div class="teamSponsor">
        <div class="label">Sponsor</div>
        <div class="sponsorName">${escapeHtml(sponsor)}</div>
      </div>
    </div>
  `;
}).join("");
}

function renderPickGrid(teams) {
  const availableTeams = teams.filter(isAvailable);
  pickMeta.textContent = `${availableTeams.length} teams available`;

  pickGrid.innerHTML = availableTeams.map(t => `
    <button class="pickBtn" data-id="${t.id}">
      <img src="${escapeHtml(iconUrl(t))}"
           alt="${escapeHtml(getTeamName(t))}"
           onerror="this.onerror=null;this.src='${FALLBACK_ICON}'" />
      <div>
        <div style="font-weight:950">${escapeHtml(getTeamName(t))}</div>
        <div class="muted">Click to sponsor</div>
      </div>
    </button>
  `).join("");

  pickGrid.querySelectorAll(".pickBtn").forEach(btn => {
    btn.addEventListener("click", async () => {
      clearError();
      const teamId = btn.getAttribute("data-id");
      try {
        requireUnlocked();
        const team = await claimSpecificTeam(teamId, currentSponsor);
        hideModal();
        showReveal(team, currentSponsor);
      } catch (e) {
        showError(e?.message || "Couldn’t claim that team. Try again.");
      }
    });
  });
}

/** ---------- firestore ops ---------- */
function teamsCollectionRef() {
  return collection(db, COLLECTION_NAME);
}

async function claimSpecificTeam(teamId, sponsorName) {
  requireUnlocked();
  const ref = doc(db, COLLECTION_NAME, teamId);

  return await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Team not found.");

    const data = snap.data();
    const current = data?.[SPONSOR_FIELD] ?? DEFAULT_SPONSOR;

    if (current !== DEFAULT_SPONSOR) throw new Error("That team already has a sponsor.");

    tx.update(ref, {
      [SPONSOR_FIELD]: sponsorName,
      updatedAt: serverTimestamp()
    });

    return { id: teamId, ...data, [SPONSOR_FIELD]: sponsorName };
  });
}

async function resetAllSponsors() {
  requireUnlocked();
  const ok = confirm(`Reset ALL sponsors back to "${DEFAULT_SPONSOR}"?`);
  if (!ok) return;

  const snap = await getDocs(teamsCollectionRef());
  const batch = writeBatch(db);

  snap.forEach((d) => {
    batch.update(d.ref, { [SPONSOR_FIELD]: DEFAULT_SPONSOR, updatedAt: serverTimestamp() });
  });

  await batch.commit();
}

/** ---------- events ---------- */
el("btnStart")?.addEventListener("click", () => {
  hideReveal();
  showModal();
});

el("btnResetAll")?.addEventListener("click", async () => {
  try {
    await resetAllSponsors();
  } catch (e) {
    alert(e?.message || "Reset failed.");
  }
});

el("btnCloseModal")?.addEventListener("click", hideModal);

el("btnNextToType")?.addEventListener("click", () => {
  clearError();
  const name = cleanSponsorName(sponsorInput.value);
  if (!name) return showError("Enter a sponsor name.");
  currentSponsor = name;
  setStep("type");
});

sponsorInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") el("btnNextToType")?.click();
});

el("btnBackToSponsor")?.addEventListener("click", () => setStep("sponsor"));

el("btnRandom")?.addEventListener("click", async () => {
  clearError();
  try {
    requireUnlocked();

    // ✅ hide the pop-out so roulette is fully visible
    hideModal();
    hideReveal();

    const availableTeams = latestTeams.filter(isAvailable);
    const chosen = await animateRandomPick(availableTeams, 5000);

    const team = await claimSpecificTeam(chosen.id, currentSponsor);

    await sleep(250);
    clearHighlights();

    showReveal(team, currentSponsor);
  } catch (e) {
    // if something fails, reopen modal so you can retry
    showModal();
    showError(e?.message || "Random allocation failed.");
  }
});


el("btnPick")?.addEventListener("click", () => {
  clearError();
  renderPickGrid(latestTeams);
  setStep("pick");
});

el("btnBackToType")?.addEventListener("click", () => setStep("type"));

el("btnBackToMain")?.addEventListener("click", () => {
  clearHighlights();
  hideReveal();
});

modal?.addEventListener("click", (e) => {
  if (e.target === modal) hideModal();
});

/** ---------- realtime boot (starts only after unlock) ---------- */
let started = false;

function startRealtime() {
  if (started) return;
  started = true;

  const q = query(teamsCollectionRef());

  onSnapshot(q, (snap) => {
    const teams = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Sort: available first, then by name
    teams.sort((a, b) => {
      const av = isAvailable(a), bv = isAvailable(b);
      if (av !== bv) return av ? -1 : 1;
      return getTeamName(a).localeCompare(getTeamName(b));
    });

    latestTeams = teams;

    // Preload icons + cards (avoids reveal delays)
    preloadAllAssets(teams);

    renderTeams(teams);
    prevSponsorById = new Map(teams.map(t => [t.id, getSponsor(t)]));

    
    if (!stepPick.classList.contains("hidden")) renderPickGrid(teams);
  }, (err) => {
    console.error("Firestore onSnapshot error:", err);
    if (teamsMetaTop) teamsMetaTop.textContent = "Firestore error";
  });
}
