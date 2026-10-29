// 2) Realtime Database must be created, with rules that allow the "dir*" nodes (see README.txt).
const firebaseConfig = {
  apiKey: "AIzaSyDKNg7dedOpIGa-KgkTumrd5YJ1v6hSq5Y",
  authDomain: "exam-b4cff.firebaseapp.com",
  databaseURL: "https://exam-b4cff-default-rtdb.firebaseio.com",
  projectId: "exam-b4cff",
  storageBucket: "exam-b4cff.appspot.com",
  messagingSenderId: "1007667430544",
  appId: "1:1007667430544:web:35568df312583f97ea0415",
  measurementId: "G-FB8EVHZQ3F"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth ? firebase.auth() : null; // only loaded on admin.html and setup.html
const TS = firebase.database.ServerValue.TIMESTAMP;
const $ = id => document.getElementById(id);
const slug = s => String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const pad = n => String(n).padStart(2, '0');
const localDate = (d = new Date()) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const hhmm = (d = new Date()) => pad(d.getHours()) + ':' + pad(d.getMinutes());
const fmt12 = t => { const [h, m] = t.split(':').map(Number); return ((h % 12) || 12) + ':' + pad(m) + ' ' + (h < 12 ? 'AM' : 'PM'); };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let serverOffset = 0;
db.ref('.info/serverTimeOffset').on('value', s => serverOffset = s.val() || 0);
const serverNow = () => Date.now() + serverOffset;
const DEFAULTS = { voiceRate: 0.9, encourageMins: 5, videoBase: 'https://meet.jit.si/', classRoom: 'MathCloudClass', lockUntilReady: true };
