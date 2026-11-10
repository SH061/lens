// 맥 스튜디오 서버 (외부 패키지 없음, Node 18+)
//   실행:      node server.js
//   교사 추가: node server.js adduser 이메일 비밀번호   (같은 이메일로 다시 하면 비밀번호 변경)
//   교사 삭제: node server.js deluser 이메일
// 환경변수: DATA_DIR(저장 폴더, 기본 외장하드), PORT(기본 3000)
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const DIR = process.env.DATA_DIR || '/Volumes/외장하드/성적돋보기-data';
const PORT = +process.env.PORT || 3000, MAX_USERS = +process.env.MAX_USERS || 50; // 가입 가능한 최대 인원
if (!fs.existsSync(path.dirname(DIR))) { console.error('저장 위치를 찾을 수 없습니다(외장하드 연결 확인):', DIR); process.exit(1); }
fs.mkdirSync(path.join(DIR, 'data'), { recursive: true });
const UF = path.join(DIR, 'users.json'), SF = path.join(DIR, 'secret.key');
if (!fs.existsSync(SF)) fs.writeFileSync(SF, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
const SECRET = fs.readFileSync(SF, 'utf8');
const users = () => { try { return JSON.parse(fs.readFileSync(UF, 'utf8')); } catch { return {}; } };
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
const atomic = (f, s) => { fs.writeFileSync(f + '.tmp', s); fs.renameSync(f + '.tmp', f); };

const [cmd, em, pw] = process.argv.slice(2);
if (cmd === 'adduser' || cmd === 'deluser') {
  const U = users(), e = (em || '').trim().toLowerCase();
  if (!e) { console.error('이메일을 입력하세요.'); process.exit(1); }
  if (cmd === 'deluser') { delete U[e]; atomic(UF, JSON.stringify(U, null, 1)); console.log('삭제(성적 파일은 data 폴더에 남아 있음):', e); process.exit(0); }
  if (!pw || pw.length < 6) { console.error('비밀번호는 6자 이상이어야 합니다.'); process.exit(1); }
  const salt = crypto.randomBytes(16).toString('hex');
  U[e] = { salt, hash: hash(pw, salt), id: (U[e] && U[e].id) || crypto.randomBytes(12).toString('hex') };
  atomic(UF, JSON.stringify(U, null, 1)); console.log('저장됨:', e); process.exit(0);
}

const sign = s => crypto.createHmac('sha256', SECRET).update(s).digest('hex');
const mkTok = email => { const b = email + '|' + (Date.now() + 30 * 864e5); return Buffer.from(b).toString('base64url') + '.' + sign(b); };
function who(req) { // 쿠키에서 로그인한 교사 이메일을 꺼낸다(위조·만료면 null)
  const m = /(?:^|; )lens=([^;]+)/.exec(req.headers.cookie || ''); if (!m) return null;
  const [b64, sig] = m[1].split('.'); if (!b64 || !sig) return null;
  const b = Buffer.from(b64, 'base64url').toString(), want = sign(b);
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  const [email, exp] = b.split('|');
  return +exp > Date.now() && users()[email] ? email : null;
}
const fails = {}; // shortcut: 메모리 기록이라 서버를 다시 켜면 초기화됨, 외부에 노출할 때는 충분
const body = req => new Promise((ok, no) => { let n = 0; const c = []; req.on('data', d => { n += d.length; if (n > 20e6) { no(413); req.destroy(); } else c.push(d); }); req.on('end', () => ok(Buffer.concat(c).toString())); });
const send = (res, code, obj, hdr = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...hdr }); res.end(JSON.stringify(obj)); };

http.createServer(async (req, res) => {
  try {
    const url = req.url.split('?')[0];
    if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
      return res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
    }
    if (url === '/api/login' && req.method === 'POST') {
      const { email = '', password = '' } = JSON.parse(await body(req) || '{}'), e = email.trim().toLowerCase();
      const k = req.socket.remoteAddress + '|' + e, f = fails[k] || { n: 0, t: 0 };
      if (f.n >= 5 && Date.now() - f.t < 600e3) return send(res, 429, { error: 'too many' });
      const u = users()[e];
      if (!u || hash(password, u.salt) !== u.hash) { fails[k] = { n: f.n + 1, t: Date.now() }; return send(res, 401, { error: 'bad login' }); }
      delete fails[k];
      const sec = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
      return send(res, 200, { email: e }, { 'set-cookie': `lens=${mkTok(e)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}${sec}` });
    }
    if (url === '/api/signup' && req.method === 'POST') { // 누구나 가입 가능하되 인원 상한과 IP당 횟수 제한으로 남용을 막는다
      const { email = '', password = '' } = JSON.parse(await body(req) || '{}'), e = email.trim().toLowerCase(), U = users();
      const k = 'signup|' + req.socket.remoteAddress, f = fails[k] || { n: 0, t: Date.now() };
      if (Date.now() - f.t > 3600e3) { f.n = 0; f.t = Date.now(); }
      if (f.n >= 5) return send(res, 429, { error: 'too many' });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || password.length < 6) return send(res, 400, { error: 'invalid' });
      if (U[e]) return send(res, 409, { error: 'exists' });
      if (Object.keys(U).length >= MAX_USERS) return send(res, 403, { error: 'full' });
      fails[k] = { n: f.n + 1, t: f.t };
      const salt = crypto.randomBytes(16).toString('hex');
      U[e] = { salt, hash: hash(password, salt), id: crypto.randomBytes(12).toString('hex') };
      atomic(UF, JSON.stringify(U, null, 1));
      const sec = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
      return send(res, 200, { email: e }, { 'set-cookie': `lens=${mkTok(e)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}${sec}` });
    }
    if (url === '/api/logout' && req.method === 'POST') return send(res, 200, {}, { 'set-cookie': 'lens=; HttpOnly; Path=/; Max-Age=0' });
    if (!url.startsWith('/api/')) return send(res, 404, { error: 'not found' });
    const email = who(req);
    if (!email) return send(res, 401, { error: 'login required' });
    if (url === '/api/me') return send(res, 200, { email });
    if (url === '/api/state') {
      const f = path.join(DIR, 'data', users()[email].id + '.json');
      if (req.method === 'GET') return send(res, 200, (() => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } })());
      if (req.method === 'PUT') { const s = await body(req); JSON.parse(s); atomic(f, s); return send(res, 200, { ok: true }); }
    }
    send(res, 404, { error: 'not found' });
  } catch (e) { send(res, typeof e === 'number' ? e : 500, { error: 'error' }); }
}).listen(PORT, () => console.log(`성적 돋보기 서버: http://localhost:${PORT}  (저장: ${DIR})`));
