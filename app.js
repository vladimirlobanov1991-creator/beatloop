const $=id=>document.getElementById(id), status=s=>$('status').textContent=s;
let api, score, current='', base=120, loops=0,lastTick=0, range=null, db, ready=false;
let mixMode='smart', background=35, mix=[], pendingLoop=false, loaded=false, wakeLock=null, lastScrollTarget=null;
let picking=false, firstBar=null, downBar=null;
// Transport watchdog: never reload the song or discard its practice settings.
let transportStarted=0, transportProgress=0, transportTick=null, transportStalled=false, transportLog='Ожидание запуска', transportRecoveries=0;
function countInGrace(){
  // Allow the complete count-in even at the slowest practice tempos.
  const bars=score?.masterBars||[];
  const quarters=bars.reduce((m,b)=>Math.max(m,(Number(b.timeSignatureNumerator)||4)*4/(Number(b.timeSignatureDenominator)||4)),4);
  const bpm=Math.max(1,base*Number($('speed').value)/100);
  return api?.countInVolume>0?Math.max(8000,Math.ceil(quarters*60000/bpm)+5000):5000;
}
function transportLabel(){if(ready)$('play').textContent=transportStalled?'↻ Восстановить':api?.playerState===1?'Ⅱ Пауза':'▶ Играть';}
function transportReset(message='Ожидание запуска'){
  cancelLead();
  transportStarted=transportProgress=0;transportTick=null;transportStalled=false;transportLog=message;transportLabel();
}
function transportArm(){
  transportStarted=transportProgress=Date.now();transportTick=Number(api.tickPosition);transportStalled=false;transportLog='Запуск воспроизведения';transportLabel();
}
function transportObserve(e){
  if(!transportStarted||api.playerState!==1||e.isSeek===true)return;
  if(Number.isFinite(e.currentTick)&&e.currentTick!==transportTick){
    const wasStalled=transportStalled;
    transportTick=e.currentTick;transportProgress=Date.now();transportStalled=false;transportLog='Позиция меняется';
    if(wasStalled||$('status').textContent==='Повторный запуск с текущей позиции…'){transportLabel();status('Готово к репетиции');}
  }
}
function transportCheck(){
  if(!transportStarted||!loaded||!ready||document.visibilityState!=='visible'||$('playerPage').hidden)return;
  const now=Date.now(), started=api.playerState===1;
  const grace=transportProgress===transportStarted?countInGrace():5000;
  if(!transportStalled&&now-transportProgress>grace){
    transportStalled=true;transportLog=started?'Плеер играет, но позиция не меняется':'Плеер не перешёл в состояние Playing';
    status('Воспроизведение не продвигается. Нажми «Восстановить».');transportLabel();
  }
}
function recoverTransport(){
  if(!api||!loaded||!ready)return;
  const tick=Number(api.tickPosition), priorRange=range;
  let seek=Number.isFinite(tick)?Math.max(0,tick):0;
  if(priorRange&&(seek<priorRange.startTick||seek>=priorRange.endTick))seek=priorRange.startTick;
  if(!priorRange&&Number.isFinite(api.endTick)&&seek>=api.endTick)seek=0;
  transportReset('Сброс транспорта');transportRecoveries++;
  try{
    window.beatUnlockAudio?.();api.stop();
    if(priorRange){api.playbackRange=priorRange;api.isLooping=true;}
    api.tickPosition=seek;lastTick=seek;
    window.beatUnlockAudio?.();transportArm();
    const result=api.play();
    if(result===false){transportStalled=true;transportLog='play() вернул false после сброса';transportLabel();status('Не удалось запустить. Нажми «Восстановить» ещё раз.');}
    else status('Повторный запуск с текущей позиции…');
  }catch(e){transportStalled=true;transportLog='Ошибка восстановления: '+e.message;transportLabel();status(transportLog);}
}
let leadTimer=null,leadToken=0;
function cancelLead(){leadToken++;clearTimeout(leadTimer);leadTimer=null;}
function practicePlay(){
 if(leadTimer!==null){cancelLead();transportLabel();status('Запуск отменён');return;}
 if(!api||!ready)return;beatMetro.init();
 if(transportStalled||api.playerState===1){transportPlay();return;}
 const cfg=beatMetro.config;const tick=range?.startTick??api.tickPosition??0;const bar=[...(score?.masterBars||[])].reverse().find(b=>b.start<=tick);const num=Number(bar?.timeSignatureNumerator)||4,den=Number(bar?.timeSignatureDenominator)||4;const bpm=Math.max(1,base*Number($('speed').value)/100);const interval=60000/bpm*4/den;let remaining=$('count').classList.contains('active')?num*cfg.bars:0;const total=remaining;const token=++leadToken;
 function step(){if(token!==leadToken)return;if(remaining>0){beatMetro.click((total-remaining)%num===0);status('Отсчёт: '+remaining);remaining--;leadTimer=setTimeout(step,interval);}else{leadTimer=null;status('Готово к репетиции');transportPlay();}}
 if(cfg.delay>0||remaining>0){$('play').textContent='✕ Отмена';status(cfg.delay?'Запись через '+cfg.delay+' сек':'Отсчёт');leadTimer=setTimeout(step,cfg.delay*1000);}else transportPlay();
}
function transportPlay(){
  if(!api||!(ready||api.isReadyForPlayback))return;
  if(transportStalled){recoverTransport();return;}
  window.beatUnlockAudio?.();
  if(api.playerState===1){transportReset('Пауза');api.pause();return;}
  transportArm();
  try{const result=api.play();if(result===false){transportStalled=true;transportLog='play() вернул false';transportLabel();status('Плеер не запустился. Нажми «Восстановить».');}}
  catch(e){transportStalled=true;transportLog='Ошибка запуска: '+e.message;transportLabel();status(transportLog);}
}
setInterval(transportCheck,500);

function pickUI(){ $('pick').classList.toggle('active',picking||!!range); $('pick').textContent=picking?'✕': '🔁'; $('pickHint').textContent=picking?(firstBar===null?'Нажми на первый такт':'Первый такт: '+firstBar+'. Нажми на последний'):(range?'Цикл: '+$('from').value+'–'+$('to').value:'Нажми 🔁, чтобы выбрать такты на нотах'); $('pick').setAttribute('aria-pressed',String(picking||!!range)); }
function cancelPick(){picking=false;firstBar=null;downBar=null;pickUI();}
function barOf(beat){return beat?.voice?.bar?.index+1;}
function commitPick(a,b){$('from').value=Math.min(a,b);$('to').value=Math.max(a,b);cancelPick();setLoop(true);}
const CDN='https://cdn.jsdelivr.net/npm/@coderline/alphatab@1.6.3/dist/';
function controls(v){if(!v)transportReset();ready=v;$('play').disabled=$('stop').disabled=!v;$('play').textContent=v?'▶ Играть':'Загрузка звука…';}
function speed(v){v=Math.max(10,Math.min(200,Math.round(v)));$('speed').value=v;$('speedLabel').textContent=v+'%';$('bpm').textContent='≈ '+Math.round(base*v/100)+' BPM';if(api)api.playbackSpeed=v/100;document.querySelectorAll('[data-speed]').forEach(b=>b.classList.toggle('active',Number(b.dataset.speed)===v));saveSettings();}
function saveSettings(){if(current&&loaded)try{localStorage.setItem('beat:'+current,JSON.stringify({speed:$('speed').value,from:$('from').value,to:$('to').value,loop:!!range||pendingLoop,track:Number($('track').value),mixMode,background,mix,trainer:$('trainer').checked,step:$('step').value,every:$('every').value}));}catch{}}
function setLoop(on){if(!score||!api)return;try{if(on){const a=Number($('from').value),b=Number($('to').value),bars=score.masterBars;if(!Number.isInteger(a)||!Number.isInteger(b)||a<1||b<a||b>bars.length)throw Error('Проверь номера тактов');const start=bars[a-1].start,end=b<bars.length?bars[b].start-1:api.endTick;if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)throw Error('Диапазон недоступен');range={startTick:start,endTick:end};api.playbackRange=range;api.isLooping=true;api.tickPosition=start;lastTick=start;loops=0;$('cycles').textContent='Повторы: 0';}else{range=null;api.isLooping=false;api.playbackRange=null;} $('loop').classList.toggle('active',!!range);$('loop').textContent=range?'Выкл.':'Вкл.';saveSettings();pickUI();if(!range&&$('focus').classList.contains('active'))setFocus(false);else if(range&&$('focus').classList.contains('active'))setFocus(true);requestAnimationFrame(()=>centerCursor(true));}catch(e){status(e.message);}}
function openDb(){return new Promise((res,rej)=>{const r=indexedDB.open('beatloop',1);r.onupgradeneeded=()=>r.result.createObjectStore('songs',{keyPath:'name'});r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
function request(mode,fn){return new Promise((res,rej)=>{const tx=db.transaction('songs',mode),r=fn(tx.objectStore('songs'));tx.oncomplete=()=>res(r.result);tx.onerror=()=>rej(tx.error);});}
async function refresh(){if(!db)return;const songs=await request('readonly',s=>s.getAllKeys());$('library').replaceChildren(new Option('Моя библиотека',''));songs.forEach(n=>$('library').add(new Option(n,n)));$('library').value=current;$('songList').replaceChildren();songs.forEach(n=>{const b=document.createElement('button');b.className='listitem';b.textContent=n+'  ›';b.onclick=()=>openSong(n);$('songList').append(b);});$('libraryStatus').textContent=songs.length?'Сохранено: '+songs.length:'Добавь первую композицию.';}
function load(name,bytes){if(!api)return;controls(false);loaded=false;pendingLoop=false;api.stop();setFocus(false);range=null;api.isLooping=false;api.playbackRange=null;current=name;cancelPick();showPage('player');status('Чтение партитуры…');try{if(!api.load(new Uint8Array(bytes)))status('Не удалось открыть файл');}catch(e){status(e.message);}}
try{api=new alphaTab.AlphaTabApi($('score'),{core:{fontDirectory:CDN+'font/'},player:{enablePlayer:true,soundFont:CDN+'soundfont/sonivox.sf2',enableCursor:true,enableUserInteraction:true,enableAnimatedBeatCursor:true,scrollElement:$('scoreScroll'),scrollMode:'off'}});api.countInVolume=0;api.metronomeVolume=0; api.midiEventsPlayedFilter=[alphaTab.midi.MidiEventType.AlphaTabMetronome]; api.midiEventsPlayed.on(e=>{if(api.playerState!==1||!$('metro').classList.contains('active')||beatMetro.config.only)return;for(const m of e.events||[]){const bar=score?.masterBars?.find(b=>b.start===m.tick);beatMetro.click(!!bar);}});
api.beatMouseDown.on(beat=>{if(picking)downBar=barOf(beat);});
api.beatMouseUp.on(beat=>{if(!picking){if(range){const savedRange=range;setTimeout(()=>{if(range===savedRange){api.playbackRange=savedRange;api.isLooping=true;}},0);}return;}const b=barOf(beat),a=downBar;downBar=null;if(!Number.isInteger(b))return;setTimeout(()=>{if(!picking)return;if(Number.isInteger(a)&&a!==b){commitPick(a,b);return;}if(firstBar===null){firstBar=b;pickUI();}else commitPick(firstBar,b);},0);});
api.error.on(e=>status('Ошибка: '+(e.message||e)));api.scoreLoaded.on(s=>{score=s;base=s.tempo||120;$('song').textContent=[s.artist,s.title].filter(Boolean).join(' · ')||current||'Демо';$('track').replaceChildren();$('mixer').replaceChildren();s.tracks.forEach((t,i)=>$('track').add(new Option(t.name||'Дорожка '+(i+1),i)));const drums=s.tracks.findIndex(t=>t.staves.some(st=>st.isPercussion));let saved={};try{saved=JSON.parse(localStorage.getItem('beat:'+current)||'{}');}catch{}const idx=Number.isInteger(saved.track)&&s.tracks[saved.track]?saved.track:Math.max(0,drums);$('track').value=idx;api.renderTracks([s.tracks[idx]]);$('from').max=$('to').max=s.masterBars.length;$('from').value=Math.max(1,Math.min(s.masterBars.length,Number(saved.from)||1));$('to').value=Math.max(Number($('from').value),Math.min(s.masterBars.length,Number(saved.to)||4));mixMode=['smart','drums','minus','all','original','manual'].includes(saved.mixMode)?saved.mixMode:'smart';background=Number.isFinite(saved.background)?Math.max(0,Math.min(100,saved.background)):35;mix=s.tracks.map((t,i)=>({volume:Math.max(0,Math.min(100,Number(saved.mix?.[i]?.volume??100))),mute:!!saved.mix?.[i]?.mute,solo:!!saved.mix?.[i]?.solo}));$('trainer').checked=!!saved.trainer;$('step').value=saved.step||5;$('every').value=saved.every||4;pendingLoop=!!saved.loop;loaded=true;buildMixer();speed(saved.speed||100);$('loop').classList.remove('active');$('loop').textContent='Вкл.';cancelPick();resizeScore();$('scoreScroll').scrollTop=0;lastScrollTarget=null;status('Подготовка звука…');if(api.isReadyForPlayback){onReady();}});api.playerReady.on(()=>{onReady();});api.soundFontLoaded.on(()=>{if(!ready)status('Звуковой банк загружен, подготовка MIDI…');});api.playerStateChanged.on(e=>{if(e.state===1){if(!transportStarted)transportArm();transportLabel();resizeScore();acquireWake();requestAnimationFrame(()=>centerCursor(true));}else{releaseWake();if(!transportStarted)transportLabel();else if(!transportStalled)$('play').textContent='▶ Играть';}});api.playerFinished.on(()=>{if(!range)transportReset('Композиция завершена');});api.playerPositionChanged.on(e=>{transportObserve(e);if(range&&e.currentTick<lastTick-100&&lastTick>range.startTick+(range.endTick-range.startTick)/2){loops++;$('cycles').textContent='Повторы: '+loops;if($('trainer').checked&&loops%Math.max(1,Number($('every').value))===0)speed(Number($('speed').value)+100*Number($('step').value)/base);}lastTick=e.currentTick;if(api.playerState===1)requestAnimationFrame(()=>centerCursor(false));});status('Добавь файл Guitar Pro или открой демо');}catch(e){status('Движок не загрузился: '+e.message);}
$('file').onchange=async e=>{const f=e.target.files[0];if(!f)return;let bytes;try{bytes=await f.arrayBuffer();}catch(err){status('Не удалось прочитать файл: '+err.message);return;}try{if(db)await request('readwrite',s=>s.put({name:f.name,bytes}));}catch(err){status('Не удалось сохранить файл локально');}load(f.name,bytes);await refresh();e.target.value='';};$('library').onchange=()=>{};$('openSong').onclick=()=>openSong($('library').value);$('remove').onclick=async()=>{const n=$('library').value;if(n&&db&&confirm('Удалить '+n+' из библиотеки?')){await request('readwrite',s=>s.delete(n));await refresh();}};$('track').onchange=()=>{if(score){api.renderTracks([score.tracks[Number($('track').value)]]);if(mixMode==='smart')applyMix();saveSettings();}};$('speed').oninput=e=>speed(e.target.value);$('presets').onclick=e=>{if(e.target.tagName==='BUTTON')speed(parseInt(e.target.textContent));};$('loop').onclick=()=>{cancelPick();setLoop(!range);};$('pick').onclick=()=>{if(!score||!ready)return;if(picking){cancelPick();return;}if(range){setLoop(false);return;}if(api.playerState===1){transportReset('Выбор цикла');api.pause();}picking=true;firstBar=null;pickUI();};for(const id of ['from','to'])$(id).onchange=()=>{if(range)setLoop(true);else saveSettings();};$('play').onclick=practicePlay;$('recover').onclick=()=>{if(!loaded||!ready){status('Сначала открой композицию');return;}$('settingsDialog').close();recoverTransport();};setInterval(()=>{if(api&&score&&loaded&&api.isReadyForPlayback&&!ready){onReady();}},500);$('stop').onclick=()=>{if(!api)return;transportReset('Стоп');api.stop();lastTick=0;status('Готово к репетиции');};$('metro').onclick=()=>{beatMetro.init();$('metro').classList.toggle('active');};$('count').onclick=()=>{$('count').classList.toggle('active');};$('demo').onclick=()=>{if(!api)return;showPage('player');loaded=false;pendingLoop=false;setFocus(false);current='';cancelPick();controls(false);api.stop();range=null;api.isLooping=false;api.playbackRange=null;try{api.tex('\\title "Practice demo" \\tempo 120 . :8 0.6 0.6 3.6 0.6 5.6 0.6 3.6 0.6 | 0.6 0.6 3.6 0.6 5.6 0.6 3.6 0.6 | 0.6 0.6 3.6 0.6 5.6 0.6 3.6 0.6 | 0.6 0.6 3.6 0.6 5.6 0.6 3.6 0.6');}catch(e){status(e.message);}};openDb().then(d=>{db=d;return refresh();}).catch(()=>{$('libraryStatus').textContent='Локальная библиотека недоступна';status('Локальная библиотека недоступна');});if('serviceWorker'in navigator&&location.protocol==='https:')navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(r=>r.update()).catch(()=>{});

function onReady(){if(!loaded)return;controls(true);status('Готово к репетиции');applyMix();if(pendingLoop){pendingLoop=false;setLoop(true);}}
function showPage(name){if(name!=='player'){document.body.classList.remove('full');if(api?.playerState===1)api.pause();transportReset('Переход между разделами');}if(name!=='school')window.stopLesson?.();for(const p of ['player','library','school'])$(p+'Page').hidden=p!==name;document.querySelectorAll('nav [data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===name));if(name==='player'&&api&&score)requestAnimationFrame(()=>{api.triggerResize?.();});}
async function openSong(n){if(!n||!db)return;try{const s=await request('readonly',o=>o.get(n));if(s)load(s.name,s.bytes);}catch(e){$('libraryStatus').textContent='Ошибка чтения: '+e.message;}}
function setFocus(on){if(!api)return;on=!!on&&!!range;const b=$('focus');const prev=b.classList.contains('active');b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on));const start=on?Number($('from').value):1,count=on?Number($('to').value)-start+1:-1;if(api.settings.display.startBar===start&&api.settings.display.barCount===count&&!prev&&!on)return;api.settings.display.startBar=start;api.settings.display.barCount=count;api.updateSettings();if(score)api.render();lastScrollTarget=null;if(on)$('scoreScroll').scrollTop=0;}
function centerCursor(force){if(!score||$('playerPage').hidden||$('position').value==='off')return;const sc=$('scoreScroll'),cursor=$('score').querySelector('.at-cursor-bar');if(!cursor||!cursor.getClientRects().length)return;const r=cursor.getBoundingClientRect(),v=sc.getBoundingClientRect();if(r.height<1)return;const pos=$('position').value,frac=pos==='center'?.5:pos==='third'?.33:.06;const absolute=r.top-v.top+sc.scrollTop;const target=Math.max(0,absolute-frac*Math.max(0,v.height-r.height));if(!force&&lastScrollTarget!==null&&Math.abs(target-lastScrollTarget)<15)return;lastScrollTarget=target;if(Math.abs(sc.scrollTop-target)>12)sc.scrollTo({top:target,behavior:$('smooth').checked&&!force?'smooth':'auto'});}
function resizeScore(){const sc=$('scoreScroll');$('score').style.setProperty('--score-pad',Math.round(sc.clientHeight*.48)+'px');$('scoreLead').style.setProperty('--lead',api?.playerState===1&&$('position').value!=='off'?Math.round(sc.clientHeight*.34)+'px':'0px');lastScrollTarget=null;}
if(window.ResizeObserver)new ResizeObserver(resizeScore).observe($('scoreScroll'));else window.addEventListener('resize',resizeScore);
function isDrum(t){return t.staves.some(s=>s.isPercussion);}
function effectiveVolume(i){if(mixMode==='smart')return i===Number($('track').value)?100:background;if(mixMode==='original'||mixMode==='all'||mixMode==='drums'||mixMode==='minus')return 100;return mix[i].volume;}
function applyMix(){if(!score||!api)return;const hasSolo=mix.some(m=>m.solo);score.tracks.forEach((t,i)=>{const m=mix[i];if(!m)return;const v=effectiveVolume(i);const muted=m.mute||(mixMode==='drums'&&!isDrum(t))||(mixMode==='minus'&&isDrum(t));api.changeTrackMute([t],false);api.changeTrackSolo([t],false);api.changeTrackVolume([t],muted||(hasSolo&&!m.solo)?0:v/100);const row=$('mixer').children[i];if(row){row.querySelector('input').value=v;row.querySelector('small').textContent=v+'%';row.querySelector('.mute').classList.toggle('active',muted);row.querySelector('.solo').classList.toggle('active',m.solo);row.querySelector('.name').classList.toggle('focused',mixMode==='smart'&&i===Number($('track').value));row.querySelector('.name').classList.toggle('quiet',muted||(hasSolo&&!m.solo));}});$('background').value=background;$('backgroundLabel').textContent=background+'%';$('background').disabled=mixMode!=='smart';document.querySelectorAll('[data-mix]').forEach(b=>b.classList.toggle('active',b.dataset.mix===mixMode));saveSettings();}
function chooseMix(mode){if(!score)return;if((mode==='drums'||mode==='minus')&&!score.tracks.some(isDrum)){status('В этой композиции нет ударных');return;}if(mode==='manual')mix.forEach((m,i)=>m.volume=effectiveVolume(i));else mix.forEach(m=>{m.mute=false;m.solo=false;});mixMode=mode;applyMix();}
function buildMixer(){$('mixer').replaceChildren();if(!score)return;score.tracks.forEach((t,i)=>{const row=document.createElement('div');row.className='mixrow';const top=document.createElement('div');top.className='row';const name=document.createElement('span');name.className='name';name.textContent=(isDrum(t)?'🥁 ':'')+(t.name||'Дорожка '+(i+1));const pct=document.createElement('small');top.append(name,pct);for(const k of ['mute','solo']){const b=document.createElement('button');b.className=k;b.textContent=k==='mute'?'M':'S';b.setAttribute('aria-label',(k==='mute'?'Mute ':'Solo ')+t.name);b.onclick=()=>{if(mixMode==='drums'||mixMode==='minus'){mix.forEach((m,j)=>{m.volume=effectiveVolume(j);m.mute=mixMode==='drums'?!isDrum(score.tracks[j]):isDrum(score.tracks[j]);});mixMode='manual';}mix[i][k]=!mix[i][k];applyMix();};top.append(b);}const vol=document.createElement('input');vol.type='range';vol.min=0;vol.max=100;vol.setAttribute('aria-label','Громкость '+t.name);vol.oninput=()=>{const v=Number(vol.value);if(mixMode!=='manual'){mix.forEach((m,j)=>{m.volume=effectiveVolume(j);if(mixMode==='drums')m.mute=!isDrum(score.tracks[j]);if(mixMode==='minus')m.mute=isDrum(score.tracks[j]);});mixMode='manual';}mix[i].volume=v;applyMix();};row.append(top,vol);$('mixer').append(row);});if(ready)applyMix();else{$('background').value=background;$('backgroundLabel').textContent=background+'%';}}
async function acquireWake(){if(!$('wake').checked||wakeLock||!navigator.wakeLock||document.visibilityState!=='visible')return;try{const lock=await navigator.wakeLock.request('screen');if(api?.playerState!==1&&!window.lessonPlaying?.()){await lock.release();return;}wakeLock=lock;$('wakeStatus').textContent='Экран не гаснет во время игры';lock.addEventListener('release',()=>{if(wakeLock===lock)wakeLock=null;});}catch(e){$('wakeStatus').textContent='Удержание экрана недоступно: '+e.name;}}
function releaseWake(){if(wakeLock){wakeLock.release().catch(()=>{});wakeLock=null;}}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){if(transportStarted){transportStarted=transportProgress=Date.now();transportTick=Number(api?.tickPosition);transportStalled=false;transportLabel();}if(api?.playerState===1||window.lessonPlaying?.())acquireWake();}});
function saveGlobal(){try{localStorage.setItem('beatloop-ui',JSON.stringify({zoom:$('zoom').value,position:$('position').value,smooth:$('smooth').checked,wake:$('wake').checked}));}catch{}}
try{const g=JSON.parse(localStorage.getItem('beatloop-ui')||'{}');if(g.zoom)$('zoom').value=g.zoom;if(g.position)$('position').value=g.position;if(typeof g.smooth==='boolean')$('smooth').checked=g.smooth;if(typeof g.wake==='boolean')$('wake').checked=g.wake;}catch{}
function zoom(){const v=Number($('zoom').value);$('zoomLabel').textContent=v+'%';if(api){api.settings.display.scale=v/100;api.updateSettings();if(score)api.render();}lastScrollTarget=null;saveGlobal();}
$('zoom').onchange=zoom;$('zoom').oninput=()=>{$('zoomLabel').textContent=$('zoom').value+'%';};zoom();
$('position').onchange=()=>{resizeScore();centerCursor(true);saveGlobal();};$('smooth').onchange=saveGlobal;$('wake').onchange=()=>{saveGlobal();if(!$('wake').checked)releaseWake();else if(api?.playerState===1||window.lessonPlaying?.())acquireWake();};
$('focus').onclick=()=>{if(!range){status('Сначала выдели цикл кнопкой 🔁');return;}setFocus(!$('focus').classList.contains('active'));};$('full').onclick=()=>{document.body.classList.toggle('full');requestAnimationFrame(()=>api?.triggerResize?.());};
for(const b of document.querySelectorAll('nav [data-page]'))b.onclick=()=>showPage(b.dataset.page);
for(const [b,d] of [['openMixer','mixDialog'],['openPractice','practiceDialog'],['openSettings','settingsDialog']])$(b).onclick=()=>{if(d==='settingsDialog')$('diagnostics').textContent='AudioContext: '+([...window.beatAudioContexts].map(c=>c.state).join(', ')||'ещё не создан')+' · Player: '+(api?.playerState??'—')+' · Tick: '+(api?.tickPosition??'—')+' · '+transportLog+' · Сбросов: '+transportRecoveries+' · Wake Lock: '+(navigator.wakeLock?'поддерживается':'недоступен');$(d).showModal();};
for(const b of document.querySelectorAll('[data-close]'))b.onclick=()=>$(b.dataset.close).close();for(const b of document.querySelectorAll('[data-mix]'))b.onclick=()=>chooseMix(b.dataset.mix);
$('background').oninput=()=>{background=Number($('background').value);applyMix();};for(const id of ['trainer','step','every'])$(id).onchange=saveSettings;
// iOS supports the playback audio session on some versions. Keep existing alphaTab output.
try{if(navigator.audioSession)navigator.audioSession.type='playback';}catch{}

document.querySelectorAll('[data-speed]').forEach(b=>b.onclick=()=>speed(Number(b.dataset.speed)));document.querySelector('[data-speed="100"]').classList.add('active');
$('metro').addEventListener('contextmenu',e=>{e.preventDefault();$('metroDialog').showModal();});
