import {state,pages,actions,forms,$,$$,page,esc,link,heading,empty,btn,out,toast,icons,init,render,badges} from './core.js';
import './marketplace.js';
import './account.js';
import './chat.js';
import './admin.js';
import './analytics.js';
import './info.js';

document.addEventListener('click',async e=>{
 const el=e.target.closest('[data-action]');if(!el||el.disabled)return;const fn=actions[el.dataset.action];if(!fn)return;e.preventDefault();
 el.disabled=true;try{await fn(el,e);}catch(err){toast(err.message);}finally{if(el.isConnected&&el.dataset.cooldown!=='true')el.disabled=false;}
});
document.addEventListener('submit',async e=>{
 const f=e.target.closest('form[data-form]');if(!f)return;e.preventDefault();if(f.dataset.busy==='true'||!f.reportValidity())return;
 const fn=forms[f.dataset.form];if(!fn)return;const b=f.querySelector('[type="submit"]'),error=f.querySelector('.form-error');if(error)error.hidden=true;
 f.dataset.busy='true';if(b){b.disabled=true;b.dataset.label=b.textContent;b.textContent=f.dataset.form==='listing'?'Saving photos and listing…':'Please wait…';}
 try{await fn(f);}catch(err){if(error){error.hidden=false;error.textContent=err.message;}else toast(err.message);}finally{f.dataset.busy='false';if(b){b.disabled=false;b.textContent=b.dataset.label;}}
});
document.addEventListener('change',e=>{
 if(e.target.type!=='file'||!$('#upload-preview'))return;const box=$('#upload-preview');box.querySelectorAll('img').forEach(i=>URL.revokeObjectURL(i.src));box.innerHTML='';
 for(const f of [...e.target.files].slice(0,6)){if(!['image/jpeg','image/png','image/webp'].includes(f.type))continue;const img=document.createElement('img');img.src=URL.createObjectURL(f);img.alt=f.name;box.append(img);}
});
$('#modal').addEventListener('click',e=>{if(e.target===$('#modal')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
// Authentication tokens are the only persistent browser state. Never read the old demo store.
try{localStorage.removeItem('aquamarket.demo.v2');}catch{}
out('<div class="loading-state" role="status">Loading AquaMarket…</div>');
try{
 await init();
 if(!state.config.configured&&!['about','guidelines','terms','privacy','credits'].includes(page))out(empty('AquaMarket is almost ready.','The owner needs to connect the backend using SETUP.md. No listings or accounts have been loaded.',btn('Try again','reload')));
 else { await render(); await badges(); }
}catch(e){out(empty('Unable to connect',e.message,btn('Try again','reload')));}
icons();
