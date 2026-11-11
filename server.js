// 맥 스튜디오 서버 (외부 패키지 없음, Node 18+)
//   실행:      node server.js
//   계정 추가: node server.js adduser 이름 비밀번호        (같은 이름으로 다시 하면 비밀번호 변경, 바로 승인됨)
//   관리자:    node server.js adduser 이름 비밀번호 admin   (관리자 화면 /admin 사용 가능)
//   계정 삭제: node server.js deluser 이름
// 가입 신청은 승인 대기 상태로 들어오고, 관리자 화면에서 승인해야 로그인할 수 있습니다.
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

const [cmd, em, pw, flag] = process.argv.slice(2);
const normName = x => String(x || '').trim().toLowerCase();
const okName = x => x.length >= 1 && x.length <= 30 && !x.includes('|'); // '|'는 로그인 쿠키 구분자라 금지
if (cmd === 'adduser' || cmd === 'deluser') {
  const U = users(), e = normName(em);
  if (!okName(e)) { console.error('이름을 입력하세요(30자 이하, | 제외).'); process.exit(1); }
  if (cmd === 'deluser') { delete U[e]; atomic(UF, JSON.stringify(U, null, 1)); console.log('삭제(성적 파일은 data 폴더에 남아 있음):', e); process.exit(0); }
  if (!pw || pw.length < 6) { console.error('비밀번호는 6자 이상이어야 합니다.'); process.exit(1); }
  const salt = crypto.randomBytes(16).toString('hex');
  U[e] = { salt, hash: hash(pw, salt), id: (U[e] && U[e].id) || crypto.randomBytes(12).toString('hex'), status: 'approved', admin: flag === 'admin' || !!(U[e] && U[e].admin), at: (U[e] && U[e].at) || new Date().toISOString() };
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
  const u = users()[email];
  return +exp > Date.now() && u && u.status !== 'pending' ? email : null; // status 없는 기존 계정은 승인된 것으로 본다
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
.box .pill{margin-top:16px}.msg{min-height:22px;margin-top:12px;font-size:15px;color:var(--mute)}
.login.up{background:var(--tile)}.login.up .box{background:#1d1d1f;border-color:#3a3a3c;color:var(--on-tile)}.login.up .box input{background:#2c2c2e;border-color:#3a3a3c;color:var(--on-tile)}.login.up .sub{color:var(--on-tile-mute)}.login.up .sw{color:#2997ff}.login.up .msg{color:var(--on-tile-mute)}.pw{position:relative;margin-bottom:10px}.pw[hidden]{display:none}.pw input{margin-bottom:0;padding-right:48px}.eye{position:absolute;right:6px;top:50%;transform:translateY(-50%);width:38px;height:38px;border:0;border-radius:50%;background:none;color:var(--mute);cursor:pointer;display:flex;align-items:center;justify-content:center}.eye .sl{display:none}.eye.on .sl{display:inline}.eye.on{color:var(--primary)}.login.up .eye.on{color:#2997ff}
.sw{display:inline-block;margin-top:14px;color:var(--primary);font-size:15px;text-decoration:none}
.nav{position:sticky;top:0;z-index:5;height:48px;padding:0 22px;display:flex;align-items:center;justify-content:space-between;background:#000c;backdrop-filter:saturate(180%) blur(20px);color:var(--on-tile);font-size:14px}
.nav .adm{color:#2997ff;text-decoration:none;font-size:14px;margin-right:18px}.nav button{background:none;border:0;color:#2997ff;cursor:pointer;font-size:14px}
.tile{padding:80px 22px;text-align:center}.tile.parch{background:var(--parch)}.tile.dark{background:var(--tile);color:var(--on-tile)}
.hero h1{font-size:56px;line-height:1.07;letter-spacing:-.03em;margin-bottom:12px}.hero p{font-size:24px;line-height:1.2;color:var(--mute);letter-spacing:-.015em}
h2{font-size:34px;line-height:1.12;letter-spacing:-.025em;margin-bottom:36px}
.grid{max-width:980px;margin:0 auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px;text-align:left}
.card{display:block;padding:28px 24px 24px;border:1px solid var(--line);border-radius:18px;background:var(--canvas);color:inherit;text-decoration:none;transition:transform .15s}.card:active{transform:scale(.98)}
.card h3{font-size:24px;line-height:1.17;letter-spacing:-.02em;margin-bottom:8px}.card p{color:var(--mute);min-height:50px}.card span{display:block;margin-top:18px;color:var(--primary)}
.dark h2{margin-bottom:12px}.dark p{color:var(--on-tile-mute);margin:0 auto}@media(min-width:834px){.dark p{white-space:nowrap}}
@media(max-width:833px){.hero h1{font-size:40px}.hero p{font-size:19px}h2{font-size:28px}.tile{padding:56px 16px}}`;
const page = (body, script = '') => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>학교 업무 도구</title><style>${CSS}</style></head><body>${body}${script ? '<script>' + script + '</script>' : ''}</body></html>`;
const eyeBtn = '<button type="button" class="eye" aria-label="비밀번호 보기" tabindex="-1"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/><path class="sl" d="M3 3l18 18"/></svg></button>';
const loginPage = () => page(`<main class="login"><form class="box" id="f"><h1 id="t">로그인</h1><p class="sub" id="sub">학교 업무 도구</p>
<input id="e" type="text" maxlength="30" placeholder="이름" autocomplete="username" required><div class="pw"><input id="p" type="password" inputmode="latin" autocapitalize="off" autocorrect="off" spellcheck="false" style="ime-mode:disabled" placeholder="비밀번호" autocomplete="current-password" required>${eyeBtn}</div><div class="pw" id="p2w" hidden><input id="p2" type="password" inputmode="latin" autocapitalize="off" autocorrect="off" spellcheck="false" style="ime-mode:disabled" placeholder="비밀번호 확인" autocomplete="new-password">${eyeBtn}</div>
<button class="pill" id="go">로그인</button><div class="msg" id="msg"></div><a class="sw" id="sw" href="#">처음이세요? 가입하기</a></form></main>`,
`var up=false,$=function(s){return document.querySelector(s)};
/* 비밀번호 칸: 한글 상태에서 눌러도 영문 자판 글자로 바꿔 넣는다(ㅂ→q). 브라우저는 입력기 전환을 강제할 수 없어 입력된 한글을 변환한다 */
var KI=['r','R','s','e','E','f','a','q','Q','t','T','d','w','W','c','z','x','v','g'],KV=['k','o','i','O','j','p','u','P','h','hk','ho','hl','y','n','nj','np','nl','b','m','ml','l'],KF=['','r','R','rt','s','sw','sg','e','f','fr','fa','fq','ft','fx','fv','fg','a','q','qt','t','T','d','w','c','z','x','v','g'],
JA='ㄱㄲㄳㄴㄵㄶㄷㄸㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅃㅄㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ',JK=['r','R','rt','s','sw','sg','e','E','f','fr','fa','fq','ft','fx','fv','fg','a','q','Q','qt','t','T','d','w','W','c','z','x','v','g'],VO='ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
function eng(t){return t.replace(/[가-힣ㄱ-ㅣ]/g,function(c){var n=c.charCodeAt(0);if(n>=44032){n-=44032;return KI[Math.floor(n/588)]+KV[Math.floor(n%588/28)]+KF[n%28]}var a=JA.indexOf(c);return a>=0?JK[a]:KV[VO.indexOf(c)]})}
function fixPw(e){var el=e.target,v=el.value,c=eng(v);if(c!==v)el.value=c}
['#p','#p2'].forEach(function(id){$(id).addEventListener('input',function(e){if(!e.isComposing)fixPw(e)});$(id).addEventListener('compositionend',fixPw)});
Array.prototype.forEach.call(document.querySelectorAll('.eye'),function(b){b.onclick=function(){var i=b.previousElementSibling,show=i.type==='password';i.type=show?'text':'password';b.classList.toggle('on',show);b.setAttribute('aria-label',show?'비밀번호 숨기기':'비밀번호 보기');i.focus()}});
function mode(u){up=u;$('.login').classList.toggle('up',u);$('#t').textContent=u?'가입 신청':'로그인';$('#sub').textContent=u?'신청하면 관리자가 승인한 뒤 사용할 수 있어요':'학교 업무 도구';$('#go').textContent=u?'가입 신청하기':'로그인';$('#sw').textContent=u?'이미 계정이 있어요':'처음이세요? 가입하기';$('#p2w').hidden=!u;$('#p2').value='';$('#msg').textContent='';document.title=u?'가입 신청':'학교 업무 도구'}
$('#sw').onclick=function(e){e.preventDefault();mode(!up)};
$('#f').onsubmit=async function(e){e.preventDefault();$('#msg').textContent='';
if(up&&$('#p').value!==$('#p2').value)return $('#msg').textContent='비밀번호가 서로 다릅니다.';
var r=await fetch(up?'/api/signup':'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:$('#e').value,password:$('#p').value})});
if(r.status==202){mode(false);$('#p').value='';return $('#msg').textContent='가입을 신청했습니다. 관리자가 승인하면 로그인할 수 있습니다.'}
if(r.ok)return location.reload();
$('#msg').textContent=({401:'이름 또는 비밀번호가 맞지 않습니다.',423:'관리자 승인을 기다리고 있습니다.',409:'이미 사용 중인 이름입니다.',400:'이름과 6자 이상의 비밀번호를 입력하세요.',403:'가입 인원이 가득 찼습니다.',429:'시도가 많아 잠시 막혔습니다. 나중에 다시 하세요.'})[r.status]||'서버 오류'};`);
const home = (apps, email, admin, pend) => page(`<div class="nav"><span>${esc(email)}</span><span>${admin ? `<a class="adm" href="/admin">관리자${pend ? ' (' + pend + ')' : ''}</a>` : ''}<button id="out">로그아웃</button></span></div>
<section class="tile hero"><h1>학교 업무 도구</h1><p>사용할 프로그램을 선택하세요.</p></section>
<section class="tile parch"><div class="grid">${Object.entries(apps).map(([k, a]) => `<a class="card" href="/${k}/"><h3>${esc(a.title)}</h3><p>${esc(a.desc)}</p><span>열기 ›</span></a>`).join('')}</div></section>
<section class="tile dark"><h2>한 번 로그인하면</h2><p>어느 프로그램에서든 같은 계정으로 이어서 쓸 수 있고, 성적과 메모는 본인 계정에만 저장됩니다.</p></section>`,
`document.getElementById('out').onclick=async function(){await fetch('/api/logout',{method:'POST'});location.reload()}`);
const adminPage = me => page(`<div class="nav"><a class="adm" href="/">← 프로그램 선택</a><span>${esc(me)}</span></div>
<section class="tile hero" style="padding-bottom:32px"><h1 style="font-size:40px">관리자</h1><p>가입 신청을 승인하고 계정을 관리합니다.</p></section>
<section class="tile parch"><div class="grid" style="display:block;max-width:720px"><h2 style="font-size:24px;margin-bottom:12px">승인 대기</h2><div id="pend"></div><h2 style="font-size:24px;margin:36px 0 12px">전체 계정</h2><div id="all"></div></div></section>`,
`var $=function(s){return document.querySelector(s)};
function row(u,btns){var d=document.createElement('div');d.style.cssText='display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 18px;margin-bottom:8px;border:1px solid var(--line);border-radius:18px;background:var(--canvas)';
var n=document.createElement('span');n.textContent=u.name+(u.admin?' (관리자)':'')+(u.at?'  · '+u.at.slice(0,10):'');d.appendChild(n);var b=document.createElement('span');
btns.forEach(function(x){var e=document.createElement('button');e.textContent=x[0];e.style.cssText='margin-left:8px;padding:6px 14px;border-radius:999px;border:1px solid var(--line);background:'+(x[2]?'var(--primary)':'var(--canvas)')+';color:'+(x[2]?'#fff':'var(--ink)')+';cursor:pointer';
e.onclick=async function(){if(x[3]&&!confirm(x[3]))return;await fetch('/api/admin/'+x[1],{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:u.name})});load()};b.appendChild(e)});d.appendChild(b);return d}
async function load(){var r=await fetch('/api/admin/users');if(!r.ok)return location.href='/';var L=await r.json();$('#pend').textContent='';$('#all').textContent='';
var P=L.filter(function(u){return u.status==='pending'});if(!P.length){$('#pend').textContent='대기 중인 신청이 없습니다.'}
P.forEach(function(u){$('#pend').appendChild(row(u,[['거절','reject',0,u.name+' 신청을 거절할까요?'],['승인','approve',1]]))});
L.filter(function(u){return u.status!=='pending'}).forEach(function(u){$('#all').appendChild(row(u,u.admin?[]:[['삭제','delete',0,u.name+' 계정을 삭제할까요? 저장된 성적 파일은 남지만 로그인할 수 없게 됩니다.']]))})}
load();`);
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
      if (url === '/') return html(me ? home(apps, me, !!users()[me].admin, Object.values(users()).filter(u => u.status === 'pending').length) : loginPage());
      if (url === '/admin') { if (!me || !users()[me].admin) { res.writeHead(302, { location: '/' }); return res.end(); } return html(adminPage(me)); }
      if (url === '/fonts/Moneygraphy-Rounded.woff2') { res.writeHead(200, { 'content-type': 'font/woff2', 'cache-control': 'public, max-age=604800' }); return res.end(fs.readFileSync(path.join(__dirname, 'fonts', 'Moneygraphy-Rounded.woff2'))); }
      if (apps[seg]) {
        if (!me) { res.writeHead(302, { location: '/' }); return res.end(); } // 로그인 전에는 첫 화면으로
        if (url === '/' + seg) { res.writeHead(301, { location: '/' + seg + '/' }); return res.end(); }
        if (url === '/' + seg + '/') return html(fs.readFileSync(apps[seg].file));
      }
    }
    if (url === '/api/login' && req.method === 'POST') {
      const { email = '', password = '' } = JSON.parse(await body(req) || '{}'), e = normName(email);
      const k = req.socket.remoteAddress + '|' + e, f = fails[k] || { n: 0, t: 0 };
      if (f.n >= 5 && Date.now() - f.t < 600e3) return send(res, 429, { error: 'too many' });
      const u = users()[e];
      if (!u || hash(password, u.salt) !== u.hash) { fails[k] = { n: f.n + 1, t: Date.now() }; return send(res, 401, { error: 'bad login' }); }
      delete fails[k];
      if (u.status === 'pending') return send(res, 423, { error: 'pending' });
      const sec = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
      return send(res, 200, { email: e }, { 'set-cookie': `lens=${mkTok(e)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}${sec}` });
    }
    if (url === '/api/signup' && req.method === 'POST') { // 누구나 가입 가능하되 인원 상한과 IP당 횟수 제한으로 남용을 막는다
      const { email = '', password = '' } = JSON.parse(await body(req) || '{}'), e = normName(email), U = users();
      const k = 'signup|' + req.socket.remoteAddress, f = fails[k] || { n: 0, t: Date.now() };
      if (Date.now() - f.t > 3600e3) { f.n = 0; f.t = Date.now(); }
      if (f.n >= 5) return send(res, 429, { error: 'too many' });
      if (!okName(e) || password.length < 6) return send(res, 400, { error: 'invalid' });
      if (U[e]) return send(res, 409, { error: 'exists' });
      if (Object.keys(U).length >= MAX_USERS) return send(res, 403, { error: 'full' });
      fails[k] = { n: f.n + 1, t: f.t };
      const salt = crypto.randomBytes(16).toString('hex');
      U[e] = { salt, hash: hash(password, salt), id: crypto.randomBytes(12).toString('hex'), status: 'pending', at: new Date().toISOString() };
      atomic(UF, JSON.stringify(U, null, 1));
      return send(res, 202, { pending: true }); // 승인 전에는 로그인되지 않는다
    }
    if (url === '/api/logout' && req.method === 'POST') return send(res, 200, {}, { 'set-cookie': 'lens=; HttpOnly; Path=/; Max-Age=0' });
    if (!url.startsWith('/api/')) return send(res, 404, { error: 'not found' });
    const email = who(req);
    if (!email) return send(res, 401, { error: 'login required' });
    const isAdmin = !!users()[email].admin;
    if (url === '/api/me') return send(res, 200, { email, admin: isAdmin });
    if (url.startsWith('/api/admin/')) { // 관리자 전용: 가입 신청 승인·거절, 계정 삭제
      if (!isAdmin) return send(res, 403, { error: 'admin only' });
      const U = users();
      if (url === '/api/admin/users' && req.method === 'GET') return send(res, 200, Object.entries(U).map(([name, u]) => ({ name, status: u.status || 'approved', admin: !!u.admin, at: u.at || '' })));
      if (req.method === 'POST') {
        const name = normName(JSON.parse(await body(req) || '{}').name), u = U[name];
        if (!u) return send(res, 404, { error: 'no user' });
        if (url === '/api/admin/approve') u.status = 'approved';
        else if (url === '/api/admin/reject' || url === '/api/admin/delete') { if (u.admin) return send(res, 400, { error: 'admin' }); delete U[name]; } // 성적 파일은 data 폴더에 남는다
        else return send(res, 404, { error: 'not found' });
        atomic(UF, JSON.stringify(U, null, 1)); return send(res, 200, { ok: true });
      }
    }
    if (url === '/api/state') {
      const app = new URL(req.url, 'http://x').searchParams.get('app') || 'lens'; // 프로그램마다 따로 저장(?app=이름), 성적 돋보기는 기존 파일 그대로
      if (!/^[a-z0-9-]{1,30}$/.test(app)) return send(res, 400, { error: 'bad app' });
      const f = path.join(DIR, 'data', users()[email].id + (app === 'lens' ? '' : '.' + app) + '.json');
      if (req.method === 'GET') return send(res, 200, (() => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } })());
      if (req.method === 'PUT') {
        const s = await body(req), n = JSON.parse(s);
        // 문항별 자료(itm)를 모르는 예전 화면이 저장해도 기존 itm을 지우지 않는다
        if (n && typeof n === 'object' && !('itm' in n)) { try { const o = JSON.parse(fs.readFileSync(f, 'utf8')); if (o.itm) n.itm = o.itm; } catch {} }
        atomic(f, JSON.stringify(n)); return send(res, 200, { ok: true });
      }
    }
    send(res, 404, { error: 'not found' });
  } catch (e) { send(res, typeof e === 'number' ? e : 500, { error: 'error' }); }
}).listen(PORT, () => console.log(`성적 돋보기 서버: http://localhost:${PORT}  (저장: ${DIR})`));
