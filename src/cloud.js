// The Firebase connection: sign-in and the cloud database behind the sync adapter.
// Loaded on demand so the app still starts if the network is down.

const V = '10.12.2';
const BASE = 'https://www.gstatic.com/firebasejs/' + V + '/';
const COLLECTIONS = ['profiles', 'sessions', 'paused', 'meta', 'banks', 'bankq'];

export async function startCloud(config) {
  const [appMod, authMod, fs] = await Promise.all([
    import(BASE + 'firebase-app.js'),
    import(BASE + 'firebase-auth.js'),
    import(BASE + 'firebase-firestore.js'),
  ]);
  const app = appMod.initializeApp(config);
  const auth = authMod.getAuth(app);
  let db;
  try { // keep a copy on the device so only changes are downloaded and offline edits are remembered
    db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) });
  } catch (e) { db = fs.getFirestore(app); }

  return {
    onAuth: (cb) => authMod.onAuthStateChanged(auth, cb),
    signIn: (email, password) => authMod.signInWithEmailAndPassword(auth, email, password),
    signOut: () => authMod.signOut(auth),
    adapter(uid) {
      return {
        subscribe(onChanges, onError) {
          const stops = COLLECTIONS.map(col => fs.onSnapshot(
            fs.collection(db, 'families', uid, col),
            (snap) => onChanges(snap.docChanges().map(ch => ({ path: col + '/' + ch.doc.id, doc: ch.type === 'removed' ? null : ch.doc.data() }))),
            onError,
          ));
          return () => stops.forEach(stop => stop());
        },
        set(path, data) {
          const i = path.indexOf('/');
          return fs.setDoc(fs.doc(db, 'families', uid, path.slice(0, i), path.slice(i + 1)), data);
        },
      };
    },
  };
}

// Plain-English version of the errors a parent might see.
export function friendlyError(e) {
  const code = String((e && e.code) || '');
  if (/invalid-credential|wrong-password|user-not-found|invalid-login/.test(code)) return 'That email or password is not right.';
  if (/network/.test(code)) return 'Could not reach the internet. Try again when you are online.';
  if (/too-many/.test(code)) return 'Too many tries. Wait a minute and try again.';
  if (/permission-denied/.test(code)) return 'The database refused access. Check the Firestore rules.';
  return (e && e.message) ? String(e.message) : 'Something went wrong.';
}
