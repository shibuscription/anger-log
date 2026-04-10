import { initializeApp } from "firebase/app";
import {
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithRedirect,
  signOut,
} from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  enableIndexedDbPersistence,
  getDoc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";

const env = import.meta.env;
const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
  ...(env.VITE_FIREBASE_MEASUREMENT_ID ? { measurementId: env.VITE_FIREBASE_MEASUREMENT_ID } : {}),
};

const requiredEntries = [
  ["apiKey", firebaseConfig.apiKey],
  ["authDomain", firebaseConfig.authDomain],
  ["projectId", firebaseConfig.projectId],
  ["storageBucket", firebaseConfig.storageBucket],
  ["messagingSenderId", firebaseConfig.messagingSenderId],
  ["appId", firebaseConfig.appId],
];

const missingEnvKeys = requiredEntries
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (missingEnvKeys.length > 0) {
  throw new Error(`Firebase 設定が不足しています: ${missingEnvKeys.join(", ")}`);
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({
  prompt: "select_account",
});

enableIndexedDbPersistence(db).catch((err) => {
  console.warn("オフライン永続化エラー:", err.code);
});

const LOCK_STORAGE_KEY = "angerlog.app_lock";
const LOCK_METHOD = "pin4";
const LOCK_REASON_STARTUP = "startup";
const LOCK_REASON_RESUME = "resume";
const LOCK_REASON_IDLE = "idle";
const DEFAULT_AUTO_LOCK_MS = 5 * 60 * 1000;
const AUTO_LOCK_OPTIONS = new Set([0, 60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000]);
const GOOGLE_MAPS_API_KEY = env.VITE_GOOGLE_MAPS_API_KEY || "";
const GOOGLE_MAPS_MAP_ID = env.VITE_GOOGLE_MAPS_MAP_ID || "";
const MAX_ANGER_MAP_ZOOM = 16;
const SINGLE_LOG_MAP_ZOOM = 14;
const AUTH_REDIRECT_PENDING_KEY = "angerlog.auth.redirect_pending";

const state = {
  currentUser: null,
  angerLogs: [],
  latestLocation: null,
  reflectIndex: 0,
  reflectSingleMode: false,
  reflectList: [],
  authResolved: false,
  appMenuOpen: false,
  userMenuOpen: false,
  serviceWorkerPromptShown: false,
  isRefreshingForUpdate: false,
  lockConfig: loadLockConfig(),
  lockSetupMode: "idle",
  lockSetupStep: "enter",
  lockSetupInput: "",
  lockSetupFirstPin: "",
  lockSetupError: "",
  lockInput: "",
  lockError: "",
  isLocked: false,
  lastHiddenAt: null,
  idleTimerId: null,
  currentScreen: "new",
  googleMapsPromise: null,
  googleMaps: null,
  angerMap: null,
  angerMapMarkers: [],
  selectedMapLogId: null,
  authActionInFlight: null,
  authErrorContext: null,
};

const el = {
  appTitle: document.getElementById("appTitle"),
  appMenuWrap: document.getElementById("appMenuWrap"),
  appMenuButton: document.getElementById("appMenuButton"),
  appMenuPopover: document.getElementById("appMenuPopover"),
  appLockSettingsButton: document.getElementById("appLockSettingsButton"),
  authCard: document.getElementById("authCard"),
  authPrimaryText: document.getElementById("authPrimaryText"),
  authSecondaryText: document.getElementById("authSecondaryText"),
  authStatusText: document.getElementById("authStatusText"),
  authActionButton: document.getElementById("authActionButton"),
  gateLoginButton: document.getElementById("gateLoginButton"),
  authGate: document.getElementById("authGate"),
  appShell: document.getElementById("appShell"),
  bottomNav: document.getElementById("bottomNav"),
  userMenuWrap: document.getElementById("userMenuWrap"),
  userMenuButton: document.getElementById("userMenuButton"),
  userMenuPopover: document.getElementById("userMenuPopover"),
  userAvatarImage: document.getElementById("userAvatarImage"),
  userAvatarFallback: document.getElementById("userAvatarFallback"),
  userMenuName: document.getElementById("userMenuName"),
  userMenuEmail: document.getElementById("userMenuEmail"),
  userMenuLogoutButton: document.getElementById("userMenuLogoutButton"),
  nowText: document.getElementById("nowText"),
  place: document.getElementById("place"),
  event: document.getElementById("event"),
  intensity: document.getElementById("intensity"),
  intensityValue: document.getElementById("intensityValue"),
  locationButton: document.getElementById("locationButton"),
  locationInfo: document.getElementById("locationInfo"),
  saveButton: document.getElementById("saveButton"),
  listContainer: document.getElementById("listContainer"),
  reflectContent: document.getElementById("reflectContent"),
  screenNew: document.getElementById("screen-new"),
  screenList: document.getElementById("screen-list"),
  screenReflect: document.getElementById("screen-reflect"),
  screenMap: document.getElementById("screen-map"),
  navNew: document.getElementById("nav-new"),
  navList: document.getElementById("nav-list"),
  navReflect: document.getElementById("nav-reflect"),
  navReflectBadge: document.getElementById("nav-reflect-badge"),
  appMapButton: document.getElementById("appMapButton"),
  mapBackButton: document.getElementById("mapBackButton"),
  mapStatus: document.getElementById("mapStatus"),
  mapEmptyState: document.getElementById("mapEmptyState"),
  angerMap: document.getElementById("angerMap"),
  mapDetailCard: document.getElementById("mapDetailCard"),
  mapDetailIntensity: document.getElementById("mapDetailIntensity"),
  mapDetailDate: document.getElementById("mapDetailDate"),
  mapDetailPlace: document.getElementById("mapDetailPlace"),
  mapDetailEvent: document.getElementById("mapDetailEvent"),
  mapDetailBeki: document.getElementById("mapDetailBeki"),
  settingsSheet: document.getElementById("settingsSheet"),
  settingsSheetCloseButton: document.getElementById("settingsSheetCloseButton"),
  lockEnabledToggle: document.getElementById("lockEnabledToggle"),
  autoLockSelect: document.getElementById("autoLockSelect"),
  lockSettingsDetails: document.getElementById("lockSettingsDetails"),
  lockSetupFlow: document.getElementById("lockSetupFlow"),
  lockSetupTitle: document.getElementById("lockSetupTitle"),
  lockSetupDescription: document.getElementById("lockSetupDescription"),
  lockSetupError: document.getElementById("lockSetupError"),
  changeLockCodeButton: document.getElementById("changeLockCodeButton"),
  setupDots: Array.from(document.querySelectorAll("[data-setup-dot]")),
  setupKeyButtons: Array.from(document.querySelectorAll("[data-pin-key]")),
  setupActionButtons: Array.from(document.querySelectorAll("[data-pin-action]")),
  lockOverlay: document.getElementById("lockOverlay"),
  lockError: document.getElementById("lockError"),
  lockDots: Array.from(document.querySelectorAll("[data-lock-dot]")),
  lockKeyButtons: Array.from(document.querySelectorAll("[data-lock-key]")),
  lockActionButtons: Array.from(document.querySelectorAll("[data-lock-action]")),
};

function normalizeAutoLockMs(value) {
  const num = Number(value);
  return AUTO_LOCK_OPTIONS.has(num) ? num : DEFAULT_AUTO_LOCK_MS;
}

function loadLockConfig() {
  try {
    const raw = localStorage.getItem(LOCK_STORAGE_KEY);
    if (!raw) {
      return {
        enabled: false,
        method: LOCK_METHOD,
        codeHash: "",
        autoLockMs: DEFAULT_AUTO_LOCK_MS,
      };
    }

    const parsed = JSON.parse(raw);
    return {
      enabled: Boolean(parsed.enabled && parsed.codeHash),
      method: parsed.method === LOCK_METHOD ? LOCK_METHOD : LOCK_METHOD,
      codeHash: typeof parsed.codeHash === "string" ? parsed.codeHash : "",
      autoLockMs: normalizeAutoLockMs(parsed.autoLockMs),
    };
  } catch (error) {
    console.warn("Failed to load app lock config:", error);
    return {
      enabled: false,
      method: LOCK_METHOD,
      codeHash: "",
      autoLockMs: DEFAULT_AUTO_LOCK_MS,
    };
  }
}

function saveLockConfig(nextConfig) {
  state.lockConfig = {
    enabled: Boolean(nextConfig.enabled && nextConfig.codeHash),
    method: LOCK_METHOD,
    codeHash: nextConfig.codeHash || "",
    autoLockMs: normalizeAutoLockMs(nextConfig.autoLockMs),
  };
  localStorage.setItem(LOCK_STORAGE_KEY, JSON.stringify(state.lockConfig));
}

function getIsStandaloneDisplayMode() {
  return window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;
}

function markRedirectPending(active) {
  if (active) {
    sessionStorage.setItem(AUTH_REDIRECT_PENDING_KEY, "1");
    return;
  }
  sessionStorage.removeItem(AUTH_REDIRECT_PENDING_KEY);
}

function isRedirectPending() {
  return sessionStorage.getItem(AUTH_REDIRECT_PENDING_KEY) === "1";
}

function buildAuthErrorDetails(error, mode) {
  return {
    mode,
    code: error?.code || "",
    message: error?.message || "",
    customData: error?.customData || null,
    authDomain: firebaseConfig.authDomain,
    currentOrigin: window.location.origin,
    currentPath: window.location.pathname,
    standalone: getIsStandaloneDisplayMode(),
    userAgent: navigator.userAgent,
  };
}

function logAuthError(error, mode) {
  const details = buildAuthErrorDetails(error, mode);
  state.authErrorContext = details;
  console.error("Google sign-in failed", details);
}

function isRequestedActionInvalidError(error) {
  const message = String(error?.message || "");
  return /requested action is invalid/i.test(message);
}

function isFourDigitPin(value) {
  return /^\d{4}$/.test(value);
}

async function hashPin(pin) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pin));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function verifyPin(pin) {
  if (!isFourDigitPin(pin) || !state.lockConfig.codeHash) {
    return false;
  }
  return (await hashPin(pin)) === state.lockConfig.codeHash;
}

function getCurrentUidOrThrow() {
  if (!state.currentUser?.uid) {
    throw new Error("ログインが必要です。");
  }
  return state.currentUser.uid;
}

function userDocRef(uid) {
  return doc(db, "users", uid);
}

function angerLogsCollection(uid) {
  return collection(db, "users", uid, "anger_logs");
}

function angerLogDocRef(uid, logId) {
  return doc(db, "users", uid, "anger_logs", logId);
}

async function ensureUserDocument(user) {
  const ref = userDocRef(user.uid);
  const snapshot = await getDoc(ref);
  const baseData = {
    displayName: user.displayName || "",
    email: user.email || "",
    updatedAt: serverTimestamp(),
  };

  if (snapshot.exists()) {
    await setDoc(ref, baseData, { merge: true });
    return;
  }

  await setDoc(
    ref,
    {
      ...baseData,
      createdAt: serverTimestamp(),
    },
    { merge: true }
  );
}

async function getAngerLogs(uid) {
  const q = query(angerLogsCollection(uid), orderBy("date", "desc"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((docSnap) => ({
    id: docSnap.id,
    ...docSnap.data(),
  }));
}

async function addAngerLog(uid, data) {
  const payload = {
    date: data.date,
    place: data.place,
    event: data.event,
    intensity: data.intensity,
    location: data.location,
    beki_date: data.beki_date ?? null,
    beki_text: data.beki_text ?? null,
    beki_importance: data.beki_importance ?? null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const docRef = await addDoc(angerLogsCollection(uid), payload);
  return { id: docRef.id, ...payload };
}

async function updateAngerLog(uid, logId, data) {
  await updateDoc(angerLogDocRef(uid, logId), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

async function deleteAngerLog(uid, logId) {
  await deleteDoc(angerLogDocRef(uid, logId));
}

function getDisplayName(user) {
  return user?.displayName || "Googleユーザー";
}

function getEmail(user) {
  return user?.email || "メールアドレス未設定";
}

function getAvatarFallback(user) {
  const source = user?.displayName?.trim();
  if (source) {
    return source[0];
  }
  return "人";
}

function renderUserAvatar(user) {
  const photoUrl = user?.photoURL;
  if (photoUrl) {
    el.userAvatarImage.src = photoUrl;
    el.userAvatarImage.alt = `${getDisplayName(user)} のプロフィール画像`;
    el.userAvatarImage.classList.remove("hidden");
    el.userAvatarFallback.classList.add("hidden");
    return;
  }

  el.userAvatarImage.removeAttribute("src");
  el.userAvatarImage.alt = "";
  el.userAvatarImage.classList.add("hidden");
  el.userAvatarFallback.textContent = getAvatarFallback(user);
  el.userAvatarFallback.classList.remove("hidden");
}

function setAppMenuOpen(open) {
  state.appMenuOpen = open;
  el.appMenuPopover.classList.toggle("hidden", !open);
  el.appMenuButton.setAttribute("aria-expanded", String(open));
}

function setUserMenuOpen(open) {
  state.userMenuOpen = open;
  el.userMenuPopover.classList.toggle("hidden", !open);
  el.userMenuButton.setAttribute("aria-expanded", String(open));
}

function closeMenus() {
  setAppMenuOpen(false);
  setUserMenuOpen(false);
}

function updateUserMenu(user) {
  el.userMenuName.textContent = getDisplayName(user);
  el.userMenuEmail.textContent = getEmail(user);
  renderUserAvatar(user);
}

function updatePinDots(dots, count) {
  dots.forEach((dot, index) => {
    dot.classList.toggle("filled", index < count);
  });
}

function setLockError(message) {
  state.lockError = message;
  el.lockError.textContent = message;
  el.lockError.classList.toggle("hidden", !message);
}

function setSetupError(message) {
  state.lockSetupError = message;
  el.lockSetupError.textContent = message;
  el.lockSetupError.classList.toggle("hidden", !message);
}

function isAppLockEnabled() {
  return Boolean(state.lockConfig.enabled && state.lockConfig.codeHash);
}

function clearIdleTimer() {
  if (state.idleTimerId) {
    window.clearTimeout(state.idleTimerId);
    state.idleTimerId = null;
  }
}

function openSettingsSheet() {
  closeMenus();
  renderLockSettingsUi();
  el.settingsSheet.classList.remove("hidden");
  el.settingsSheet.setAttribute("aria-hidden", "false");
}

function closeSettingsSheet() {
  el.settingsSheet.classList.add("hidden");
  el.settingsSheet.setAttribute("aria-hidden", "true");
  resetLockSetupFlow();
}

function renderLockSettingsUi() {
  const enabled = isAppLockEnabled();
  el.lockEnabledToggle.checked = enabled;
  el.autoLockSelect.value = String(state.lockConfig.autoLockMs);
  el.lockSettingsDetails.classList.toggle("hidden", !enabled);
  el.changeLockCodeButton.classList.toggle("hidden", !enabled);
  updatePinDots(el.setupDots, state.lockSetupInput.length);
  setSetupError(state.lockSetupError);
}

function resetLockSetupFlow() {
  state.lockSetupMode = "idle";
  state.lockSetupStep = "enter";
  state.lockSetupInput = "";
  state.lockSetupFirstPin = "";
  setSetupError("");
  el.lockSetupFlow.classList.add("hidden");
  updatePinDots(el.setupDots, 0);
}

function startLockSetupFlow(mode) {
  state.lockSetupMode = mode;
  state.lockSetupStep = mode === "change" ? "verify-current" : "enter";
  state.lockSetupInput = "";
  state.lockSetupFirstPin = "";
  setSetupError("");
  el.lockSetupFlow.classList.remove("hidden");
  renderLockSetupStep();
}

function renderLockSetupStep() {
  const copyByStep = {
    "verify-current": {
      title: "現在の4桁コードを確認",
      description: "変更する前に、いま使っている4桁コードを入力してください。",
    },
    enter: {
      title: "4桁コードを設定",
      description: "家族や周囲から見られにくくするための4桁コードを入力してください。",
    },
    confirm: {
      title: "4桁コードを再入力",
      description: "確認のため、もう一度同じ4桁コードを入力してください。",
    },
  };
  const copy = copyByStep[state.lockSetupStep];
  el.lockSetupTitle.textContent = copy.title;
  el.lockSetupDescription.textContent = copy.description;
  updatePinDots(el.setupDots, state.lockSetupInput.length);
}

async function finishLockSetup(pin) {
  const codeHash = await hashPin(pin);
  saveLockConfig({
    ...state.lockConfig,
    enabled: true,
    codeHash,
  });
  resetLockSetupFlow();
  renderLockSettingsUi();
  scheduleIdleLock();
}

async function submitLockSetupInput() {
  const pin = state.lockSetupInput;
  if (!isFourDigitPin(pin)) {
    return;
  }

  try {
    if (state.lockSetupStep === "verify-current") {
      const verified = await verifyPin(pin);
      if (!verified) {
        state.lockSetupInput = "";
        setSetupError("現在のコードが違います。");
        renderLockSetupStep();
        return;
      }
      state.lockSetupStep = "enter";
      state.lockSetupInput = "";
      setSetupError("");
      renderLockSetupStep();
      return;
    }

    if (state.lockSetupStep === "enter") {
      state.lockSetupFirstPin = pin;
      state.lockSetupInput = "";
      state.lockSetupStep = "confirm";
      setSetupError("");
      renderLockSetupStep();
      return;
    }

    if (pin !== state.lockSetupFirstPin) {
      state.lockSetupStep = "enter";
      state.lockSetupInput = "";
      state.lockSetupFirstPin = "";
      setSetupError("コードが一致しません。最初から入力してください。");
      renderLockSetupStep();
      return;
    }

    await finishLockSetup(pin);
  } catch (error) {
    console.error(error);
    state.lockSetupInput = "";
    setSetupError("コードの保存に失敗しました。");
    renderLockSetupStep();
  }
}

function handleSetupPadDigit(digit) {
  if (state.lockSetupMode === "idle" || state.lockSetupInput.length >= 4) {
    return;
  }
  state.lockSetupInput += digit;
  updatePinDots(el.setupDots, state.lockSetupInput.length);
  setSetupError("");
  if (state.lockSetupInput.length === 4) {
    void submitLockSetupInput();
  }
}

function handleSetupPadAction(action) {
  if (action === "delete") {
    state.lockSetupInput = state.lockSetupInput.slice(0, -1);
  } else if (action === "clear") {
    state.lockSetupInput = "";
  }
  updatePinDots(el.setupDots, state.lockSetupInput.length);
}

function scheduleIdleLock() {
  clearIdleTimer();
  if (!isAppLockEnabled() || state.isLocked || !state.authResolved) {
    return;
  }
  if (state.lockConfig.autoLockMs <= 0) {
    return;
  }
  state.idleTimerId = window.setTimeout(() => {
    void lockApp(LOCK_REASON_IDLE);
  }, state.lockConfig.autoLockMs);
}

function noteUserInteraction() {
  if (!state.authResolved || state.isLocked) {
    return;
  }
  scheduleIdleLock();
}

function shouldLockOnVisibilityReturn() {
  if (!isAppLockEnabled() || !state.lastHiddenAt) {
    return false;
  }
  if (state.lockConfig.autoLockMs === 0) {
    return true;
  }
  return Date.now() - state.lastHiddenAt >= state.lockConfig.autoLockMs;
}

async function lockApp(reason = LOCK_REASON_IDLE) {
  if (!isAppLockEnabled() || state.isLocked || !state.authResolved) {
    return;
  }
  state.isLocked = true;
  state.lockInput = "";
  setLockError("");
  closeMenus();
  closeSettingsSheet();
  clearIdleTimer();
  updatePinDots(el.lockDots, 0);
  el.lockOverlay.classList.remove("hidden");
  el.lockOverlay.setAttribute("aria-hidden", "false");
  el.lockOverlay.dataset.reason = reason;
}

function unlockApp() {
  state.isLocked = false;
  state.lockInput = "";
  state.lastHiddenAt = null;
  setLockError("");
  updatePinDots(el.lockDots, 0);
  el.lockOverlay.classList.add("hidden");
  el.lockOverlay.setAttribute("aria-hidden", "true");
  scheduleIdleLock();
}

async function handleLockDigit(digit) {
  if (!state.isLocked || state.lockInput.length >= 4) {
    return;
  }
  state.lockInput += digit;
  updatePinDots(el.lockDots, state.lockInput.length);
  setLockError("");
  if (state.lockInput.length < 4) {
    return;
  }

  try {
    const verified = await verifyPin(state.lockInput);
    if (verified) {
      unlockApp();
      return;
    }
  } catch (error) {
    console.error(error);
  }

  state.lockInput = "";
  updatePinDots(el.lockDots, 0);
  setLockError("コードが違います。もう一度入力してください。");
}

function handleLockAction(action) {
  if (action === "delete") {
    state.lockInput = state.lockInput.slice(0, -1);
  } else if (action === "clear") {
    state.lockInput = "";
  }
  updatePinDots(el.lockDots, state.lockInput.length);
}

function isBekiRecorded(log) {
  return Boolean(String(log?.beki_text ?? "").trim());
}

function isBekiPending(log) {
  return !isBekiRecorded(log);
}

function getPendingBekiLogs(logs = state.angerLogs) {
  return logs.filter((log) => isBekiPending(log));
}

function updateReflectBadge() {
  if (!state.currentUser) {
    el.navReflectBadge.classList.add("hidden");
    el.navReflectBadge.textContent = "0";
    return;
  }

  const count = getPendingBekiLogs().length;
  if (count <= 0) {
    el.navReflectBadge.classList.add("hidden");
    el.navReflectBadge.textContent = "0";
    return;
  }

  el.navReflectBadge.textContent = count > 99 ? "99+" : String(count);
  el.navReflectBadge.classList.remove("hidden");
}

function getLogsWithLocation(logs = state.angerLogs) {
  return logs.filter((log) => {
    const latitude = Number(log?.location?.latitude);
    const longitude = Number(log?.location?.longitude);
    return Number.isFinite(latitude) && Number.isFinite(longitude);
  });
}

function formatLogDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "日時不明";
  }

  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${y}/${m}/${d} ${h}:${min}`;
}

function getIntensityColor(intensity) {
  if (intensity >= 9) {
    return "#a8322d";
  }
  if (intensity >= 7) {
    return "#df4a36";
  }
  if (intensity >= 4) {
    return "#ee9f39";
  }
  return "#4d8de0";
}

function resetMapDetail() {
  state.selectedMapLogId = null;
  el.mapDetailCard.classList.add("hidden");
}

function renderMapDetail(log) {
  state.selectedMapLogId = log.id;
  el.mapDetailIntensity.textContent = `${log.intensity}/10`;
  el.mapDetailIntensity.style.background = `${getIntensityColor(Number(log.intensity))}1a`;
  el.mapDetailIntensity.style.color = getIntensityColor(Number(log.intensity));
  el.mapDetailDate.textContent = formatLogDate(log.date);
  el.mapDetailPlace.textContent = log.place || "場所未入力";
  el.mapDetailEvent.textContent = log.event || "出来事未入力";
  el.mapDetailBeki.textContent = log.beki_text ? "べき入力済み" : "べき未入力";
  el.mapDetailCard.classList.remove("hidden");
}

function clearMapMarkers() {
  state.angerMapMarkers.forEach((marker) => {
    marker.map = null;
  });
  state.angerMapMarkers = [];
}

function setAuthActionState(action = null) {
  state.authActionInFlight = action;

  const isBusy = Boolean(action);
  el.authActionButton.disabled = isBusy || !state.authResolved;
  el.gateLoginButton.disabled = isBusy;
  el.userMenuLogoutButton.disabled = isBusy;

  if (action === "login") {
    el.authActionButton.textContent = "ログイン中…";
    el.gateLoginButton.textContent = "ログイン中…";
  } else if (action === "logout") {
    el.userMenuLogoutButton.textContent = "ログアウト中…";
  } else {
    el.gateLoginButton.textContent = "Google でログイン";
    el.userMenuLogoutButton.textContent = "ログアウト";
  }
}

async function resolveRedirectResultIfNeeded() {
  const hadPending = isRedirectPending();
  if (hadPending) {
    setAuthActionState("login");
  }

  try {
    const result = await getRedirectResult(auth);
    if (result?.user) {
      console.info("Google redirect sign-in resolved", {
        uid: result.user.uid,
        email: result.user.email || "",
      });
    } else if (hadPending) {
      console.warn("Google redirect sign-in returned no result after pending flag.");
    }
  } catch (error) {
    logAuthError(error, "redirect-result");
    if (isRequestedActionInvalidError(error)) {
      alert("Google ログインを完了できませんでした。Firebase Auth の Authorized Domains と authDomain を確認してください。");
    } else {
      alert(`ログインに失敗しました: ${error.message || ""}`);
    }
  } finally {
    markRedirectPending(false);
    setAuthActionState(null);
    renderAuthUi();
  }
}

function setMapStatus(message = "") {
  el.mapStatus.textContent = message;
  el.mapStatus.classList.toggle("hidden", !message);
}

function createMarkerContent(intensity) {
  const marker = document.createElement("div");
  marker.className = "anger-marker";
  marker.style.background = getIntensityColor(Number(intensity));

  const label = document.createElement("span");
  label.className = "anger-marker-label";
  label.textContent = String(intensity);

  marker.appendChild(label);
  return marker;
}

function getMapsConfigError() {
  if (!GOOGLE_MAPS_API_KEY || !GOOGLE_MAPS_MAP_ID) {
    return "Google Maps の設定が不足しています。`.env` の API キーと Map ID を確認してください。";
  }
  return "";
}

async function loadGoogleMapsApi() {
  if (state.googleMaps) {
    return state.googleMaps;
  }

  const configError = getMapsConfigError();
  if (configError) {
    throw new Error(configError);
  }

  if (!state.googleMapsPromise) {
    state.googleMapsPromise = new Promise((resolve, reject) => {
      if (window.google?.maps) {
        resolve(window.google.maps);
        return;
      }

      window.__angerLogInitGoogleMaps = () => {
        delete window.__angerLogInitGoogleMaps;
        resolve(window.google.maps);
      };

      const script = document.createElement("script");
      script.src =
        `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}` +
        `&v=weekly&libraries=marker&loading=async&callback=__angerLogInitGoogleMaps`;
      script.async = true;
      script.defer = true;
      script.onerror = () => {
        delete window.__angerLogInitGoogleMaps;
        reject(new Error("Google Maps の読み込みに失敗しました。"));
      };
      document.head.appendChild(script);
    }).then((maps) => {
      state.googleMaps = maps;
      return maps;
    });
  }

  return state.googleMapsPromise;
}

async function ensureAngerMapInstance() {
  const maps = await loadGoogleMapsApi();
  if (state.angerMap) {
    return { maps, map: state.angerMap };
  }

  state.angerMap = new maps.Map(el.angerMap, {
    center: { lat: 35.681236, lng: 139.767125 },
    zoom: 11,
    mapId: GOOGLE_MAPS_MAP_ID,
    fullscreenControl: false,
    mapTypeControl: false,
    streetViewControl: false,
  });

  return { maps, map: state.angerMap };
}

async function renderAngerMap() {
  if (!state.currentUser) {
    return;
  }

  setMapStatus("地図を準備しています…");
  el.angerMap.classList.add("hidden");
  el.mapEmptyState.classList.add("hidden");
  resetMapDetail();

  try {
    await loadAllLogs();
  } catch (error) {
    console.error(error);
    setMapStatus("ログの取得に失敗しました。");
    return;
  }

  const logs = getLogsWithLocation();
  if (logs.length === 0) {
    clearMapMarkers();
    setMapStatus("");
    el.mapEmptyState.classList.remove("hidden");
    return;
  }

  try {
    const { maps, map } = await ensureAngerMapInstance();
    const { AdvancedMarkerElement } = await maps.importLibrary("marker");
    const bounds = new maps.LatLngBounds();

    clearMapMarkers();

    logs.forEach((log) => {
      const position = {
        lat: Number(log.location.latitude),
        lng: Number(log.location.longitude),
      };

      const marker = new AdvancedMarkerElement({
        map,
        position,
        title: `${formatLogDate(log.date)} ${log.place || "場所未入力"}`,
        content: createMarkerContent(log.intensity),
      });

      marker.addListener("click", () => {
        renderMapDetail(log);
      });

      state.angerMapMarkers.push(marker);
      bounds.extend(position);
    });

    if (logs.length === 1) {
      map.setCenter(bounds.getCenter());
      map.setZoom(SINGLE_LOG_MAP_ZOOM);
      renderMapDetail(logs[0]);
    } else {
      map.fitBounds(bounds, 56);
      maps.event.addListenerOnce(map, "idle", () => {
        if (map.getZoom() > MAX_ANGER_MAP_ZOOM) {
          map.setZoom(MAX_ANGER_MAP_ZOOM);
        }
      });
    }

    maps.event.trigger(map, "resize");
    setMapStatus("");
    el.angerMap.classList.remove("hidden");
  } catch (error) {
    console.error(error);
    setMapStatus(error.message || "地図の表示に失敗しました。");
  }
}

function resetLocalState() {
  clearIdleTimer();
  state.angerLogs = [];
  state.latestLocation = null;
  state.reflectIndex = 0;
  state.reflectSingleMode = false;
  state.reflectList = [];
  state.currentScreen = "new";
  el.place.value = "";
  el.event.value = "";
  el.intensity.value = 5;
  el.intensityValue.textContent = "5";
  el.locationInfo.textContent = "※位置情報は未取得";
  el.listContainer.innerHTML = "";
  el.reflectContent.innerHTML = "";
  resetMapDetail();
  clearMapMarkers();
  setMapStatus("");
  el.mapEmptyState.classList.add("hidden");
  el.angerMap.classList.add("hidden");
  closeMenus();
  closeSettingsSheet();
  unlockApp();
  updateReflectBadge();
  switchScreen("new");
}

function renderAuthUi() {
  if (!state.authResolved) {
    el.authCard.classList.remove("hidden");
    el.authPrimaryText.textContent = "ログイン状態を確認しています";
    el.authSecondaryText.textContent = "少し待つと利用可能になります。";
    el.authStatusText.textContent = "Google ログイン後、自分のアンガーログだけを読み書きできます。";
    el.authActionButton.textContent = "読み込み中";
    el.authActionButton.disabled = true;
    el.authGate.classList.add("hidden");
    el.appShell.classList.add("hidden");
    el.bottomNav.classList.add("hidden");
    el.appMenuWrap.classList.add("hidden");
    el.userMenuWrap.classList.add("hidden");
    setAuthActionState(null);
    return;
  }

  if (!state.currentUser) {
    el.authCard.classList.remove("hidden");
    el.authPrimaryText.textContent = "未ログインです";
    el.authSecondaryText.textContent = "Google アカウントでログインすると、自分専用のログを使えます。";
    el.authStatusText.textContent = "未ログイン時は個人ログを読み書きしません。";
    el.authActionButton.textContent = "Google でログイン";
    el.authActionButton.disabled = Boolean(state.authActionInFlight);
    el.authGate.classList.remove("hidden");
    el.appShell.classList.add("hidden");
    el.bottomNav.classList.add("hidden");
    el.appMenuWrap.classList.add("hidden");
    el.userMenuWrap.classList.add("hidden");
    setAuthActionState(state.authActionInFlight);
    return;
  }

  el.authCard.classList.add("hidden");
  el.authGate.classList.add("hidden");
  el.appShell.classList.remove("hidden");
  el.bottomNav.classList.remove("hidden");
  el.appMenuWrap.classList.remove("hidden");
  el.userMenuWrap.classList.remove("hidden");
  updateUserMenu(state.currentUser);
  updateReflectBadge();
  setAuthActionState(state.authActionInFlight);
}

function updateNowText() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  el.nowText.textContent = `${y}/${m}/${d} ${h}:${min} に記録`;
}

function switchScreen(key) {
  state.currentScreen = key;
  el.screenNew.classList.add("hidden");
  el.screenList.classList.add("hidden");
  el.screenReflect.classList.add("hidden");
  el.screenMap.classList.add("hidden");
  el.navNew.classList.remove("active");
  el.navList.classList.remove("active");
  el.navReflect.classList.remove("active");

  if (key === "new") {
    el.screenNew.classList.remove("hidden");
    el.navNew.classList.add("active");
    el.appTitle.textContent = "アンガーログ";
    updateNowText();
  } else if (key === "list") {
    el.screenList.classList.remove("hidden");
    el.navList.classList.add("active");
    el.appTitle.textContent = "アンガーログ一覧";
    void renderList();
  } else if (key === "reflect") {
    el.screenReflect.classList.remove("hidden");
    el.navReflect.classList.add("active");
    el.appTitle.textContent = state.reflectSingleMode ? "べきの詳細" : "未記録のべきふりかえり";
    if (!state.reflectSingleMode) {
      void startReflection();
    }
    state.reflectSingleMode = false;
  } else if (key === "map") {
    el.screenMap.classList.remove("hidden");
    el.appTitle.textContent = "怒りマップ";
    void renderAngerMap();
  }
}

async function loadAllLogs() {
  state.angerLogs = await getAngerLogs(getCurrentUidOrThrow());
  updateReflectBadge();
  return state.angerLogs;
}

async function signInWithGoogle() {
  if (state.authActionInFlight) {
    return;
  }

  setAuthActionState("login");
  try {
    markRedirectPending(true);
    await signInWithRedirect(auth, provider);
  } catch (error) {
    logAuthError(error, "redirect-start");
    markRedirectPending(false);
    if (isRequestedActionInvalidError(error)) {
      alert("Google ログインを完了できませんでした。Firebase Auth の Authorized Domains と authDomain を確認してください。");
    } else {
      alert(`ログインに失敗しました: ${error.message || ""}`);
    }
  } finally {
    if (!isRedirectPending()) {
      setAuthActionState(null);
      renderAuthUi();
    }
  }
}

async function handleLogout() {
  if (state.authActionInFlight) {
    return;
  }

  setAuthActionState("logout");
  try {
    markRedirectPending(false);
    closeMenus();
    closeSettingsSheet();
    unlockApp();
    await signOut(auth);
  } catch (error) {
    console.error(error);
    alert(`ログアウトに失敗しました: ${error.message || ""}`);
  } finally {
    setAuthActionState(null);
    renderAuthUi();
  }
}

async function handleAuthAction() {
  if (!state.currentUser && !state.authActionInFlight) {
    await signInWithGoogle();
  }
}

function getCurrentLocation() {
  if (!state.currentUser) {
    alert("ログイン後に利用できます。");
    return;
  }

  if (!navigator.geolocation) {
    alert("この端末では位置情報が利用できません。");
    return;
  }

  el.locationInfo.textContent = "現在地を取得中…";
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude, accuracy } = position.coords;
      state.latestLocation = { latitude, longitude, accuracy };
      el.locationInfo.textContent =
        `位置情報：緯度 ${latitude.toFixed(5)} / 経度 ${longitude.toFixed(5)}（誤差約${Math.round(accuracy)}m）`;
    },
    (error) => {
      console.error(error);
      let message = "位置情報を取得できませんでした。";
      if (error.code === error.PERMISSION_DENIED) {
        message += " 位置情報の許可が必要です。";
      }
      el.locationInfo.textContent = message;
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    }
  );
}

async function saveAngerLog() {
  if (!state.currentUser) {
    alert("Google ログイン後に記録できます。");
    return;
  }

  const place = el.place.value.trim();
  const event = el.event.value.trim();
  const intensity = Number(el.intensity.value);

  if (!event) {
    alert("出来事を一言だけでも書いておこう。");
    return;
  }

  const now = new Date().toISOString();
  let savedLog;

  try {
    savedLog = await addAngerLog(getCurrentUidOrThrow(), {
      date: now,
      place,
      event,
      intensity,
      location: state.latestLocation,
      beki_date: null,
      beki_text: null,
      beki_importance: null,
    });
  } catch (error) {
    console.error(error);
    alert(`保存エラー: ${error.code || ""} / ${error.message || ""}`);
    return;
  }

  state.angerLogs.unshift({
    ...savedLog,
    createdAt: now,
    updatedAt: now,
  });
  updateReflectBadge();

  el.place.value = "";
  el.event.value = "";
  el.intensity.value = 5;
  el.intensityValue.textContent = "5";
  state.latestLocation = null;
  el.locationInfo.textContent = "※位置情報は未取得";
  updateNowText();
  if (state.currentScreen === "map") {
    void renderAngerMap();
  }

  alert("怒りを記録しました。");
}

async function renderList() {
  if (!state.currentUser) {
    el.listContainer.innerHTML = '<div class="small-text">ログインすると一覧を表示できます。</div>';
    return;
  }

  el.listContainer.innerHTML = '<div class="small-text">読み込み中…</div>';

  try {
    await loadAllLogs();
  } catch (error) {
    console.error(error);
    el.listContainer.innerHTML = '<div class="small-text">データの取得に失敗しました。</div>';
    return;
  }

  el.listContainer.innerHTML = "";

  if (state.angerLogs.length === 0) {
    el.listContainer.innerHTML = '<div class="small-text">まだ記録がありません。</div>';
    return;
  }

  state.angerLogs.forEach((log) => {
    const d = new Date(log.date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const h = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    const bekiDone = isBekiRecorded(log);
    const eventShort = `${log.event.slice(0, 40)}${log.event.length > 40 ? "…" : ""}`;
    const bekiShort = log.beki_text
      ? `${log.beki_text.slice(0, 40)}${log.beki_text.length > 40 ? "…" : ""}`
      : "";

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="card-header">
        <div>${y}/${m}/${day} ${h}:${min}</div>
        <div class="stars">${log.intensity}/10</div>
      </div>
      <div class="small-text">${log.place || "場所未記録"}</div>
      <div>${eventShort}</div>
      <div style="margin-top:4px;">
        <span class="badge-beki ${bekiDone ? "done" : ""}">
          ${bekiDone ? "べき記録あり" : "べき未記録"}
        </span>
      </div>
      ${bekiDone ? `
        <div class="small-text" style="margin-top:2px;">
          べき：${bekiShort}
        </div>
        <div class="small-text">
          重要度：${log.beki_importance}/5
        </div>
      ` : ""}
    `;
    card.addEventListener("click", () => openReflectForId(log.id));
    el.listContainer.appendChild(card);
  });
}

function openReflectForId(id) {
  const idx = state.angerLogs.findIndex((log) => log.id === id);
  if (idx === -1) {
    return;
  }

  state.reflectSingleMode = true;
  switchScreen("reflect");
  renderReflectionSingle(state.angerLogs[idx], true);
}

async function startReflection() {
  if (!state.currentUser) {
    el.reflectContent.innerHTML = '<div class="small-text">ログインするとふりかえりを使えます。</div>';
    return;
  }

  el.reflectContent.innerHTML = '<div class="small-text">読み込み中…</div>';

  try {
    await loadAllLogs();
  } catch (error) {
    console.error(error);
    el.reflectContent.innerHTML = '<div class="small-text">データの取得に失敗しました。</div>';
    return;
  }

  state.reflectList = getPendingBekiLogs()
    .sort((a, b) => (a.date > b.date ? -1 : 1));

  state.reflectIndex = 0;

  if (state.reflectList.length === 0) {
    el.reflectContent.innerHTML = '<div class="small-text">今日、べきを振り返る対象はありません。</div>';
    return;
  }

  renderReflectionStep();
}

function renderReflectionStep() {
  if (state.reflectIndex >= state.reflectList.length) {
    el.reflectContent.innerHTML = "<div>今日のべきログはすべて入力済みです。</div>";
    return;
  }

  renderReflectionSingle(state.reflectList[state.reflectIndex], false);
}

function renderReflectionSingle(log, singleMode) {
  const d = new Date(log.date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const existingBeki = log.beki_text || "";
  const existingImportance = log.beki_importance || 3;
  const existingPlace = log.place || "";
  const existingEvent = log.event || "";

  el.reflectContent.innerHTML = `
    <div class="section-title">このときの怒り</div>
    <div class="card">
      <div class="card-header">
        <div>${y}/${m}/${day} ${h}:${min}</div>
        <div class="stars">${log.intensity}/10</div>
      </div>

      <div class="section-title" style="font-size:12px; margin-top:4px;">場所（必要なら修正）</div>
      <input
        type="text"
        id="editPlace"
        value="${escapeHtml(existingPlace)}"
        placeholder="例：職場・自宅・車の中など"
        style="margin-bottom:4px;"
      />

      <div class="section-title" style="font-size:12px; margin-top:4px;">出来事（必要なら修正）</div>
      <textarea id="editEvent" style="margin-top:2px;">${escapeHtml(existingEvent)}</textarea>
    </div>

    <div class="section-title">この怒りの裏にあった「べき」</div>
    <textarea id="bekiText" placeholder="例：上司は予定変更をもっと早く伝えるべきだ">${escapeHtml(existingBeki)}</textarea>

    <div class="section-title">べきの重要度（1〜5）</div>
    <input type="range" id="bekiImportance" min="1" max="5" value="${existingImportance}" />
    <div class="small-text">
      重要度：<span id="bekiImportanceValue">${existingImportance}</span>/5
    </div>

    <button id="saveBekiButton" type="button" class="primary">
      このべきと怒りの内容を保存する
    </button>

    <button id="deleteLogButton" type="button" class="primary danger" style="margin-top:8px;">
      この記録を削除する
    </button>

    ${!singleMode ? `
      <div class="small-text" style="margin-top:8px; text-align:right;">
        (${state.reflectIndex + 1}件目 / ${state.reflectList.length}件)
      </div>
    ` : ""}
  `;

  const bekiImportance = document.getElementById("bekiImportance");
  const bekiImportanceValue = document.getElementById("bekiImportanceValue");
  const saveBekiButton = document.getElementById("saveBekiButton");
  const deleteLogButton = document.getElementById("deleteLogButton");

  bekiImportance.addEventListener("input", () => {
    bekiImportanceValue.textContent = bekiImportance.value;
  });
  saveBekiButton.addEventListener("click", () => {
    void saveBekiFor(log.id, singleMode);
  });
  deleteLogButton.addEventListener("click", () => {
    void deleteAngerLogEntry(log.id, singleMode);
  });
}

async function saveBekiFor(id, singleMode) {
  if (!state.currentUser) {
    alert("ログイン後に利用できます。");
    return;
  }

  const bekiText = document.getElementById("bekiText").value.trim();
  const importance = Number(document.getElementById("bekiImportance").value);
  const newPlace = document.getElementById("editPlace").value.trim();
  const newEvent = document.getElementById("editEvent").value.trim();
  const now = new Date().toISOString();

  if (!bekiText) {
    alert("べきの内容を一言だけでも書いておこう。");
    return;
  }

  try {
    await updateAngerLog(getCurrentUidOrThrow(), id, {
      place: newPlace,
      event: newEvent,
      beki_text: bekiText,
      beki_importance: importance,
      beki_date: now,
    });
  } catch (error) {
    console.error(error);
    alert(`保存エラー: ${error.code || ""} / ${error.message || ""}`);
    return;
  }

  const applyUpdate = (item) => ({
    ...item,
    place: newPlace,
    event: newEvent,
    beki_text: bekiText,
    beki_importance: importance,
    beki_date: now,
    updatedAt: now,
  });

  state.angerLogs = state.angerLogs.map((item) => (item.id === id ? applyUpdate(item) : item));
  state.reflectList = state.reflectList.map((item) => (item.id === id ? applyUpdate(item) : item));
  updateReflectBadge();
  if (state.currentScreen === "map") {
    void renderAngerMap();
  }

  alert("べきと怒りの内容を保存しました。");

  if (singleMode) {
    switchScreen("list");
  } else {
    state.reflectIndex += 1;
    renderReflectionStep();
  }
}

async function deleteAngerLogEntry(id, singleMode) {
  if (!state.currentUser) {
    alert("ログイン後に利用できます。");
    return;
  }

  if (!confirm("この記録を削除しますか？\n（べきログも含めて元に戻せません）")) {
    return;
  }

  try {
    await deleteAngerLog(getCurrentUidOrThrow(), id);
  } catch (error) {
    console.error(error);
    alert(`削除エラー: ${error.code || ""} / ${error.message || ""}`);
    return;
  }

  state.angerLogs = state.angerLogs.filter((item) => item.id !== id);
  state.reflectList = state.reflectList.filter((item) => item.id !== id);
  updateReflectBadge();
  if (state.currentScreen === "map") {
    void renderAngerMap();
  }

  if (singleMode) {
    switchScreen("list");
    return;
  }

  renderReflectionStep();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function handleDocumentClick(event) {
  const target = event.target;

  if (state.appMenuOpen && !el.appMenuWrap.contains(target)) {
    setAppMenuOpen(false);
  }

  if (state.userMenuOpen && !el.userMenuWrap.contains(target)) {
    setUserMenuOpen(false);
  }

  if (!el.settingsSheet.classList.contains("hidden") && target instanceof HTMLElement && target.dataset.sheetClose === "true") {
    closeSettingsSheet();
  }
}

function handleDocumentKeydown(event) {
  if (event.key !== "Escape") {
    return;
  }

  if (!el.settingsSheet.classList.contains("hidden")) {
    closeSettingsSheet();
    el.appMenuButton.focus();
    return;
  }

  if (state.userMenuOpen) {
    setUserMenuOpen(false);
    el.userMenuButton.focus();
    return;
  }

  if (state.appMenuOpen) {
    setAppMenuOpen(false);
    el.appMenuButton.focus();
  }
}

async function handleLockEnabledChange() {
  if (el.lockEnabledToggle.checked) {
    if (isAppLockEnabled()) {
      renderLockSettingsUi();
      scheduleIdleLock();
      return;
    }
    startLockSetupFlow("create");
    renderLockSettingsUi();
    return;
  }

  saveLockConfig({
    ...state.lockConfig,
    enabled: false,
    codeHash: "",
  });
  resetLockSetupFlow();
  renderLockSettingsUi();
  unlockApp();
}

function handleAutoLockChange() {
  saveLockConfig({
    ...state.lockConfig,
    autoLockMs: normalizeAutoLockMs(el.autoLockSelect.value),
  });
  renderLockSettingsUi();
  scheduleIdleLock();
}

function handleVisibilityChange() {
  if (document.visibilityState === "hidden") {
    state.lastHiddenAt = Date.now();
    clearIdleTimer();
    return;
  }

  if (shouldLockOnVisibilityReturn()) {
    void lockApp(LOCK_REASON_RESUME);
    return;
  }

  noteUserInteraction();
}

function showUpdateBanner(onReload) {
  if (state.serviceWorkerPromptShown) {
    return;
  }

  state.serviceWorkerPromptShown = true;

  const banner = document.createElement("div");
  banner.className = "update-banner";
  banner.innerHTML = `
    <div class="update-banner-text">新しいバージョンがあります。更新を反映するには再読み込みしてください。</div>
    <button type="button" class="update-banner-button">再読み込み</button>
  `;

  const reloadButton = banner.querySelector(".update-banner-button");
  reloadButton.addEventListener("click", () => {
    banner.remove();
    onReload();
  });

  document.body.appendChild(banner);
}

function setupServiceWorkerUpdateFlow() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  let refreshing = false;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing || state.isRefreshingForUpdate) {
      return;
    }
    refreshing = true;
    state.isRefreshingForUpdate = true;
    window.location.reload();
  });

  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("/service-worker.js");

      const promptToActivate = (worker) => {
        if (!worker) {
          return;
        }

        showUpdateBanner(() => {
          worker.postMessage({ type: "SKIP_WAITING" });
        });
      };

      if (registration.waiting) {
        promptToActivate(registration.waiting);
      }

      registration.addEventListener("updatefound", () => {
        const newWorker = registration.installing;
        if (!newWorker) {
          return;
        }

        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            promptToActivate(newWorker);
          }
        });
      });
    } catch (err) {
      console.error("ServiceWorker registration failed:", err);
    }
  });
}

el.intensity.addEventListener("input", () => {
  el.intensityValue.textContent = el.intensity.value;
});
el.locationButton.addEventListener("click", getCurrentLocation);
el.saveButton.addEventListener("click", () => {
  void saveAngerLog();
});
el.navNew.addEventListener("click", () => switchScreen("new"));
el.navList.addEventListener("click", () => switchScreen("list"));
el.navReflect.addEventListener("click", () => switchScreen("reflect"));
el.authActionButton.addEventListener("click", () => {
  void handleAuthAction();
});
el.gateLoginButton.addEventListener("click", () => {
  void handleAuthAction();
});
el.appMenuButton.addEventListener("click", () => {
  const nextOpen = !state.appMenuOpen;
  setUserMenuOpen(false);
  setAppMenuOpen(nextOpen);
});
el.appMapButton.addEventListener("click", () => {
  closeMenus();
  if (!state.currentUser) {
    alert("Google ログイン後に怒りマップを利用できます。");
    return;
  }
  switchScreen("map");
});
el.appLockSettingsButton.addEventListener("click", () => {
  openSettingsSheet();
});
el.mapBackButton.addEventListener("click", () => {
  switchScreen("new");
});
el.userMenuButton.addEventListener("click", () => {
  const nextOpen = !state.userMenuOpen;
  setAppMenuOpen(false);
  setUserMenuOpen(nextOpen);
});
el.settingsSheetCloseButton.addEventListener("click", () => {
  closeSettingsSheet();
});
el.lockEnabledToggle.addEventListener("change", () => {
  void handleLockEnabledChange();
});
el.autoLockSelect.addEventListener("change", handleAutoLockChange);
el.changeLockCodeButton.addEventListener("click", () => {
  startLockSetupFlow("change");
  renderLockSettingsUi();
});
el.setupKeyButtons.forEach((button) => {
  button.addEventListener("click", () => {
    handleSetupPadDigit(button.dataset.pinKey || "");
  });
});
el.setupActionButtons.forEach((button) => {
  button.addEventListener("click", () => {
    handleSetupPadAction(button.dataset.pinAction || "");
  });
});
el.lockKeyButtons.forEach((button) => {
  button.addEventListener("click", () => {
    void handleLockDigit(button.dataset.lockKey || "");
  });
});
el.lockActionButtons.forEach((button) => {
  button.addEventListener("click", () => {
    handleLockAction(button.dataset.lockAction || "");
  });
});
el.userMenuLogoutButton.addEventListener("click", () => {
  setUserMenuOpen(false);
  void handleLogout();
});
document.addEventListener("click", handleDocumentClick);
document.addEventListener("keydown", handleDocumentKeydown);
document.addEventListener("visibilitychange", handleVisibilityChange);
document.addEventListener("pointerdown", noteUserInteraction, { passive: true });
document.addEventListener("touchstart", noteUserInteraction, { passive: true });
document.addEventListener("keydown", () => {
  if (!state.isLocked) {
    noteUserInteraction();
  }
});

onAuthStateChanged(auth, async (user) => {
  try {
    state.authResolved = true;
    state.currentUser = user;

    if (!user) {
      state.lastHiddenAt = null;
      resetLocalState();
      if (isAppLockEnabled()) {
        await lockApp(LOCK_REASON_STARTUP);
      }
      renderAuthUi();
      return;
    }

    await ensureUserDocument(user);
    resetLocalState();
    await loadAllLogs();
  } catch (error) {
    console.error(error);
    state.currentUser = null;
    resetLocalState();
    alert(`ログイン状態の初期化に失敗しました: ${error.message || ""}`);
  }

  if (isAppLockEnabled()) {
    await lockApp(LOCK_REASON_STARTUP);
  } else {
    noteUserInteraction();
  }
  renderAuthUi();
});

updateNowText();
renderAuthUi();
if (isRedirectPending()) {
  setAuthActionState("login");
  renderAuthUi();
}
void resolveRedirectResultIfNeeded();
setupServiceWorkerUpdateFlow();
