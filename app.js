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

/** ✅ PASSCODE (speed bump) */
const PASSCODE = "CHANGE_ME";

/** Firestore schema */
const COLLECTION_NAME = "teams";
const TEAM_NAME_FIELD = "name";
const SPONSOR_FIELD   = "sponsorName";
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

/** ---------- PASSCODE GATE ---------- */
function showGateError(msg) {
  gateErr.textContent = msg;
  gateErr.classList.remove("hidden");
}
function clearGateError() {
  gateErr.textContent = "";
  gateErr.classList.add("hidden");
}

function unlockUI() {
  unlocked = true;
  gate.classList.add("hidden");
  appRoot?.classList.remove("locked");
  clearGateError();
  // start app only once unlocked
  startRealtime();
}

function checkPasscode(input) {
  return String(input || "").trim() === PASSCODE;
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
  // Example: https://.../#code=1234
  const hash = window.location.hash || "";
  const m = hash.match(/code=([^&]+)/);
  if (m) {
    const fromHash = decodeURIComponent(m[1]);
    if (checkPasscode(fromHash)) unlockUI();
  }
}

initGate();

/** UI refs */
const teamsGrid = el("teamsGrid");
const teamsMeta = el("teamsMeta");

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

/** ---------- helpers ---------- */
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}

function teamKeyFromName(name) {
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
  return s ? s.slice(0, 40) : "";
}

function requireUnlocked() {
  if (!unlocked) throw new Error("Locked. Enter passcode.");
}

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
  revealTeamName.textContent = getTeamName(team);
  revealTeamIcon.src = cardUrl(team); // ✅ TEAM CARD IMAGE
  revealTeamIcon.alt = getTeamName(team);
  revealSponsorName.textContent = sponsor;
  revealView.classList.remove("hidden");
}

function hideReveal() {
  revealView.classList.add("hidden");
}

/** ---------- render ---------- */
function renderTeams(teams) {
  if (!teamsGrid) return;

  const total = teams.length;
  const available = teams.filter(isAvailable).length;
  teamsMeta.textContent = `${available} available • ${total - available} sponsored • ${total} total`;

  teamsGrid.innerHTML = teams.map(t => `
    <div class="teamCard" data-id="${t.id}">
      <div class="teamTop">
        <img class="teamIcon"
             src="${escapeHtml(iconUrl(t))}"
             alt="${escapeHtml(getTeamName(t))}"
             onerror="this.onerror=null;this.src='${FALLBACK_ICON}'" />
        <div>
          <div class="teamName">${escapeHtml(getTeamName(t))}</div>
          <div class="muted">${escapeHtml(t.id)}</div>
        </div>
      </div>

      <div class="teamSponsor">
        <div class="label">Sponsor</div>
        <div class="sponsorName">${escapeHtml(getSponsor(t))}</div>
      </div>
    </div>
  `).join("");
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

async function claimRandomTeam(sponsorName) {
  requireUnlocked();
  let available = latestTeams.filter(isAvailable);
  if (available.length === 0) throw new Error("No teams left to sponsor.");

  for (let attempt = 0; attempt < 5; attempt++) {
    const pick = available[Math.floor(Math.random() * available.length)];
    try {
      return await claimSpecificTeam(pick.id, sponsorName);
    } catch {
      available = latestTeams.filter(isAvailable);
      if (available.length === 0) break;
    }
  }
  throw new Error("Random allocation conflicted. Try again.");
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
  try { await resetAllSponsors(); }
  catch (e) { alert(e?.message || "Reset failed."); }
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
    const team = await claimRandomTeam(currentSponsor);
    hideModal();
    showReveal(team, currentSponsor);
  } catch (e) {
    showError(e?.message || "Random allocation failed.");
  }
});

el("btnPick")?.addEventListener("click", () => {
  clearError();
  renderPickGrid(latestTeams);
  setStep("pick");
});

el("btnBackToType")?.addEventListener("click", () => setStep("type"));

el("btnBackToMain")?.addEventListener("click", () => hideReveal());

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

    teams.sort((a,b) => {
      const av = isAvailable(a), bv = isAvailable(b);
      if (av !== bv) return av ? -1 : 1;
      return getTeamName(a).localeCompare(getTeamName(b));
    });

    latestTeams = teams;
    renderTeams(teams);

    if (!stepPick.classList.contains("hidden")) renderPickGrid(teams);
  }, (err) => {
    console.error("Firestore onSnapshot error:", err);
    teamsMeta.textContent = "Firestore error (check firebaseConfig/rules)";
  });
}
