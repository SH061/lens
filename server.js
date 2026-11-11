// 맥 스튜디오 서버 (외부 패키지 없음, Node 18+)
//   실행:      node server.js
//   계정 추가: node server.js adduser 이름 비밀번호        (같은 이름으로 다시 하면 비밀번호 변경, 바로 승인됨)
//   관리자:    node server.js adduser 이름 비밀번호 admin   (관리자 화면 /admin 사용 가능)
//   계정 삭제: node server.js deluser 이름
// 우리 반 명단: GET/PUT /api/roster (apps/myclass 에서 등록, 다른 프로그램은 GET으로 읽기만 한다).
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
.fm{display:flex;flex-direction:column;gap:10px;margin:0 0 36px}.fm h2{font-size:24px;margin:0 0 6px}.fm input,.fm select{padding:12px 18px;border:1px solid var(--line);border-radius:999px;font:inherit;background:var(--canvas);color:var(--ink);outline:0}.fm .row{display:flex;gap:8px}.fm .row>*{flex:1;min-width:0}.fm .pill{width:auto;align-self:flex-start;padding:10px 28px}.fm .ok{color:#1a7f37}.fm .bad{color:#c62828}
.seg{display:flex;gap:8px;margin-bottom:12px}.seg button{flex:1;padding:10px;border:1px solid var(--line);border-radius:999px;background:var(--canvas);font:inherit;color:var(--ink);cursor:pointer}.seg button.on{background:var(--primary);color:#fff;border-color:var(--primary)}
.selrow{display:flex;gap:8px;margin-bottom:10px}.selrow select,.selrow .box input,.selrow input{flex:1;min-width:0;width:auto!important;margin:0!important;padding:12px 14px;border:1px solid var(--line);border-radius:999px;font:inherit;background:var(--canvas);color:var(--ink)}.login.up .selrow select,.login.up .seg button{background:#2c2c2e;border-color:#3a3a3c;color:var(--on-tile)}.login.up .seg button.on{background:var(--primary);border-color:var(--primary)}
.sw{display:inline-block;margin-top:14px;color:var(--primary);font-size:15px;text-decoration:none}
.nav{position:sticky;top:0;z-index:5;height:48px;padding:0 22px;display:flex;align-items:center;justify-content:space-between;background:#000c;backdrop-filter:saturate(180%) blur(20px);color:var(--on-tile);font-size:14px}
.nav .adm{color:#2997ff;text-decoration:none;font-size:14px;margin-right:18px}.nav button{background:none;border:0;color:#2997ff;cursor:pointer;font-size:14px}
.tile{padding:80px 22px;text-align:center}.tile.parch{background:var(--parch)}.tile.dark{background:var(--tile);color:var(--on-tile)}
.hero h1{font-size:56px;line-height:1.07;letter-spacing:-.03em;margin-bottom:12px}.hero p{font-size:24px;line-height:1.2;color:var(--mute);letter-spacing:-.015em}
h2{font-size:34px;line-height:1.12;letter-spacing:-.025em;margin-bottom:36px}
.grid{max-width:980px;margin:0 auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,276px));justify-content:center;gap:17px;text-align:left}
.card{display:block;padding:24px 24px 22px;border:1px solid var(--line);border-radius:18px;background:var(--canvas);color:inherit;text-decoration:none;transition:transform .15s}.card:active{transform:scale(.98)}
.card h3{font-size:23px;line-height:1.2;letter-spacing:-.02em;margin-bottom:7px}.card p{color:var(--mute);font-size:17px;line-height:1.4;min-height:48px}.card span{display:block;margin-top:14px;font-size:17px;color:var(--primary)}
.dark h2{margin-bottom:12px}.dark p{color:var(--on-tile-mute);margin:0 auto}@media(min-width:834px){.dark p{white-space:nowrap}}
@media(max-width:833px){.hero h1{font-size:40px}.hero p{font-size:19px}h2{font-size:28px}.tile{padding:56px 16px}}`;
const page = (body, script = '') => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>학교 업무 도구</title><style>${CSS}</style></head><body>${body}${script ? '<script>' + script + '</script>' : ''}</body></html>`;
const eyeBtn = '<button type="button" class="eye" aria-label="비밀번호 보기" tabindex="-1"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/><path class="sl" d="M3 3l18 18"/></svg></button>';
const loginPage = () => page(`<main class="login"><form class="box" id="f"><h1 id="t">로그인</h1><p class="sub" id="sub">학교 업무 도구</p>
<div class="seg" id="roles" hidden><button type="button" id="rT" class="on">교사</button><button type="button" id="rS">학생</button></div><input id="e" type="text" maxlength="30" placeholder="이름 (학생은 학번 5자리)" autocomplete="username" required><div class="selrow" id="tx" hidden><select id="tg"><option value="0">담임 아님</option><option value="1">1학년</option><option value="2">2학년</option><option value="3">3학년</option></select><select id="tc"><option value="1">1반</option><option value="2">2반</option><option value="3">3반</option><option value="4">4반</option><option value="5">5반</option><option value="6">6반</option><option value="7">7반</option><option value="8">8반</option><option value="9">9반</option><option value="10">10반</option><option value="11">11반</option><option value="12">12반</option><option value="13">13반</option><option value="14">14반</option><option value="15">15반</option></select></div><div class="selrow" id="sx" hidden><select id="sg"><option value="1">1학년</option><option value="2">2학년</option><option value="3">3학년</option></select><select id="sc"><option value="1">1반</option><option value="2">2반</option><option value="3">3반</option><option value="4">4반</option><option value="5">5반</option><option value="6">6반</option><option value="7">7반</option><option value="8">8반</option><option value="9">9반</option><option value="10">10반</option><option value="11">11반</option><option value="12">12반</option><option value="13">13반</option><option value="14">14반</option><option value="15">15반</option></select><input id="sn" type="number" min="1" max="60" placeholder="번호"></div><div class="pw"><input id="p" type="password" inputmode="latin" autocapitalize="off" autocorrect="off" spellcheck="false" style="ime-mode:disabled" placeholder="비밀번호" autocomplete="current-password" required>${eyeBtn}</div><div class="pw" id="p2w" hidden><input id="p2" type="password" inputmode="latin" autocapitalize="off" autocorrect="off" spellcheck="false" style="ime-mode:disabled" placeholder="비밀번호 확인" autocomplete="new-password">${eyeBtn}</div>
<button class="pill" id="go">로그인</button><div class="msg" id="msg"></div><a class="sw" id="sw" href="#">처음이세요? 가입하기</a></form></main>`,
`var up=false,role='t',$=function(s){return document.querySelector(s)};
function roleUi(){$('#rT').classList.toggle('on',role==='t');$('#rS').classList.toggle('on',role==='s');$('#tx').hidden=!up||role!=='t';$('#sx').hidden=!up||role!=='s'}
$('#rT').onclick=function(){role='t';roleUi()};$('#rS').onclick=function(){role='s';roleUi()};
/* 비밀번호 칸: 한글 상태에서 눌러도 영문 자판 글자로 바꿔 넣는다(ㅂ→q). 브라우저는 입력기 전환을 강제할 수 없어 입력된 한글을 변환한다 */
var KI=['r','R','s','e','E','f','a','q','Q','t','T','d','w','W','c','z','x','v','g'],KV=['k','o','i','O','j','p','u','P','h','hk','ho','hl','y','n','nj','np','nl','b','m','ml','l'],KF=['','r','R','rt','s','sw','sg','e','f','fr','fa','fq','ft','fx','fv','fg','a','q','qt','t','T','d','w','c','z','x','v','g'],
JA='ㄱㄲㄳㄴㄵㄶㄷㄸㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅃㅄㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ',JK=['r','R','rt','s','sw','sg','e','E','f','fr','fa','fq','ft','fx','fv','fg','a','q','Q','qt','t','T','d','w','W','c','z','x','v','g'],VO='ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
function eng(t){return t.replace(/[가-힣ㄱ-ㅣ]/g,function(c){var n=c.charCodeAt(0);if(n>=44032){n-=44032;return KI[Math.floor(n/588)]+KV[Math.floor(n%588/28)]+KF[n%28]}var a=JA.indexOf(c);return a>=0?JK[a]:KV[VO.indexOf(c)]})}
function fixPw(e){var el=e.target,v=el.value,c=eng(v);if(c!==v)el.value=c}
['#p','#p2'].forEach(function(id){$(id).addEventListener('input',function(e){if(!e.isComposing)fixPw(e)});$(id).addEventListener('compositionend',fixPw)});
Array.prototype.forEach.call(document.querySelectorAll('.eye'),function(b){b.onclick=function(){var i=b.previousElementSibling,show=i.type==='password';i.type=show?'text':'password';b.classList.toggle('on',show);b.setAttribute('aria-label',show?'비밀번호 숨기기':'비밀번호 보기');i.focus()}});
function mode(u){up=u;$('.login').classList.toggle('up',u);$('#t').textContent=u?'가입 신청':'로그인';$('#sub').textContent=u?'교사는 관리자가, 학생은 담임 선생님이 승인한 뒤 사용할 수 있어요':'학교 업무 도구';$('#go').textContent=u?'가입 신청하기':'로그인';$('#sw').textContent=u?'이미 계정이 있어요':'처음이세요? 가입하기';$('#p2w').hidden=!u;$('#p2').value='';$('#roles').hidden=!u;role=u?role:'t';roleUi();$('#e').placeholder=u?'이름':'이름 (학생은 학번 5자리)';$('#msg').textContent='';document.title=u?'가입 신청':'학교 업무 도구'}
$('#sw').onclick=function(e){e.preventDefault();mode(!up)};
$('#f').onsubmit=async function(e){e.preventDefault();$('#msg').textContent='';
if(up&&$('#p').value!==$('#p2').value)return $('#msg').textContent='비밀번호가 서로 다릅니다.';
var ep=up?(role==='s'?'/api/student/signup':'/api/signup'):'/api/login',bd={email:$('#e').value,password:$('#p').value};
if(up&&role==='s')bd={g:+$('#sg').value,c:+$('#sc').value,n:+$('#sn').value,name:$('#e').value,password:$('#p').value};
else if(up&&+$('#tg').value)bd.cls={g:+$('#tg').value,c:+$('#tc').value};
var r=await fetch(ep,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(bd)});
var wasS=up&&role==='s';
if(r.status==202){mode(false);$('#p').value='';return $('#msg').textContent=wasS?'가입을 신청했어요. 담임 선생님이 승인하면 로그인할 수 있어요.':'가입을 신청했습니다. 관리자가 승인하면 로그인할 수 있습니다.'}
if(r.ok)return location.reload();
$('#msg').textContent=({401:'이름 또는 비밀번호가 맞지 않습니다.',423:'승인을 기다리고 있습니다(교사는 관리자, 학생은 담임 선생님).',404:'그 반 담임 선생님이 아직 가입하지 않았어요.',409:wasS?'이미 가입되었거나 신청 중인 학번이에요.':'이미 사용 중인 이름입니다.',400:wasS?'학년·반·번호, 이름, 영문·숫자 6자 이상의 비밀번호를 입력하세요.':'이름과 6자 이상의 비밀번호를 입력하세요.',403:'가입 인원이 가득 찼습니다.',429:'시도가 많아 잠시 막혔습니다. 나중에 다시 하세요.'})[r.status]||'서버 오류'};`);
const home = (apps, email, admin, pend) => page(`<div class="nav"><span>${esc(email)}</span><span>${admin ? `<a class="adm" href="/admin">관리자${pend ? ' (' + pend + ')' : ''}</a>` : ''}<a class="adm" href="/me">내 정보</a><button id="out">로그아웃</button></span></div>
<section class="tile hero"><h1>학교 업무 도구</h1><p>사용할 프로그램을 선택하세요.</p></section>
<section class="tile parch"><div class="grid">${Object.entries(apps).map(([k, a]) => `<a class="card" href="/${k}/"><h3>${esc(a.title)}</h3><p>${esc(a.desc)}</p><span>열기 ›</span></a>`).join('')}</div></section>
<section class="tile dark"><h2>한 번 로그인하면</h2><p>어느 프로그램에서든 같은 계정으로 이어서 쓸 수 있고, 성적과 메모는 본인 계정에만 저장됩니다.</p></section>`,
`document.getElementById('out').onclick=async function(){await fetch('/api/logout',{method:'POST'});location.reload()}`);
const studentHome = (name, cls) => page(`<div class="nav"><span>${esc(cls)} ${esc(name)}</span><span><a class="adm" href="/me">내 정보</a><button id="out">로그아웃</button></span></div>
<section class="tile hero"><h1>${esc(name)} 님, 반가워요</h1><p>${esc(cls || '우리 반')}에 가입됐어요.</p></section>
<section class="tile parch"><div class="grid" style="display:block;max-width:640px;text-align:center"><p style="color:var(--mute)">선생님이 열어 주는 기능이 여기에 나타납니다.</p></div></section>`,
`document.getElementById('out').onclick=async function(){await fetch('/api/student/logout',{method:'POST'});location.reload()}`);
const mePage = (kind, name, cls, g, c) => page(`<div class="nav"><a class="adm" href="/">← 처음으로</a><span>${esc(name)}</span></div>
<section class="tile hero" style="padding-bottom:32px"><h1 style="font-size:40px">내 정보</h1><p>${esc(kind === 't' ? '교사' : '학생')} · ${esc(name)}${cls ? ' · ' + esc(cls) : ''}</p></section>
<section class="tile parch"><div class="grid" style="display:block;max-width:560px;text-align:left">
${kind === 't' ? `<div class="fm"><h2>담임 학급</h2><div class="row"><select id="mg"><option value="0">담임 아님</option>%OG%</select><select id="mc">%OC%</select></div><button class="pill" id="sc">학급 저장</button><div class="msg" id="m1"></div></div>` : `<p style="color:var(--mute);margin-bottom:28px">이름·학번·반을 바꿔야 하면 담임 선생님께 말씀드리세요.</p>`}
<div class="fm"><h2>비밀번호 변경</h2><input id="p0" type="password" placeholder="현재 비밀번호" autocomplete="current-password"><input id="p1" type="password" placeholder="새 비밀번호 (6자 이상)" autocomplete="new-password"><input id="p2" type="password" placeholder="새 비밀번호 확인" autocomplete="new-password"><button class="pill" id="sp">비밀번호 변경</button><div class="msg" id="m2"></div></div>
</div></section>`.replace('%OG%', `<option value="1">1학년</option><option value="2">2학년</option><option value="3">3학년</option>`).replace('%OC%', `<option value="1">1반</option><option value="2">2반</option><option value="3">3반</option><option value="4">4반</option><option value="5">5반</option><option value="6">6반</option><option value="7">7반</option><option value="8">8반</option><option value="9">9반</option><option value="10">10반</option><option value="11">11반</option><option value="12">12반</option><option value="13">13반</option><option value="14">14반</option><option value="15">15반</option>`),
`var $=function(s){return document.querySelector(s)},K=${JSON.stringify(kind)};
function say(id,t,ok){var m=$(id);m.textContent=t;m.className='msg '+(ok?'ok':'bad')}
function post(u,b){return fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)})}
if(K==='t'){$('#mg').value=${+g || 0};$('#mc').value=${+c || 1};$('#sc').onclick=async function(){var r=await post('/api/me/cls',{g:+$('#mg').value,c:+$('#mc').value});say('#m1',r.ok?'저장했어요.':'저장하지 못했어요.',r.ok)}}
$('#sp').onclick=async function(){if($('#p1').value.length<6)return say('#m2','새 비밀번호는 6자 이상이에요.');if($('#p1').value!==$('#p2').value)return say('#m2','새 비밀번호가 서로 달라요.');
 var r=await post(K==='t'?'/api/me/password':'/api/student/password',{old:$('#p0').value,pw:$('#p1').value});
 if(r.ok){say('#m2','비밀번호를 바꿨어요.',1);$('#p0').value=$('#p1').value=$('#p2').value=''}else say('#m2',r.status==401?'현재 비밀번호가 맞지 않아요.':r.status==400?(K==='s'?'비밀번호는 영문·숫자·기호 6자 이상이에요.':'새 비밀번호는 6자 이상이에요.'):'바꾸지 못했어요.')}`);
const adminPage = me => page(`<div class="nav"><a class="adm" href="/">← 프로그램 선택</a><span>${esc(me)}</span></div>
<section class="tile hero" style="padding-bottom:32px"><h1 style="font-size:40px">관리자</h1><p>가입 신청을 승인하고 계정을 관리합니다.</p></section>
<section class="tile parch"><div class="grid" style="display:block;max-width:720px"><h2 style="font-size:24px;margin-bottom:12px">승인 대기</h2><div id="pend"></div><h2 style="font-size:24px;margin:36px 0 12px">전체 계정</h2><div id="all"></div><h2 style="font-size:24px;margin:36px 0 12px">학생</h2><div id="stu"></div></div></section>`,
`var $=function(s){return document.querySelector(s)};
function dlg(title,F,save){var d=document.createElement('dialog');d.style.cssText='border:1px solid var(--line,#d2d2d7);border-radius:22px;padding:26px;width:min(92vw,380px);background:var(--canvas,#fff);color:var(--ink,#1d1d1f);font:inherit';
var h=document.createElement('h3');h.textContent=title;h.style.cssText='margin:0 0 16px;font-size:22px;font-weight:400';d.append(h);var I={};
F.forEach(function(f){var l=document.createElement('label');l.textContent=f.label;l.style.cssText='display:block;font-size:14px;color:var(--mute,#6e6e73);margin:12px 0 4px';var e;
 if(f.opts){e=document.createElement('select');f.opts.forEach(function(o){var op=document.createElement('option');op.value=o[0];op.textContent=o[1];e.append(op)})}else{e=document.createElement('input');e.type=f.type||'text';e.placeholder=f.ph||'';e.autocomplete='off'}
 e.value=f.val==null?'':f.val;e.style.cssText='width:100%;padding:11px 16px;border:1px solid var(--line,#d2d2d7);border-radius:999px;font:inherit;background:var(--canvas,#fff);color:inherit;box-sizing:border-box';I[f.k]=e;d.append(l,e)});
var m=document.createElement('div');m.style.cssText='min-height:20px;margin-top:12px;font-size:14px;color:#c62828';d.append(m);
var r=document.createElement('div');r.style.cssText='display:flex;gap:8px;justify-content:flex-end;margin-top:6px';
function B(t,pri){var b=document.createElement('button');b.type='button';b.textContent=t;b.style.cssText='padding:10px 22px;border-radius:999px;font:inherit;cursor:pointer;border:1px solid var(--line,#d2d2d7);'+(pri?'background:var(--primary,var(--blue,#0066cc));color:#fff;border-color:transparent':'background:var(--canvas,#fff);color:inherit');return b}
var c=B('취소'),s=B('저장',1);c.onclick=function(){d.close()};d.addEventListener('close',function(){d.remove()});
s.onclick=async function(){var v={};for(var k in I)v[k]=I[k].value;s.disabled=true;var e=await save(v);s.disabled=false;if(e)m.textContent=e;else d.close()};
d.addEventListener('keydown',function(e){if(e.key==='Enter'&&e.target.tagName==='INPUT'){e.preventDefault();s.click()}});r.append(c,s);d.append(r);document.body.append(d);d.showModal();var f0=d.querySelector('input,select');if(f0)f0.focus()}
function stuSave(s,call){return async function(v){var b={no:s.no};v.name=v.name.trim();if(!v.name)return'이름을 적어 주세요.';if(v.name!==s.name)b.name=v.name;if(v.pw){if(!/^[\\x21-\\x7e]{6,30}$/.test(v.pw))return'비밀번호는 영문·숫자·기호 6자 이상이에요.';b.password=v.pw}
 if(v.no!==s.no){if(!/^[0-9]{5}$/.test(v.no))return'학번은 숫자 5자리예요. 예: 10101';b.g=+v.no[0];b.c=+v.no.slice(1,3);b.n=+v.no.slice(3)}
 var r=await fetch('/api/people/student',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});if(r.ok){call();return''}
 return r.status===409?'이미 있는 학번이에요.':r.status===403?'다른 반으로 옮기는 건 총괄관리자만 할 수 있어요.':r.status===400?'입력을 확인해 주세요(그 반 담임이 없으면 옮길 수 없어요).':'수정하지 못했어요.'}}
function stuEdit(s,call){dlg(s.name+' 학생 정보',[{k:'no',label:'학번 (학년1+반2+번호2자리)',val:s.no},{k:'name',label:'이름',val:s.name},{k:'pw',label:'새 비밀번호 (바꿀 때만, 6자 이상)',type:'password',ph:'비워 두면 그대로'}],stuSave(s,call))}
function row(u,btns){var d=document.createElement('div');d.style.cssText='display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 18px;margin-bottom:8px;border:1px solid var(--line);border-radius:18px;background:var(--canvas)';
var n=document.createElement('span');n.textContent=u.name+(u.admin?' (관리자)':'')+(u.cls?' · '+u.cls+' 담임':'')+(u.at?'  · '+u.at.slice(0,10):'');d.appendChild(n);var b=document.createElement('span');
btns.forEach(function(x){var e=document.createElement('button');e.textContent=x[0];e.style.cssText='margin-left:8px;padding:6px 14px;border-radius:999px;border:1px solid var(--line);background:'+(x[2]?'var(--primary)':'var(--canvas)')+';color:'+(x[2]?'#fff':'var(--ink)')+';cursor:pointer';
e.onclick=async function(){if(x[3]&&!confirm(x[3]))return;await fetch('/api/admin/'+x[1],{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:u.name})});load()};b.appendChild(e)});d.appendChild(b);return d}
async function load(){var r=await fetch('/api/admin/users');if(!r.ok)return location.href='/';var L=await r.json();$('#pend').textContent='';$('#all').textContent='';
var P=L.filter(function(u){return u.status==='pending'});if(!P.length){$('#pend').textContent='대기 중인 신청이 없습니다.'}
P.forEach(function(u){$('#pend').appendChild(row(u,[['거절','reject',0,u.name+' 신청을 거절할까요?'],['승인','approve',1]]))});
L.filter(function(u){return u.status!=='pending'}).forEach(function(u){var d=row(u,u.admin?[]:[['삭제','delete',0,u.name+' 계정을 삭제할까요? 저장된 성적 파일은 남지만 로그인할 수 없게 됩니다.']]);var e=document.createElement('button');e.textContent='수정';e.style.cssText='margin-left:8px;padding:6px 14px;border-radius:999px;border:1px solid var(--line);background:var(--canvas);color:var(--ink);cursor:pointer';
e.onclick=function(){dlg(u.name+' 교사 정보',[{k:'g',label:'담임 학년',val:u.g,opts:[[0,'담임 아님'],[1,'1학년'],[2,'2학년'],[3,'3학년']]},{k:'c',label:'담임 반',val:u.c||1,opts:Array.from({length:15},function(_,i){return[i+1,(i+1)+'반']})},{k:'pw',label:'새 비밀번호 (바꿀 때만, 6자 이상)',type:'password',ph:'비워 두면 그대로'}],async function(v){if(v.pw&&v.pw.length<6)return'비밀번호는 6자 이상이에요.';var b={name:u.name,g:+v.g,c:+v.c};if(v.pw)b.password=v.pw;var r=await fetch('/api/people/user',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});if(!r.ok)return'수정하지 못했어요.';load();return''})};d.lastChild.insertBefore(e,d.lastChild.firstChild);$('#all').appendChild(d)});
var sr=await fetch('/api/people/students');var S=sr.ok?await sr.json():[];$('#stu').textContent='';if(!S.length)$('#stu').textContent='등록된 학생이 없습니다.';
S.forEach(function(s){var d=document.createElement('div');d.style.cssText='display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 18px;margin-bottom:8px;border:1px solid var(--line);border-radius:18px;background:var(--canvas)';var n=document.createElement('span');n.textContent=s.no+' '+s.name+' · '+s.cls+(s.joined?'':' (미가입)');d.appendChild(n);
var e=document.createElement('button');e.textContent='수정';e.style.cssText='padding:6px 14px;border-radius:999px;border:1px solid var(--line);background:var(--canvas);color:var(--ink);cursor:pointer';
e.onclick=function(){stuEdit(s,load)};d.appendChild(e);$('#stu').appendChild(d)})}
load();`);
const fails = {}; // shortcut: 메모리 기록이라 서버를 다시 켜면 초기화됨, 외부에 노출할 때는 충분
// ── 우리 반 명단 · 학생 가입(수업 시간에 교사가 가입창을 열면 학생이 이름을 고르고 6자 이상 비밀번호를 정한다)
const RF = id => path.join(DIR, 'data', id + '.__roster.json'); // 밑줄이 있어 프로그램 이름(a-z0-9-)과 겹치지 않는다
const readRoster = id => { try { return JSON.parse(fs.readFileSync(RF(id), 'utf8')); } catch { return { cls: '', students: [] }; } };
const QF = path.join(DIR, 'student-requests.json'); // 학생 가입 신청(승인 대기)
const reqs = () => { try { return JSON.parse(fs.readFileSync(QF, 'utf8')); } catch { return []; } };
const PW_RE = /^[\x21-\x7e]{6,30}$/; // 영문·숫자·기호 6자 이상
const okCls = c => !!c && Number.isInteger(c.g) && c.g >= 1 && c.g <= 3 && Number.isInteger(c.c) && c.c >= 1 && c.c <= 20;
const clsLabel = c => (okCls(c) ? c.g + '학년 ' + c.c + '반' : '');
const stuNo = (g, c, n) => `${g}${String(c).padStart(2, '0')}${String(n).padStart(2, '0')}`; // 1학년 1반 1번 → 10101
const homeroom = (g, c) => { for (const [e, u] of Object.entries(users())) if (u.status !== 'pending' && u.cls && u.cls.g === g && u.cls.c === c) return { email: e, id: u.id }; return null; };
const pubStudent = x => ({ no: x.no, name: x.name, joined: !!x.ph });
const mkStu = (id, no, sv) => { const b = ['s', id, no, sv, Date.now() + 30 * 864e5].join('|'); return Buffer.from(b).toString('base64url') + '.' + sign(b); };
function whoS(req) { // 학생 쿠키 → { id, st(명단 항목), cls } (교사가 비밀번호를 초기화하면 sv가 달라져 자동으로 무효)
  const m = /(?:^|; )stu=([^;]+)/.exec(req.headers.cookie || ''); if (!m) return null;
  const [b64, sig] = m[1].split('.'); if (!b64 || !sig) return null;
  const b = Buffer.from(b64, 'base64url').toString(), want = sign(b);
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  const [t, id, no, sv, exp] = b.split('|'); if (t !== 's' || +exp < Date.now() || !/^[0-9a-f]{24}$/.test(id)) return null;
  const R = readRoster(id), st = R.students.find(x => x.no === no && x.ph && x.sv === sv);
  return st ? { id, st, cls: /^[0-9]{5}$/.test(st.no) ? +st.no[0] + '학년 ' + +st.no.slice(1, 3) + '반' : R.cls } : null;
}
const throttle = (k, max, ms) => { const f = fails[k] || { n: 0, t: Date.now() }; if (Date.now() - f.t > ms) { f.n = 0; f.t = Date.now(); } fails[k] = f; return f.n >= max ? true : (f.n++, false); };
const body = req => new Promise((ok, no) => { let n = 0; const c = []; req.on('data', d => { n += d.length; if (n > 20e6) { no(413); req.destroy(); } else c.push(d); }); req.on('end', () => ok(Buffer.concat(c).toString())); });
const send = (res, code, obj, hdr = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...hdr }); res.end(JSON.stringify(obj)); };

http.createServer(async (req, res) => {
  try {
    const url = req.url.split('?')[0];
    const secC = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    const stuCookie = (id, st) => ({ 'set-cookie': `stu=${mkStu(id, st.no, st.sv)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}${secC}` });
    if (req.method === 'GET' && !url.startsWith('/api/')) { // 화면: 첫 화면(/)과 프로그램별 주소(/lens/, /다른이름/)
      const apps = listApps(), seg = url.split('/')[1];
      const html = (s) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' }); res.end(s); };
      const me = who(req);
      if (url === '/me') { const u = me && users()[me], ws = me ? null : whoS(req); if (!u && !ws) { res.writeHead(302, { location: '/' }); return res.end(); }
        return html(u ? mePage('t', me, clsLabel(u.cls), u.cls && u.cls.g, u.cls && u.cls.c) : mePage('s', ws.st.name, ws.cls, 0, 0)); }
      if (url === '/join') { res.writeHead(302, { location: '/' }); return res.end(); }
      if (url === '/') { const ws = me ? null : whoS(req); return html(me ? home(apps, me, !!users()[me].admin, Object.values(users()).filter(u => u.status === 'pending').length) : ws ? studentHome(ws.st.name, ws.cls) : loginPage()); }
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
      if (!u && /^\d{5}$/.test(e)) { // 교사 계정이 아니고 학번(5자리)이면 학생 로그인
        if (throttle('sl|' + e, 5, 600e3) || throttle('sl|' + req.socket.remoteAddress, 60, 600e3)) return send(res, 429, { error: 'too many' });
        for (const f of fs.readdirSync(path.join(DIR, 'data')).filter(x => x.endsWith('.__roster.json'))) {
          const id = f.slice(0, -'.__roster.json'.length), st = readRoster(id).students.find(x => x.no === e && x.ph);
          if (st && hash(password, st.ps) === st.ph) { delete fails['sl|' + e]; return send(res, 200, { name: st.name }, stuCookie(id, st)); }
        }
        const q = reqs().find(x => x.no === e); if (q && hash(password, q.ps) === q.ph) return send(res, 423, { error: 'pending' });
        return send(res, 401, { error: 'bad login' });
      }
      if (!u || hash(password, u.salt) !== u.hash) { fails[k] = { n: f.n + 1, t: Date.now() }; return send(res, 401, { error: 'bad login' }); }
      delete fails[k];
      if (u.status === 'pending') return send(res, 423, { error: 'pending' });
      const sec = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
      return send(res, 200, { email: e }, { 'set-cookie': `lens=${mkTok(e)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}${sec}` });
    }
    if (url === '/api/signup' && req.method === 'POST') { // 누구나 가입 가능하되 인원 상한과 IP당 횟수 제한으로 남용을 막는다
      const { email = '', password = '', cls = null } = JSON.parse(await body(req) || '{}'), e = normName(email), U = users();
      const k = 'signup|' + req.socket.remoteAddress, f = fails[k] || { n: 0, t: Date.now() };
      if (Date.now() - f.t > 3600e3) { f.n = 0; f.t = Date.now(); }
      if (f.n >= 5) return send(res, 429, { error: 'too many' });
      if (!okName(e) || password.length < 6) return send(res, 400, { error: 'invalid' });
      if (U[e]) return send(res, 409, { error: 'exists' });
      if (Object.keys(U).length >= MAX_USERS) return send(res, 403, { error: 'full' });
      fails[k] = { n: f.n + 1, t: f.t };
      const salt = crypto.randomBytes(16).toString('hex');
      U[e] = { salt, hash: hash(password, salt), id: crypto.randomBytes(12).toString('hex'), status: 'pending', at: new Date().toISOString(), ...(okCls(cls) ? { cls: { g: cls.g, c: cls.c } } : {}) };
      atomic(UF, JSON.stringify(U, null, 1));
      return send(res, 202, { pending: true }); // 승인 전에는 로그인되지 않는다
    }
    if (url === '/api/logout' && req.method === 'POST') return send(res, 200, {}, { 'set-cookie': 'lens=; HttpOnly; Path=/; Max-Age=0' });
    if (url === '/api/student/signup' && req.method === 'POST') { // 학생 가입 신청: 그 반 담임(또는 총괄관리자)이 승인하면 로그인할 수 있다
      if (throttle('ss|' + req.socket.remoteAddress, 60, 3600e3)) return send(res, 429, { error: 'too many' }); // 학교 와이파이는 같은 주소라 넉넉히
      const b = JSON.parse(await body(req) || '{}'), g = +b.g, c = +b.c, n = +b.n, name = String(b.name || '').trim(), pw = String(b.password || '');
      if (!okCls({ g, c }) || !Number.isInteger(n) || n < 1 || n > 60 || !name || name.length > 20 || !PW_RE.test(pw)) return send(res, 400, { error: 'invalid' });
      const h = homeroom(g, c); if (!h) return send(res, 404, { error: 'no homeroom' });
      const no = stuNo(g, c, n), ex = readRoster(h.id).students.find(x => x.no === no), Q = reqs();
      if (ex && ex.ph) return send(res, 409, { error: 'exists' });
      if (Q.some(x => x.no === no)) return send(res, 409, { error: 'pending' });
      if (Q.length >= 500) return send(res, 403, { error: 'full' });
      const ps = crypto.randomBytes(16).toString('hex'); Q.push({ no, name, g, c, ps, ph: hash(pw, ps), at: new Date().toISOString() });
      atomic(QF, JSON.stringify(Q, null, 1)); return send(res, 202, { pending: true });
    }
    if (url === '/api/student/logout' && req.method === 'POST') return send(res, 200, {}, { 'set-cookie': 'stu=; HttpOnly; Path=/; Max-Age=0' });
    if (url === '/api/student/password' && req.method === 'POST') {
      const w = whoS(req); if (!w) return send(res, 401, { error: 'login required' });
      const b = JSON.parse(await body(req) || '{}'); if (throttle('sp|' + w.st.no, 5, 600e3)) return send(res, 429, { error: 'too many' });
      if (hash(String(b.old || ''), w.st.ps) !== w.st.ph) return send(res, 401, { error: 'bad password' });
      if (!PW_RE.test(String(b.pw || ''))) return send(res, 400, { error: 'pw' });
      const R = readRoster(w.id), st = R.students.find(x => x.no === w.st.no);
      st.ps = crypto.randomBytes(16).toString('hex'); st.ph = hash(String(b.pw), st.ps); st.sv = crypto.randomBytes(8).toString('hex'); // 다른 기기의 로그인은 풀린다
      atomic(RF(w.id), JSON.stringify(R)); return send(res, 200, { ok: true }, stuCookie(w.id, st));
    }
    if (url === '/api/student/me') { const w = whoS(req); return w ? send(res, 200, { name: w.st.name, no: w.st.no, cls: w.cls }) : send(res, 401, { error: 'login required' }); }
    if (!url.startsWith('/api/')) return send(res, 404, { error: 'not found' });
    const email = who(req);
    if (!email) return send(res, 401, { error: 'login required' });
    const isAdmin = !!users()[email].admin;
    if (url === '/api/me') return send(res, 200, { email, admin: isAdmin, cls: clsLabel(users()[email].cls) });
    if (url.startsWith('/api/admin/')) { // 관리자 전용: 가입 신청 승인·거절, 계정 삭제
      if (!isAdmin) return send(res, 403, { error: 'admin only' });
      const U = users();
      if (url === '/api/admin/users' && req.method === 'GET') return send(res, 200, Object.entries(U).map(([name, u]) => ({ name, status: u.status || 'approved', admin: !!u.admin, at: u.at || '', cls: clsLabel(u.cls), g: u.cls ? u.cls.g : 0, c: u.cls ? u.cls.c : 0 })));
      if (req.method === 'POST') {
        const name = normName(JSON.parse(await body(req) || '{}').name), u = U[name];
        if (!u) return send(res, 404, { error: 'no user' });
        if (url === '/api/admin/approve') u.status = 'approved';
        else if (url === '/api/admin/reject' || url === '/api/admin/delete') { if (u.admin) return send(res, 400, { error: 'admin' }); delete U[name]; } // 성적 파일은 data 폴더에 남는다
        else return send(res, 404, { error: 'not found' });
        atomic(UF, JSON.stringify(U, null, 1)); return send(res, 200, { ok: true });
      }
    }
    if (url.startsWith('/api/roster')) { // 우리 반 명단: 교사 계정마다 하나, 모든 프로그램이 GET /api/roster 로 같은 명단을 읽는다 → {cls, students:[{no,name,joined}], join}
      const id = users()[email].id, R = readRoster(id);
      const me = users()[email];
      if (url === '/api/roster' && req.method === 'GET') return send(res, 200, { cls: clsLabel(me.cls) || R.cls, g: me.cls ? me.cls.g : 0, c: me.cls ? me.cls.c : 0, students: R.students.map(pubStudent) });
      if (url === '/api/roster' && req.method === 'PUT') {
        const n = JSON.parse(await body(req) || '{}'), st = Array.isArray(n.students) ? n.students : null;
        if (!st || st.length > 100) return send(res, 400, { error: 'bad roster' });
        if ('g' in n) { const U = users(); if (okCls({ g: +n.g, c: +n.c })) U[email].cls = { g: +n.g, c: +n.c }; else delete U[email].cls; atomic(UF, JSON.stringify(U, null, 1)); } // 담임 학급 변경(0이면 담임 아님)
        const cl = users()[email].cls, old = new Map(R.students.map(x => [x.name, x])); // 같은 이름은 가입 정보(비밀번호·세션)를 이어 받는다
        const clean = st.map(x => ({ no: String((x && x.no) || '').trim().slice(0, 10), name: String((x && x.name) || '').trim().slice(0, 20) })).filter(x => x.name).map(x => { const o = old.get(x.name); return o && o.ph ? { ...x, ps: o.ps, ph: o.ph, sv: o.sv } : x; });
        atomic(RF(id), JSON.stringify({ cls: clsLabel(cl) || String(n.cls || '').trim().slice(0, 20), students: clean, at: new Date().toISOString() }));
        return send(res, 200, { ok: true, n: clean.length });
      }
      if (url === '/api/roster/reset' && req.method === 'POST') { // 이름을 도용당했거나 비밀번호를 잊은 학생: 가입 정보를 지우면 다시 가입할 수 있다
        const nm = String(JSON.parse(await body(req) || '{}').name || ''), st = R.students.find(x => x.name === nm);
        if (!st) return send(res, 404, { error: 'no student' });
        delete st.ph; delete st.ps; delete st.sv; atomic(RF(id), JSON.stringify(R)); return send(res, 200, { ok: true });
      }
    }
    if (url === '/api/me/password' && req.method === 'POST') {
      const b = JSON.parse(await body(req) || '{}'), U = users(), u = U[email];
      if (throttle('mp|' + email, 5, 600e3)) return send(res, 429, { error: 'too many' });
      if (hash(String(b.old || ''), u.salt) !== u.hash) return send(res, 401, { error: 'bad password' });
      if (String(b.pw || '').length < 6 || String(b.pw).length > 100) return send(res, 400, { error: 'short' });
      u.salt = crypto.randomBytes(16).toString('hex'); u.hash = hash(String(b.pw), u.salt); atomic(UF, JSON.stringify(U, null, 1)); return send(res, 200, { ok: true });
    }
    if (url === '/api/me/cls' && req.method === 'POST') {
      const b = JSON.parse(await body(req) || '{}'), U = users();
      if (okCls({ g: +b.g, c: +b.c })) U[email].cls = { g: +b.g, c: +b.c }; else delete U[email].cls;
      atomic(UF, JSON.stringify(U, null, 1)); return send(res, 200, { ok: true });
    }
    if (url.startsWith('/api/people/')) { // 총괄관리자는 교사·학생 모두, 담임은 자기 반 학생의 정보를 고친다
      const me = users()[email], listAll = () => fs.readdirSync(path.join(DIR, 'data')).filter(x => x.endsWith('.__roster.json')).map(x => x.slice(0, -'.__roster.json'.length));
      if (url === '/api/people/students' && req.method === 'GET') {
        const ids = me.admin ? listAll() : [me.id], U = users(), out = [];
        for (const id of ids) { const R = readRoster(id), t = Object.values(U).find(u => u.id === id); for (const st of R.students) out.push({ no: st.no, name: st.name, joined: !!st.ph, cls: (/^\d{5}$/.test(st.no) ? +st.no[0] + '학년 ' + +st.no.slice(1, 3) + '반' : R.cls || (t && clsLabel(t.cls)) || '') }); }
        return send(res, 200, out.sort((a, b) => a.no.localeCompare(b.no)));
      }
      if (url === '/api/people/student' && req.method === 'POST') {
        const b = JSON.parse(await body(req) || '{}'), no = String(b.no || '');
        const ownerId = me.admin ? listAll().find(id => readRoster(id).students.some(x => x.no === no)) : (readRoster(me.id).students.some(x => x.no === no) ? me.id : null);
        if (!ownerId) return send(res, 404, { error: 'no student' });
        const R = readRoster(ownerId), st = R.students.find(x => x.no === no);
        if (b.name != null) { const nm = String(b.name).trim(); if (!nm || nm.length > 20) return send(res, 400, { error: 'name' }); st.name = nm; }
        if (b.password) { if (!PW_RE.test(String(b.password))) return send(res, 400, { error: 'pw' }); st.ps = crypto.randomBytes(16).toString('hex'); st.ph = hash(String(b.password), st.ps); st.sv = crypto.randomBytes(8).toString('hex'); }
        const toG = b.g ? +b.g : null, toC = b.c ? +b.c : null, toN = b.n ? +b.n : null;
        if (toG || toC || toN) { // 번호·반 변경 → 학번이 바뀐다(학번 형식이 5자리일 때만)
          if (!/^\d{5}$/.test(no)) return send(res, 400, { error: 'format' });
          const g = toG || +no[0], c = toC || +no.slice(1, 3), n = toN || +no.slice(3, 5);
          if (!okCls({ g, c }) || !Number.isInteger(n) || n < 1 || n > 60) return send(res, 400, { error: 'invalid' });
          const nn = stuNo(g, c, n), cur = +no[0] === g && +no.slice(1, 3) === c;
          if (nn !== no) {
            let T = R, tid = ownerId;
            if (!cur) { if (!me.admin) return send(res, 403, { error: 'admin only' }); const h = homeroom(g, c); if (!h) return send(res, 400, { error: 'no homeroom' }); tid = h.id; T = tid === ownerId ? R : readRoster(tid); }
            if (T.students.some(x => x.no === nn)) return send(res, 409, { error: 'taken' });
            st.no = nn; if (st.ph) st.sv = crypto.randomBytes(8).toString('hex'); // 학번이 바뀌면 다시 로그인해야 한다
            if (tid !== ownerId) { R.students = R.students.filter(x => x !== st); T.students.push(st); T.students.sort((a, b2) => a.no.localeCompare(b2.no)); atomic(RF(tid), JSON.stringify(T)); }
            else R.students.sort((a, b2) => a.no.localeCompare(b2.no));
          }
        }
        atomic(RF(ownerId), JSON.stringify(R)); return send(res, 200, { ok: true });
      }
      if (url === '/api/people/user' && req.method === 'POST') { // 총괄관리자 전용: 교사 비밀번호 재설정, 담임 학급 변경
        if (!me.admin) return send(res, 403, { error: 'admin only' });
        const b = JSON.parse(await body(req) || '{}'), U = users(), u = U[normName(b.name)];
        if (!u) return send(res, 404, { error: 'no user' });
        if (b.password) { if (String(b.password).length < 6) return send(res, 400, { error: 'short' }); u.salt = crypto.randomBytes(16).toString('hex'); u.hash = hash(String(b.password), u.salt); }
        if ('g' in b) { if (okCls({ g: +b.g, c: +b.c })) u.cls = { g: +b.g, c: +b.c }; else delete u.cls; }
        atomic(UF, JSON.stringify(U, null, 1)); return send(res, 200, { ok: true });
      }
    }
    if (url.startsWith('/api/requests')) { // 학생 가입 신청: 그 반 담임 또는 총괄관리자만 본다
      const me = users()[email], mine = r => !!me.admin || (!!me.cls && me.cls.g === r.g && me.cls.c === r.c);
      if (url === '/api/requests' && req.method === 'GET') return send(res, 200, reqs().filter(mine).map(r => {
        const h = homeroom(r.g, r.c), ex = h && readRoster(h.id).students.find(x => x.no === r.no);
        return { no: r.no, name: r.name, cls: r.g + '학년 ' + r.c + '반', at: r.at, state: !h ? 'nohome' : !ex ? 'new' : ex.name === r.name ? 'match' : 'mismatch', rosterName: ex ? ex.name : '' };
      }));
      if (req.method === 'POST' && (url === '/api/requests/approve' || url === '/api/requests/reject')) {
        const no = String(JSON.parse(await body(req) || '{}').no || ''), Q = reqs(), r = Q.find(x => x.no === no);
        if (!r || !mine(r)) return send(res, 404, { error: 'no request' });
        if (url.endsWith('/approve')) {
          const h = me.cls && me.cls.g === r.g && me.cls.c === r.c ? { id: me.id } : homeroom(r.g, r.c);
          if (!h) return send(res, 400, { error: 'no homeroom' });
          const R = readRoster(h.id); let ex = R.students.find(x => x.no === no);
          if (ex && ex.ph) return send(res, 409, { error: 'exists' });
          if (ex && ex.name !== r.name) return send(res, 409, { error: 'mismatch', rosterName: ex.name }); // 명단과 이름이 다르면 승인하지 않는다
          if (!ex) { if (R.students.length >= 100) return send(res, 400, { error: 'full' }); ex = { no, name: r.name }; R.students.push(ex); R.students.sort((a, b) => a.no.localeCompare(b.no)); }
          ex.ps = r.ps; ex.ph = r.ph; ex.sv = crypto.randomBytes(8).toString('hex');
          atomic(RF(h.id), JSON.stringify(R));
        }
        atomic(QF, JSON.stringify(Q.filter(x => x.no !== no), null, 1)); return send(res, 200, { ok: true });
      }
    }
    if (url === '/api/state') {
      const app = new URL(req.url, 'http://x').searchParams.get('app') || 'lens'; // 프로그램마다 따로 저장(?app=이름), 성적 돋보기는 기존 파일 그대로
      if (!/^[a-z0-9-]{1,30}$/.test(app)) return send(res, 400, { error: 'bad app' });
      const f = path.join(DIR, 'data', users()[email].id + (app === 'lens' ? '' : '.' + app) + '.json');
      if (req.method === 'GET') return send(res, 200, (() => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } })());
      if (req.method === 'PUT') {
        const s = await body(req), n = JSON.parse(s);
        // 문항별 자료(itm)가 비었거나 없는 채로 저장되면(오래 열려 있던 화면 등) 기존 itm을 지키고 화면에 돌려준다. 일부러 지운 경우만 itmReset으로 비운다
        let keep = null;
        if (n && typeof n === 'object') {
          if (!n.itmReset && !(Array.isArray(n.itm) && n.itm.length)) { try { const o = JSON.parse(fs.readFileSync(f, 'utf8')); if (Array.isArray(o.itm) && o.itm.length) n.itm = keep = o.itm; } catch {} }
          delete n.itmReset;
        }
        atomic(f, JSON.stringify(n)); return send(res, 200, keep ? { ok: true, itm: keep } : { ok: true });
      }
    }
    send(res, 404, { error: 'not found' });
  } catch (e) { send(res, typeof e === 'number' ? e : 500, { error: 'error' }); }
}).listen(PORT, () => console.log(`성적 돋보기 서버: http://localhost:${PORT}  (저장: ${DIR})`));
