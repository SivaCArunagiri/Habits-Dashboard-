import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, doc, getDoc, setDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBoME_MVHbsO9whEgUAO36f6TtZhKbO4wU",
  authDomain: "keystone-2026001.firebaseapp.com",
  projectId: "keystone-2026001",
  storageBucket: "keystone-2026001.firebasestorage.app",
  messagingSenderId: "87760260546",
  appId: "1:87760260546:web:e42377d6531ffd58661a5b"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
let db;
try {
  db = initializeFirestore(app, { localCache: persistentLocalCache() });
} catch (e) {
  // persistent cache unavailable (e.g. private browsing, multiple tabs) — fall back to default
  const { getFirestore } = await import("https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js");
  db = getFirestore(app);
}

let currentUser = null;
let unsubscribeSnapshot = null;
let pushTimer = null;

function sanitize(state) {
  return JSON.parse(JSON.stringify(state));
}

function mergeStates(local, remote) {
  const merged = JSON.parse(JSON.stringify(local));
  ['habits', 'yearlyHabits', 'supplements'].forEach(key => {
    const remoteList = Array.isArray(remote[key]) ? remote[key] : [];
    const localIds = new Set((merged[key] || []).map(item => item.id));
    remoteList.forEach(item => { if (!localIds.has(item.id)) merged[key].push(item); });
  });
  ['logs', 'habitNotes', 'yearlyLogs', 'yearlyHistory', 'supplementLogs'].forEach(key => {
    const remoteMap = remote[key] || {};
    merged[key] = merged[key] || {};
    Object.keys(remoteMap).forEach(id => {
      merged[key][id] = Object.assign({}, remoteMap[id], merged[key][id]);
    });
  });
  merged.notes = Object.assign({}, remote.notes || {}, merged.notes || {});
  return merged;
}

function waitForApp() {
  return new Promise(resolve => {
    if (window.KeystoneApp) return resolve();
    const check = setInterval(() => {
      if (window.KeystoneApp) { clearInterval(check); resolve(); }
    }, 30);
  });
}

function $(sel) { return document.querySelector(sel); }

function setStatus(text) {
  const el = $('#sync-status-text');
  if (el) el.textContent = text;
}

function renderAuthUI(user) {
  const signedOutBox = $('#sync-signed-out');
  const signedInBox = $('#sync-signed-in');
  if (!signedOutBox || !signedInBox) return;
  if (user) {
    signedOutBox.hidden = true;
    signedInBox.hidden = false;
    $('#sync-email-display').textContent = user.email;
    setStatus('Signed in — synced across your devices.');
  } else {
    signedOutBox.hidden = false;
    signedInBox.hidden = true;
    setStatus('Not signed in — your data stays on this device only.');
  }
}

async function performInitialSync(uid) {
  setStatus('Syncing…');
  const ref = doc(db, 'users', uid);
  try {
    const snap = await getDoc(ref);
    const local = window.KeystoneApp.getState();
    if (snap.exists()) {
      const merged = mergeStates(local, snap.data());
      window.KeystoneApp.replaceState(merged);
      await setDoc(ref, sanitize(merged));
    } else {
      await setDoc(ref, sanitize(local));
    }
    setStatus('Signed in — synced across your devices.');
  } catch (e) {
    console.warn('Initial sync failed', e);
    setStatus('Signed in — could not reach the cloud yet, will retry.');
  }
  subscribeSnapshot(uid);
}

function subscribeSnapshot(uid) {
  if (unsubscribeSnapshot) unsubscribeSnapshot();
  unsubscribeSnapshot = onSnapshot(doc(db, 'users', uid), snap => {
    if (!snap.exists() || snap.metadata.hasPendingWrites) return;
    window.KeystoneApp.replaceState(snap.data());
    setStatus('Synced just now.');
  }, err => console.warn('Sync listener error', err));
}

function schedulePush(state) {
  if (!currentUser) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    setDoc(doc(db, 'users', currentUser.uid), sanitize(state)).catch(err => console.warn('Sync push failed', err));
  }, 800);
}

function friendlyAuthError(err) {
  const map = {
    'auth/email-already-in-use': 'An account already exists for that email — try signing in instead.',
    'auth/invalid-email': 'That email address doesn\'t look right.',
    'auth/weak-password': 'Password needs to be at least 6 characters.',
    'auth/wrong-password': 'Wrong password.',
    'auth/invalid-credential': 'Wrong email or password.',
    'auth/user-not-found': 'No account found for that email.',
    'auth/too-many-requests': 'Too many attempts — try again in a bit.'
  };
  return map[err.code] || 'Something went wrong — try again.';
}

async function init() {
  await waitForApp();

  onAuthStateChanged(auth, user => {
    currentUser = user;
    renderAuthUI(user);
    if (user) {
      performInitialSync(user.uid);
    } else if (unsubscribeSnapshot) {
      unsubscribeSnapshot();
      unsubscribeSnapshot = null;
    }
  });

  window.KeystoneApp.onLocalSave = schedulePush;

  $('#sync-signup-btn').addEventListener('click', async () => {
    const email = $('#sync-email').value.trim();
    const password = $('#sync-password').value;
    if (!email || password.length < 6) { window.KeystoneApp.toast('Enter an email and a 6+ character password'); return; }
    try {
      await createUserWithEmailAndPassword(auth, email, password);
      window.KeystoneApp.toast('Account created — syncing…');
    } catch (e) { window.KeystoneApp.toast(friendlyAuthError(e)); }
  });

  $('#sync-signin-btn').addEventListener('click', async () => {
    const email = $('#sync-email').value.trim();
    const password = $('#sync-password').value;
    if (!email || !password) { window.KeystoneApp.toast('Enter your email and password'); return; }
    try {
      await signInWithEmailAndPassword(auth, email, password);
      window.KeystoneApp.toast('Signed in — syncing…');
    } catch (e) { window.KeystoneApp.toast(friendlyAuthError(e)); }
  });

  $('#sync-forgot-btn').addEventListener('click', async () => {
    const email = $('#sync-email').value.trim();
    if (!email) { window.KeystoneApp.toast('Enter your email first'); return; }
    try {
      await sendPasswordResetEmail(auth, email);
      window.KeystoneApp.toast('Password reset email sent');
    } catch (e) { window.KeystoneApp.toast(friendlyAuthError(e)); }
  });

  $('#sync-signout-btn').addEventListener('click', async () => {
    await signOut(auth);
    window.KeystoneApp.toast('Signed out — this device is local-only again');
  });
}

init();
