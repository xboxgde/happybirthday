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
$('btnConfirmYes').onclick = () => {
  $('boxTitle').textContent = found.name + '님, 생일 축하해요! 🎉';
  $('giftBox').classList.remove('open');
  show('box');
};
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
    if(!data.length){
      $('inputMsg').textContent = '등록된 생일이 없어 처음 화면으로 돌아갑니다.';
      setTimeout(() => show('home'), 1500);
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
    if(row && row.image_path){
      $('giftImg').src = imgUrl(row.image_path);
      $('giftImg').style.display = '';
    }else{                                          // 선물 이미지 미등록
      $('giftTitle').textContent = '선물이 아직 준비되지 않았어요';
      $('giftImg').style.display = 'none';
    }
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

$('btnToGifts').onclick  = () => { renderGiftAdm(); show('giftadm'); };
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
