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
// 프로그램 목록: 성적 돋보기(기본) + apps/<이름>/index.html 이 있는 폴더(선택적으로 app.json {"title","desc"}). 새 프로그램은 폴더만 넣으면 첫 화면에 카드가 생긴다.
function listApps() {
  const A = { lens: { title: '성적 돋보기', desc: '내신·모의고사 분석과 상담 자료', file: path.join(__dirname, 'index.html') } };
  const root = path.join(__dirname, 'apps');
  if (fs.existsSync(root)) for (const d of fs.readdirSync(root)) {
    const f = path.join(root, d, 'index.html');
    if (!/^[a-z0-9-]{1,30}$/.test(d) || d === 'api' || !fs.existsSync(f)) continue;
    let m = {}; try { m = JSON.parse(fs.readFileSync(path.join(root, d, 'app.json'), 'utf8')); } catch {}
    A[d] = { title: m.title || d, desc: m.desc || '', file: f };
  }
  return A;
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// 첫 화면: 로그인 전에는 로그인 화면, 로그인 후에는 프로그램 선택 화면 (Apple 스타일 + 머니그라피)
const CSS = `
@font-face{font-family:Moneygraphy;src:url(/fonts/Moneygraphy-Rounded.woff2) format("woff2");font-display:swap}
:root{--canvas:#fff;--parch:#f5f5f7;--ink:#1d1d1f;--mute:#6e6e73;--line:#d2d2d7;--primary:#0066cc;--tile:#272729;--on-tile:#f5f5f7;--on-tile-mute:#a1a1a6}
*{box-sizing:border-box}html{font-synthesis:none}
body{margin:0;font-family:Moneygraphy,-apple-system,"Apple SD Gothic Neo",sans-serif;font-weight:400;font-size:17px;line-height:1.47;color:var(--ink);background:var(--canvas);-webkit-font-smoothing:antialiased}
h1,h2,h3,p{margin:0;font-weight:400}button,input{font-family:inherit;font-size:17px}
.pill{display:block;width:100%;padding:12px 22px;border:0;border-radius:999px;background:var(--primary);color:#fff;text-align:center;text-decoration:none;cursor:pointer;transition:transform .15s}.pill:active{transform:scale(.95)}
.login{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px;background:var(--parch)}
.box{width:100%;max-width:400px;padding:40px 32px 32px;border:1px solid var(--line);border-radius:18px;background:var(--canvas);text-align:center}
.box h1{font-size:34px;line-height:1.12;letter-spacing:-.025em;margin-bottom:6px}.box .sub{color:var(--mute);margin-bottom:26px}
.box input{display:block;width:100%;padding:12px 18px;margin-bottom:10px;border:1px solid var(--line);border-radius:999px;background:var(--canvas);color:var(--ink);outline:0}.box input:focus{border-color:var(--primary)}
.box .pill{margin-top:16px}.msg{min-height:22px;margin-top:12px;font-size:15px;color:#d70015}
.sw{display:inline-block;margin-top:14px;color:var(--primary);font-size:15px;text-decoration:none}
.nav{position:sticky;top:0;z-index:5;height:48px;padding:0 22px;display:flex;align-items:center;justify-content:space-between;background:#000c;backdrop-filter:saturate(180%) blur(20px);color:var(--on-tile);font-size:14px}
.nav button{background:none;border:0;color:#2997ff;cursor:pointer;font-size:14px}
.tile{padding:80px 22px;text-align:center}.tile.parch{background:var(--parch)}.tile.dark{background:var(--tile);color:var(--on-tile)}
.hero h1{font-size:56px;line-height:1.07;letter-spacing:-.03em;margin-bottom:12px}.hero p{font-size:24px;line-height:1.2;color:var(--mute);letter-spacing:-.015em}
h2{font-size:34px;line-height:1.12;letter-spacing:-.025em;margin-bottom:36px}
.grid{max-width:980px;margin:0 auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px;text-align:left}
.card{display:block;padding:28px 24px 24px;border:1px solid var(--line);border-radius:18px;background:var(--canvas);color:inherit;text-decoration:none;transition:transform .15s}.card:active{transform:scale(.98)}
.card h3{font-size:24px;line-height:1.17;letter-spacing:-.02em;margin-bottom:8px}.card p{color:var(--mute);min-height:50px}.card span{display:block;margin-top:18px;color:var(--primary)}
.dark h2{margin-bottom:12px}.dark p{color:var(--on-tile-mute);max-width:560px;margin:0 auto}
@media(max-width:833px){.hero h1{font-size:40px}.hero p{font-size:19px}h2{font-size:28px}.tile{padding:56px 16px}}`;
const page = (body, script = '') => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>학교 업무 도구</title><style>${CSS}</style></head><body>${body}${script ? '<script>' + script + '</script>' : ''}</body></html>`;
const loginPage = () => page(`<main class="login"><form class="box" id="f"><h1 id="t">로그인</h1><p class="sub">학교 업무 도구</p>
<input id="e" type="email" placeholder="이메일(ID)" autocomplete="username" required><input id="p" type="password" placeholder="비밀번호 (6자 이상)" autocomplete="current-password" required>
<button class="pill" id="go">로그인</button><div class="msg" id="msg"></div><a class="sw" id="sw" href="#">처음이세요? 가입하기</a></form></main>`,
`var up=false,$=function(s){return document.querySelector(s)};
$('#sw').onclick=function(e){e.preventDefault();up=!up;$('#t').textContent=up?'가입':'로그인';$('#go').textContent=up?'가입하고 시작':'로그인';$('#sw').textContent=up?'이미 계정이 있어요':'처음이세요? 가입하기';$('#msg').textContent=''};
$('#f').onsubmit=async function(e){e.preventDefault();$('#msg').textContent='';
var r=await fetch(up?'/api/signup':'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:$('#e').value,password:$('#p').value})});
if(r.ok)return location.reload();
$('#msg').textContent=({401:'이메일 또는 비밀번호가 맞지 않습니다.',409:'이미 가입된 이메일입니다.',400:'올바른 이메일과 6자 이상 비밀번호를 입력하세요.',403:'가입 인원이 가득 찼습니다.',429:'시도가 많아 잠시 막혔습니다. 나중에 다시 하세요.'})[r.status]||'서버 오류'};`);
const home = (apps, email) => page(`<div class="nav"><span>${esc(email)}</span><button id="out">로그아웃</button></div>
<section class="tile hero"><h1>학교 업무 도구</h1><p>사용할 프로그램을 선택하세요.</p></section>
<section class="tile parch"><div class="grid">${Object.entries(apps).map(([k, a]) => `<a class="card" href="/${k}/"><h3>${esc(a.title)}</h3><p>${esc(a.desc)}</p><span>열기 ›</span></a>`).join('')}</div></section>
<section class="tile dark"><h2>한 번 로그인하면</h2><p>어느 프로그램에서든 같은 계정으로 이어서 쓸 수 있고, 성적과 메모는 본인 계정에만 저장됩니다.</p></section>`,
`document.getElementById('out').onclick=async function(){await fetch('/api/logout',{method:'POST'});location.reload()}`);
const fails = {}; // shortcut: 메모리 기록이라 서버를 다시 켜면 초기화됨, 외부에 노출할 때는 충분
const body = req => new Promise((ok, no) => { let n = 0; const c = []; req.on('data', d => { n += d.length; if (n > 20e6) { no(413); req.destroy(); } else c.push(d); }); req.on('end', () => ok(Buffer.concat(c).toString())); });
const send = (res, code, obj, hdr = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...hdr }); res.end(JSON.stringify(obj)); };

http.createServer(async (req, res) => {
  try {
    const url = req.url.split('?')[0];
    if (req.method === 'GET' && !url.startsWith('/api/')) { // 화면: 첫 화면(/)과 프로그램별 주소(/lens/, /다른이름/)
      const apps = listApps(), seg = url.split('/')[1];
      const html = (s) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' }); res.end(s); };
      const me = who(req);
      if (url === '/') return html(me ? home(apps, me) : loginPage());
      if (url === '/fonts/Moneygraphy-Rounded.woff2') { res.writeHead(200, { 'content-type': 'font/woff2', 'cache-control': 'public, max-age=604800' }); return res.end(fs.readFileSync(path.join(__dirname, 'fonts', 'Moneygraphy-Rounded.woff2'))); }
      if (apps[seg]) {
        if (!me) { res.writeHead(302, { location: '/' }); return res.end(); } // 로그인 전에는 첫 화면으로
        if (url === '/' + seg) { res.writeHead(301, { location: '/' + seg + '/' }); return res.end(); }
        if (url === '/' + seg + '/') return html(fs.readFileSync(apps[seg].file));
      }
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
      const app = new URL(req.url, 'http://x').searchParams.get('app') || 'lens'; // 프로그램마다 따로 저장(?app=이름), 성적 돋보기는 기존 파일 그대로
      if (!/^[a-z0-9-]{1,30}$/.test(app)) return send(res, 400, { error: 'bad app' });
      const f = path.join(DIR, 'data', users()[email].id + (app === 'lens' ? '' : '.' + app) + '.json');
      if (req.method === 'GET') return send(res, 200, (() => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } })());
      if (req.method === 'PUT') { const s = await body(req); JSON.parse(s); atomic(f, s); return send(res, 200, { ok: true }); }
    }
    send(res, 404, { error: 'not found' });
  } catch (e) { send(res, typeof e === 'number' ? e : 500, { error: 'error' }); }
}).listen(PORT, () => console.log(`성적 돋보기 서버: http://localhost:${PORT}  (저장: ${DIR})`));
