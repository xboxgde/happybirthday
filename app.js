/* ============================================================
   Supabase 설정
   - publishable 키는 브라우저에 공개되어도 됨 (실제 권한은 DB의 RLS 정책이 제어)
   - service_role 키는 절대 여기에 넣지 말 것
   ============================================================ */
const SUPABASE_URL = 'https://ctocmfwapqmcbxvrpizf.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Jpi0up33lTITVVwPCwlurg_J-lssKvQ';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);   // CDN으로 불러온 전역 객체 사용
const BUCKET = 'gifts';                                          // 이미지 저장 버킷 이름

/* ============================================================
   공통 유틸
   ============================================================ */
const $ = id => document.getElementById(id);

// 화면 전환: id가 v-xxx 인 section만 .on 부여
function show(name){
  document.querySelectorAll('.view').forEach(v => v.classList.remove('on'));
  $('v-'+name).classList.add('on');
  if(name === 'notbday') loadNotBdayImage();
  if(name === 'admin') updateInboxCount();      // [추가] 받은 메시지 개수 표시 갱신   // [수정] 생일 아님 화면이 열리면 사진 불러오기
}
document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => show(b.dataset.go));

// Storage 경로 → 브라우저에서 열 수 있는 공개 URL
const imgUrl = path => sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

// 월/일 select 채우기
function fillDateSelects(mSel, dSel){
  for(let m=1;m<=12;m++) mSel.add(new Option(m+'월', m));
  for(let d=1;d<=31;d++) dSel.add(new Option(d+'일', d));
}
fillDateSelects($('selMonth'), $('selDay'));
fillDateSelects($('admMonth'), $('admDay'));

/* ============================================================
   [일반 사용자] 흐름: 생일 입력 → 후보 선택 → 본인 확인 → 선물상자 → 선물
   ============================================================ */
let found = null;        // 최종 선택된 사람 {id, name}
let candidates = [];     // 같은 생일인 후보 목록

$('btnYes').onclick = () => { $('inputMsg').textContent = ''; show('input'); };
$('btnNo').onclick  = () => show('notbday');

// 본인 확인 화면
function goConfirm(person){
  found = person;
  $('confirmTitle').textContent = person.name + '님이 맞나요?';
  show('confirm');
}
// [수정] 선물상자 화면 열기를 함수로 분리 (질문이 끝난 뒤에도 호출하기 위함)
function openBox(){
  $('boxTitle').textContent = found.name + '님, 생일 축하해요! 🎉';
  $('giftBox').classList.remove('open');
  show('box');
}
// [수정] 맞아요 → 바로 선물상자가 아니라 질문 q1부터 시작
$('btnConfirmYes').onclick = () => showQuestion('q1');
$('btnConfirmNo').onclick = () => show(candidates.length > 1 ? 'pick' : 'home');

// 생일 확인: 서버 함수 get_candidates 호출 (id와 이름만 돌아옴)
$('btnCheck').onclick = async () => {
  const btn = $('btnCheck');
  btn.disabled = true;                       // 연타 방지
  $('inputMsg').textContent = '';
  try{
    const { data, error } = await sb.rpc('get_candidates',
      { p_month: +$('selMonth').value, p_day: +$('selDay').value });
    if(error) throw error;

    // 일치하는 사람이 없으면 안내 후 첫 화면
    // [수정] 안내 후 자동 복귀 → 개발자에게 알릴 수 있는 화면으로 이동 (처음으로 돌아가는 버튼 포함)
    if(!data.length){
      const m = $('selMonth').value, d = $('selDay').value;
      showReport('no_birthday', '등록된 생일이 없어요',
        m + '월 ' + d + '일 생일이 등록되어 있지 않아요. 개발자에게 알려드릴까요?',
        '[생일 없음] ' + m + '월 ' + d + '일 입력');
      return;
    }
    candidates = data;
    if(data.length === 1){ goConfirm(data[0]); return; }   // 1명이면 바로 본인 확인

    // 2명 이상이면 선택 화면
    const box = $('pickList'); box.textContent = '';
    data.forEach(p => {
      const b = document.createElement('button');
      b.className = 'btn pick';
      b.textContent = p.name;                // textContent: 이름에 HTML이 들어가도 안전
      b.onclick = () => goConfirm(p);
      box.append(b);
    });
    show('pick');
  }catch(e){
    $('inputMsg').textContent = '조회에 실패했습니다. 잠시 후 다시 시도하세요.';
  }finally{
    btn.disabled = false;
  }
};

// 선물상자 클릭: 서버 함수 get_gift_by_id로 이미지 경로를 받아 표시
$('giftBox').onclick = async () => {
  $('giftBox').classList.add('open');
  try{
    const [res] = await Promise.all([
      sb.rpc('get_gift_by_id', { p_id: found.id }),
      new Promise(r => setTimeout(r, 700))         // 뚜껑 열리는 애니메이션 시간 확보
    ]);
    if(res.error) throw res.error;
    const row = res.data && res.data[0];

    $('giftTitle').textContent = found.name + '님을 위한 선물';
    // [수정] 선물이 없으면 안내만 하지 않고 개발자에게 알릴 수 있는 화면으로 이동
    if(!(row && row.image_path)){
      showReport('no_gift', '선물이 아직 준비되지 않았어요',
        found.name + '님의 선물이 아직 없어요. 개발자에게 알려드릴까요?',
        '[선물 없음] ' + found.name + '님');
      return;
    }
    $('giftImg').src = imgUrl(row.image_path);
    $('giftImg').style.display = '';
    show('gift');
  }catch(e){
    $('giftBox').classList.remove('open');
    alert('선물을 불러오지 못했어요. 다시 눌러주세요.');
  }
};

/* ============================================================
   [개발자] 로그인: Supabase Auth (이메일 + 비밀번호)
   ============================================================ */
$('btnDev').onclick = async () => {
  $('loginMsg').textContent = '';
  const { data } = await sb.auth.getSession();      // 이미 로그인된 세션이 있으면 재사용
  if(data.session){ await renderList(); show('admin'); }
  else show('login');
};

$('btnLogin').onclick = async () => {
  const { error } = await sb.auth.signInWithPassword(
    { email: $('loginId').value.trim(), password: $('loginPw').value });
  if(error){ $('loginMsg').textContent = '이메일 또는 비밀번호가 일치하지 않습니다.'; return; }
  $('loginPw').value = '';
  await renderList();
  show('admin');
};

$('btnLogout').onclick = async () => { await sb.auth.signOut(); show('home'); };

/* ============================================================
   [개발자] 생일자 관리: people 테이블 CRUD
   ============================================================ */
// 목록 조회 (gifts 테이블을 조인해 선물 이미지 경로까지 가져옴)
async function loadPeople(){
  const { data, error } = await sb.from('people')
    .select('id,name,month,day,gifts(image_path)')
    .order('month').order('day');
  if(error) throw error;
  return data.map(p => {
    const g = Array.isArray(p.gifts) ? p.gifts[0] : p.gifts;   // 관계 형태(객체/배열) 모두 대응
    return { id: p.id, name: p.name, month: p.month, day: p.day, path: g ? g.image_path : null };
  });
}

// 생일자 등록
$('btnSave').onclick = async () => {
  const name = $('admName').value.trim();
  if(!name){ $('admMsg').textContent = '이름을 입력하세요.'; return; }
  const btn = $('btnSave'); btn.disabled = true;
  const { error } = await sb.from('people')
    .insert({ name, month: +$('admMonth').value, day: +$('admDay').value });
  btn.disabled = false;
  if(error){
    // 23505: 중복(unique), 23514: check 제약 위반(없는 날짜)
    $('admMsg').textContent = error.code === '23505' ? '이미 등록된 생일자입니다.'
                            : error.code === '23514' ? '존재하지 않는 날짜입니다.'
                            : '등록에 실패했습니다.';
    return;
  }
  $('admMsg').textContent = '등록했습니다. 선물 이미지는 "선물 이미지 관리"에서 추가하세요.';
  $('admName').value = '';
  renderList();
};

$('btnToGifts').onclick  = () => { renderGiftAdm(); renderNb(); show('giftadm'); };   // [수정] renderNb() 추가
$('btnToPeople').onclick = () => { renderList(); show('admin'); };

// 생일자 삭제: 이미지 파일 먼저 삭제 → 행 삭제 (gifts 행은 DB가 자동 삭제)
async function deletePerson(p){
  if(!confirm(p.name + '님을 삭제할까요?')) return;
  if(p.path) await sb.storage.from(BUCKET).remove([p.path]);
  const { error } = await sb.from('people').delete().eq('id', p.id);
  if(error) $('admMsg').textContent = '삭제에 실패했습니다.';
  renderList();
}

async function renderList(){
  const box = $('list'); box.textContent = '';
  try{
    const list = await loadPeople();
    if(!list.length){ box.textContent = '아직 등록된 생일자가 없습니다. 위에서 첫 생일자를 등록하세요.'; return; }
    list.forEach(p => {
      const row = document.createElement('div'); row.className = 'item';
      const sp = document.createElement('span');
      sp.textContent = p.name + ' · ' + p.month + '월 ' + p.day + '일' + (p.path ? ' · 선물 있음' : ' · 선물 없음');
      const bt = document.createElement('button'); bt.className = 'btn sub'; bt.textContent = '삭제';
      bt.onclick = () => deletePerson(p);
      row.append(sp, bt);
      box.append(row);
    });
  }catch(e){
    box.textContent = '목록을 불러오지 못했습니다. 다시 로그인해 보세요.';
  }
}

/* ============================================================
   [개발자] 선물 이미지 관리: Storage 업로드 + gifts 테이블
   ============================================================ */
// 이미지를 긴 변 800px 이하 JPEG(Blob)로 줄임 (업로드 용량 절약)
function resizeImage(file){
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')); };
    img.onload = () => {
      const r = Math.min(1, 800 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = img.width * r; c.height = img.height * r;
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(b => b ? resolve(b) : reject(new Error('blob')), 'image/jpeg', 0.85);
    };
    img.src = url;
  });
}

async function renderGiftAdm(){
  const sel = $('giftPerson'); sel.textContent = '';
  const box = $('giftList');   box.textContent = '';
  try{
    const people = await loadPeople();
    if(!people.length){ box.textContent = '먼저 생일자 관리에서 생일자를 등록하세요.'; return; }
    people.forEach(p => {
      sel.add(new Option(p.name + ' (' + p.month + '/' + p.day + ')', p.id));
      const row = document.createElement('div'); row.className = 'item';
      if(p.path){
        const im = document.createElement('img'); im.src = imgUrl(p.path); im.alt = '';
        row.append(im);
      }
      const sp = document.createElement('span');
      sp.textContent = p.name + (p.path ? '' : ' · 선물 없음');
      row.append(sp);
      box.append(row);
    });
  }catch(e){
    box.textContent = '목록을 불러오지 못했습니다.';
  }
}

$('btnGiftSave').onclick = async () => {
  const file = $('giftFile').files[0];
  const id = $('giftPerson').value;
  if(!file || !id){ $('giftMsg').textContent = '생일자와 이미지를 선택하세요.'; return; }
  const btn = $('btnGiftSave'); btn.disabled = true;
  try{
    const blob = await resizeImage(file);
    const path = crypto.randomUUID() + '.jpg';      // 추측 불가능한 랜덤 파일명

    // 1) 새 이미지 업로드
    let r = await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' });
    if(r.error) throw r.error;

    // 2) 기존 이미지 경로 확인 (교체 시 삭제용)
    const old = await sb.from('gifts').select('image_path').eq('person_id', id).maybeSingle();

    // 3) gifts 테이블에 저장 (이미 있으면 덮어쓰기)
    r = await sb.from('gifts').upsert(
      { person_id: id, image_path: path, updated_at: new Date().toISOString() });
    if(r.error){ await sb.storage.from(BUCKET).remove([path]); throw r.error; }   // 실패 시 업로드 취소

    // 4) 이전 이미지 파일 삭제
    if(old.data && old.data.image_path) await sb.storage.from(BUCKET).remove([old.data.image_path]);

    $('giftMsg').textContent = '저장했습니다.';
    $('giftFile').value = '';
    renderGiftAdm();
  }catch(e){
    $('giftMsg').textContent = '저장에 실패했습니다. 이미지 형식과 로그인 상태를 확인하세요.';
  }finally{
    btn.disabled = false;
  }
};

/* ============================================================
   [추가] 예/아니오 질문 화면
   - 화면(HTML)은 v-yesno 하나만 쓰고, 아래 QUESTIONS 설정만 늘리면 질문이 추가됨
   - next 값: 다른 질문의 id 또는 기존 화면 이름(home, input, notbday ...)
   ============================================================ */
const QUESTIONS = {
  q1: {
    text: '선물 받고싶음?',               // 큰 제목 문구 (자유롭게 수정)
    yes:  { label: '응 받고싶어', next: 'q2' }, // 예 버튼: 문구 + 이동할 곳
    no:   { label: '받기 싫은데?',   next: 'q2' }  // 아니오 버튼: 문구 + 이동할 곳
  },
  q2: {
    text: '진짜 받고싶음?',
    yes:  { label: '받고싶다고', next: 'q3' },
    no:   { label: '싫다니까?',   next: 'q3' }
  },
  q3: {
    text: '진짜 진짜 진짜 받고싶음?',
    yes:  { label: '진짜 진짜 진짜 받고싶어', next: 'q4' },
    no:   { label: '받기 싫다고.', next: 'q4' }
  },
  q4: {
    text: '너가 받기 싫어해도 난 줄거야',
    yes:  { label: '쪼아', next: 'box' },   // next:'box' → 선물상자 화면 (마지막 질문)
    no:   { label: '쪼아', next: 'box' }
  }
  // 질문을 더 추가하려면 q4 뒤에 쉼표(,)를 붙이고 q5: { ... } 를 이어서 작성
  // 예/아니오를 다른 곳으로 나누려면 next 값을 서로 다르게 지정 (예: 아니오 → 'home')
};

// 질문 화면 표시: 설정의 문구를 화면에 채우고 버튼 동작을 연결
function showQuestion(id){
  const q = QUESTIONS[id];
  if(!q){ show('home'); return; }                  // 없는 질문 id면 첫 화면으로 (오류 방지)
  $('qText').textContent = q.text;
  $('qSub').textContent  = q.sub || '';
  $('qYes').textContent  = q.yes.label || '네';
  $('qNo').textContent   = q.no.label  || '아니요';
  $('qYes').onclick = () => goNext(q.yes.next);
  $('qNo').onclick  = () => goNext(q.no.next);
  show('yesno');
}

// 이동 규칙: 질문 id면 질문 화면, 일반 화면 이름이면 그 화면, 둘 다 아니면 첫 화면
function goNext(next){
  if(next === 'box'){ openBox(); return; }      // [수정] 질문이 끝나면 선물상자 (제목 설정 포함)
  if(QUESTIONS[next]) showQuestion(next);
  else if($('v-' + next)) show(next);
  else show('home');
}

/* ============================================================
   [추가] "생일 아님" 화면 사진
   - 경로는 site_settings 테이블(key='notbday_image')에, 파일은 gifts 버킷의 notbday/ 폴더에 저장
   ============================================================ */
// 저장된 사진 경로 조회 (테이블이 없거나 오류면 null → 사진 없이 정상 동작)
async function getNbPath(){
  try{
    const { data, error } = await sb.from('site_settings')
      .select('value').eq('key', 'notbday_image').maybeSingle();
    if(error) return null;
    return data ? data.value : null;
  }catch(e){ return null; }
}

// 사용자 화면: 사진이 있으면 표시, 없으면 숨김
async function loadNotBdayImage(){
  const img = $('notbdayImg');
  img.style.display = 'none';
  const path = await getNbPath();
  if(path){ img.src = imgUrl(path); img.style.display = ''; }
}

// 개발자 화면: 현재 사진 미리보기 갱신
async function renderNb(){
  const pv = $('nbPreview');
  const path = await getNbPath();
  if(path){ pv.src = imgUrl(path); pv.style.display = ''; }
  else pv.style.display = 'none';
}

// 사진 저장: 업로드 → 경로 저장 → 이전 파일 삭제 (실패 시 업로드 취소)
$('btnNbSave').onclick = async () => {
  const file = $('nbFile').files[0];
  if(!file){ $('nbMsg').textContent = '사진을 선택하세요.'; return; }
  const btn = $('btnNbSave'); btn.disabled = true;
  try{
    const blob = await resizeImage(file);
    const path = 'notbday/' + crypto.randomUUID() + '.jpg';
    let r = await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' });
    if(r.error) throw r.error;
    const old = await getNbPath();
    r = await sb.from('site_settings').upsert(
      { key: 'notbday_image', value: path, updated_at: new Date().toISOString() });
    if(r.error){ await sb.storage.from(BUCKET).remove([path]); throw r.error; }
    if(old) await sb.storage.from(BUCKET).remove([old]);
    $('nbMsg').textContent = '저장했습니다.';
    $('nbFile').value = '';
    renderNb();
  }catch(e){
    $('nbMsg').textContent = '저장에 실패했습니다. SQL 설정과 로그인 상태를 확인하세요.';
  }finally{
    btn.disabled = false;
  }
};

// 사진 삭제: 설정 행 삭제 → 파일 삭제
$('btnNbDel').onclick = async () => {
  const old = await getNbPath();
  if(!old){ $('nbMsg').textContent = '삭제할 사진이 없습니다.'; return; }
  const r = await sb.from('site_settings').delete().eq('key', 'notbday_image');
  if(r.error){ $('nbMsg').textContent = '삭제에 실패했습니다.'; return; }
  await sb.storage.from(BUCKET).remove([old]);
  $('nbMsg').textContent = '삭제했습니다.';
  renderNb();
};

/* ============================================================
   [추가] 개발자에게 알리기 (사용자 → 개발자)
   - 전송은 서버 함수 send_dev_message만 사용 (테이블에 직접 쓰기는 불가)
   - 사용자가 버튼을 눌렀을 때만 전송 (자동 전송 X)
   ============================================================ */
let report = null;   // 지금 보내려는 내용 { kind, summary }

function showReport(kind, title, sub, summary){
  report = { kind, summary };
  $('rpTitle').textContent = title;
  $('rpSub').textContent = sub;
  $('rpNote').value = '';
  $('rpMsg').textContent = '';
  $('btnRpSend').disabled = false;
  show('report');
}

$('btnRpSend').onclick = async () => {
  const btn = $('btnRpSend'); btn.disabled = true;          // 중복 전송 방지
  const note = $('rpNote').value.trim();
  const body = report.summary + (note ? ' / 메모: ' + note : '');
  try{
    const { error } = await sb.rpc('send_dev_message', { p_kind: report.kind, p_body: body });
    if(error) throw error;
    $('rpMsg').textContent = '개발자에게 전달했어요. 고마워요!';   // 성공 후 버튼은 잠근 채로 둠
  }catch(e){
    $('rpMsg').textContent = '전달하지 못했어요. 잠시 후 다시 시도해 주세요.';
    btn.disabled = false;
  }
};

/* ============================================================
   [추가] 개발자: 받은 메시지 확인 / 삭제
   ============================================================ */
// 관리자 화면의 버튼에 메시지 개수 표시 (오류면 기본 문구 유지)
async function updateInboxCount(){
  const { count, error } = await sb.from('dev_messages').select('id', { count: 'exact', head: true });
  if(!error && count !== null) $('btnToInbox').textContent = '받은 메시지 (' + count + ')';
}

async function renderInbox(){
  const box = $('inboxList'); box.textContent = '';
  const { data, error } = await sb.from('dev_messages')
    .select('id,body,created_at').order('created_at', { ascending: false });
  if(error){ box.textContent = '불러오지 못했습니다. 다시 로그인해 보세요.'; return; }
  if(!data.length){ box.textContent = '받은 메시지가 없습니다.'; return; }
  data.forEach(m => {
    const row = document.createElement('div'); row.className = 'item';
    const sp = document.createElement('span');
    sp.textContent = new Date(m.created_at).toLocaleString('ko-KR') + ' · ' + m.body;
    const bt = document.createElement('button'); bt.className = 'btn sub'; bt.textContent = '삭제';
    bt.onclick = async () => { await sb.from('dev_messages').delete().eq('id', m.id); renderInbox(); };
    row.append(sp, bt);
    box.append(row);
  });
}

$('btnToInbox').onclick   = () => { renderInbox(); show('inbox'); };
$('btnInboxBack').onclick = () => { renderList(); show('admin'); };
