import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
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

enableIndexedDbPersistence(db).catch((err) => {
  console.warn("オフライン永続化エラー:", err.code);
});

const state = {
  currentUser: null,
  angerLogs: [],
  latestLocation: null,
  reflectIndex: 0,
  reflectSingleMode: false,
  reflectList: [],
  authResolved: false,
  userMenuOpen: false,
  serviceWorkerPromptShown: false,
  isRefreshingForUpdate: false,
};

const el = {
  appTitle: document.getElementById("appTitle"),
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
  navNew: document.getElementById("nav-new"),
  navList: document.getElementById("nav-list"),
  navReflect: document.getElementById("nav-reflect"),
  navReflectBadge: document.getElementById("nav-reflect-badge"),
};

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

function setUserMenuOpen(open) {
  state.userMenuOpen = open;
  el.userMenuPopover.classList.toggle("hidden", !open);
  el.userMenuButton.setAttribute("aria-expanded", String(open));
}

function updateUserMenu(user) {
  el.userMenuName.textContent = getDisplayName(user);
  el.userMenuEmail.textContent = getEmail(user);
  renderUserAvatar(user);
}

function getPendingReflectionLogs(logs = state.angerLogs) {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();
  const d = today.getDate();

  return logs.filter((log) => {
    const logDate = new Date(log.date);
    return (
      logDate.getFullYear() === y &&
      logDate.getMonth() === m &&
      logDate.getDate() === d &&
      !log.beki_text
    );
  });
}

function updateReflectBadge() {
  if (!state.currentUser) {
    el.navReflectBadge.classList.add("hidden");
    el.navReflectBadge.textContent = "0";
    return;
  }

  const count = getPendingReflectionLogs().length;
  if (count <= 0) {
    el.navReflectBadge.classList.add("hidden");
    el.navReflectBadge.textContent = "0";
    return;
  }

  el.navReflectBadge.textContent = count > 99 ? "99+" : String(count);
  el.navReflectBadge.classList.remove("hidden");
}

function resetLocalState() {
  state.angerLogs = [];
  state.latestLocation = null;
  state.reflectIndex = 0;
  state.reflectSingleMode = false;
  state.reflectList = [];
  el.place.value = "";
  el.event.value = "";
  el.intensity.value = 5;
  el.intensityValue.textContent = "5";
  el.locationInfo.textContent = "※位置情報は未取得";
  el.listContainer.innerHTML = "";
  el.reflectContent.innerHTML = "";
  setUserMenuOpen(false);
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
    el.userMenuWrap.classList.add("hidden");
    return;
  }

  if (!state.currentUser) {
    el.authCard.classList.remove("hidden");
    el.authPrimaryText.textContent = "未ログインです";
    el.authSecondaryText.textContent = "Google アカウントでログインすると、自分専用のログを使えます。";
    el.authStatusText.textContent = "未ログイン時は個人ログを読み書きしません。";
    el.authActionButton.textContent = "Google でログイン";
    el.authActionButton.disabled = false;
    el.authGate.classList.remove("hidden");
    el.appShell.classList.add("hidden");
    el.bottomNav.classList.add("hidden");
    el.userMenuWrap.classList.add("hidden");
    return;
  }

  el.authCard.classList.add("hidden");
  el.authGate.classList.add("hidden");
  el.appShell.classList.remove("hidden");
  el.bottomNav.classList.remove("hidden");
  el.userMenuWrap.classList.remove("hidden");
  updateUserMenu(state.currentUser);
  updateReflectBadge();
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
  el.screenNew.classList.add("hidden");
  el.screenList.classList.add("hidden");
  el.screenReflect.classList.add("hidden");
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
    el.appTitle.textContent = state.reflectSingleMode ? "べきの詳細" : "今日のべきふりかえり";
    if (!state.reflectSingleMode) {
      void startReflection();
    }
    state.reflectSingleMode = false;
  }
}

async function loadAllLogs() {
  state.angerLogs = await getAngerLogs(getCurrentUidOrThrow());
  updateReflectBadge();
  return state.angerLogs;
}

async function signInWithGoogle() {
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    console.error(error);
    alert(`ログインに失敗しました: ${error.message || ""}`);
  }
}

async function handleLogout() {
  try {
    await signOut(auth);
  } catch (error) {
    console.error(error);
    alert(`ログアウトに失敗しました: ${error.message || ""}`);
  }
}

async function handleAuthAction() {
  if (!state.currentUser) {
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
    const bekiDone = !!log.beki_text;
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

  state.reflectList = getPendingReflectionLogs()
    .sort((a, b) => (a.date > b.date ? 1 : -1));

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
  if (!state.userMenuOpen) {
    return;
  }

  if (el.userMenuWrap.contains(event.target)) {
    return;
  }

  setUserMenuOpen(false);
}

function handleDocumentKeydown(event) {
  if (event.key === "Escape" && state.userMenuOpen) {
    setUserMenuOpen(false);
    el.userMenuButton.focus();
  }
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
  void signInWithGoogle();
});
el.userMenuButton.addEventListener("click", () => {
  setUserMenuOpen(!state.userMenuOpen);
});
el.userMenuLogoutButton.addEventListener("click", () => {
  setUserMenuOpen(false);
  void handleLogout();
});
document.addEventListener("click", handleDocumentClick);
document.addEventListener("keydown", handleDocumentKeydown);

onAuthStateChanged(auth, async (user) => {
  try {
    state.authResolved = true;
    state.currentUser = user;

    if (!user) {
      resetLocalState();
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

  renderAuthUi();
});

updateNowText();
renderAuthUi();
setupServiceWorkerUpdateFlow();
