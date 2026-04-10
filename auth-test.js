import { initializeApp } from "firebase/app";
import {
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithRedirect,
  signOut,
} from "firebase/auth";

const env = import.meta.env;
const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

const requiredEntries = [
  ["apiKey", firebaseConfig.apiKey],
  ["authDomain", firebaseConfig.authDomain],
  ["projectId", firebaseConfig.projectId],
  ["storageBucket", firebaseConfig.storageBucket],
  ["messagingSenderId", firebaseConfig.messagingSenderId],
  ["appId", firebaseConfig.appId],
];

const missingEnvKeys = requiredEntries.filter(([, value]) => !value).map(([key]) => key);
if (missingEnvKeys.length > 0) {
  throw new Error(`Firebase config missing: ${missingEnvKeys.join(", ")}`);
}

const REDIRECT_PENDING_KEY = "angerlog.auth_test.redirect_pending";
const app = initializeApp(firebaseConfig, "auth-test");
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

const el = {
  loginButton: document.getElementById("loginButton"),
  logoutButton: document.getElementById("logoutButton"),
  busyState: document.getElementById("busyState"),
  authState: document.getElementById("authState"),
  redirectState: document.getElementById("redirectState"),
  lastError: document.getElementById("lastError"),
  uid: document.getElementById("uid"),
  displayName: document.getElementById("displayName"),
  email: document.getElementById("email"),
  origin: document.getElementById("origin"),
  authDomain: document.getElementById("authDomain"),
  userAgent: document.getElementById("userAgent"),
  swController: document.getElementById("swController"),
};

const state = {
  busy: "idle",
  lastError: null,
  authReady: false,
};

function markRedirectPending(active) {
  if (active) {
    sessionStorage.setItem(REDIRECT_PENDING_KEY, "1");
    return;
  }
  sessionStorage.removeItem(REDIRECT_PENDING_KEY);
}

function isRedirectPending() {
  return sessionStorage.getItem(REDIRECT_PENDING_KEY) === "1";
}

function errorToText(error) {
  if (!error) {
    return "なし";
  }
  return JSON.stringify(
    {
      code: error.code || "",
      message: error.message || "",
      stack: error.stack || "",
      customData: error.customData || null,
      origin: window.location.origin,
      path: window.location.pathname + window.location.search + window.location.hash,
      authDomain: firebaseConfig.authDomain,
    },
    null,
    2
  );
}

function renderUser(user) {
  if (!user) {
    el.authState.textContent = "未ログイン";
    el.uid.textContent = "-";
    el.displayName.textContent = "-";
    el.email.textContent = "-";
    return;
  }

  el.authState.textContent = "ログイン済み";
  el.uid.textContent = user.uid || "-";
  el.displayName.textContent = user.displayName || "-";
  el.email.textContent = user.email || "-";
}

function render() {
  el.busyState.textContent = state.busy;
  el.lastError.textContent = errorToText(state.lastError);
  el.lastError.classList.toggle("error", Boolean(state.lastError));

  const busy = state.busy !== "idle";
  el.loginButton.disabled = busy;
  el.logoutButton.disabled = busy;
}

function setBusy(next) {
  state.busy = next;
  render();
}

function setLastError(error) {
  state.lastError = error;
  if (error) {
    console.error("[auth-test] error", {
      code: error.code || "",
      message: error.message || "",
      stack: error.stack || "",
      customData: error.customData || null,
    });
  }
  render();
}

async function startRedirectLogin() {
  if (state.busy !== "idle") {
    return;
  }

  setLastError(null);
  setBusy("redirect-starting");
  console.info("[auth-test] redirect start");

  try {
    markRedirectPending(true);
    await signInWithRedirect(auth, provider);
  } catch (error) {
    markRedirectPending(false);
    setLastError(error);
    setBusy("idle");
  }
}

async function runRedirectResult() {
  const pending = isRedirectPending();
  if (pending) {
    console.info("[auth-test] redirect return detected");
    setBusy("redirect-processing");
    el.redirectState.textContent = "処理中";
  } else {
    el.redirectState.textContent = "結果なし";
  }

  console.info("[auth-test] getRedirectResult start");
  try {
    const result = await getRedirectResult(auth);
    if (result?.user) {
      console.info("[auth-test] getRedirectResult success", {
        uid: result.user.uid,
        email: result.user.email || "",
      });
      el.redirectState.textContent = "成功";
    } else {
      console.info("[auth-test] getRedirectResult no result");
      if (pending) {
        el.redirectState.textContent = "結果なし（pendingあり）";
      } else {
        el.redirectState.textContent = "結果なし";
      }
    }
    setLastError(null);
  } catch (error) {
    console.error("[auth-test] getRedirectResult failed", error);
    el.redirectState.textContent = "失敗";
    setLastError(error);
  } finally {
    markRedirectPending(false);
    setBusy("idle");
  }
}

async function logout() {
  if (state.busy !== "idle") {
    return;
  }

  setBusy("logout-processing");
  setLastError(null);
  console.info("[auth-test] logout start");
  try {
    markRedirectPending(false);
    await signOut(auth);
    console.info("[auth-test] logout success");
  } catch (error) {
    setLastError(error);
  } finally {
    setBusy("idle");
  }
}

function bindStaticInfo() {
  el.origin.textContent = window.location.origin;
  el.authDomain.textContent = firebaseConfig.authDomain || "-";
  el.userAgent.textContent = navigator.userAgent;
  el.swController.textContent = navigator.serviceWorker?.controller ? "有効" : "なし";
}

function bindEvents() {
  el.loginButton.addEventListener("click", () => {
    void startRedirectLogin();
  });
  el.logoutButton.addEventListener("click", () => {
    void logout();
  });
}

function observeAuthState() {
  onAuthStateChanged(auth, (user) => {
    state.authReady = true;
    console.info("[auth-test] onAuthStateChanged", {
      uid: user?.uid || null,
      email: user?.email || null,
    });
    renderUser(user);
  });
}

bindStaticInfo();
bindEvents();
renderUser(null);
render();
observeAuthState();
void runRedirectResult();
