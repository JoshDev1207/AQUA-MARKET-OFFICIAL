import { createClient } from '@supabase/supabase-js';
export const state={auth:null,session:null,profile:null,email:'',favorites:[],config:null};
export const pages={},actions={},forms={};
export const $=(s,r=document)=>r.querySelector(s);
export const $$=(s,r=document)=>[...r.querySelectorAll(s)];
export const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const money=n=>'₱'+Number(n||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
export const date=v=>new Date(v).toLocaleString('en-PH',{dateStyle:'medium',timeStyle:'short'});
export const params=new URLSearchParams(location.search);
export const page=location.pathname.startsWith('/admin/')?'admin-'+(location.pathname.split('/').pop()?.replace('.html','')||'index'):(location.pathname.split('/').pop()?.replace('.html','')||'index');
export const href=(name,q='')=>'/'+name+'.html'+(q?'?'+q:'');
export const link=(label,name,q='',secondary=false)=>`<a class="button${secondary?' secondary':''}" href="${esc(href(name,q))}">${label}</a>`;
export const icon=name=>`<i data-lucide="${esc(name)}" aria-hidden="true"></i>`;
export const btn=(label,action,attrs='',secondary=false)=>`<button type="button" class="button${secondary?' secondary':''}" data-action="${action}" ${attrs}>${label}</button>`;
export const heading=(name,extra='')=>`<div class="page-heading"><h1>${esc(name)}</h1>${extra}</div>`;
export const empty=(title,text='',extra='')=>`<div class="empty-state">${icon('fish')}<h2>${esc(title)}</h2><p>${esc(text)}</p>${extra}</div>`;
export const badge=text=>`<span class="status status-${esc(text)}">${esc(text)}</span>`;
export const field=(label,name,value='',type='text',attrs='')=>`<label class="field"><span>${esc(label)}</span><input name="${name}" type="${type}" value="${esc(value)}" ${attrs}></label>`;
export const area=(label,name,value='',attrs='')=>`<label class="field"><span>${esc(label)}</span><textarea name="${name}" rows="4" ${attrs}>${esc(value)}</textarea></label>`;
export const select=(label,name,options,value='',attrs='')=>`<label class="field"><span>${esc(label)}</span><select name="${name}" ${attrs}>${options.map(o=>{const v=typeof o==='string'?o:o.value;return `<option value="${esc(v)}" ${v===value?'selected':''}>${esc(typeof o==='string'?o:o.label)}</option>`;}).join('')}</select></label>`;
export const formData=f=>Object.fromEntries(new FormData(f));
export const submit=(label='Save changes')=>`<p class="form-error" role="alert" hidden></p><button type="submit" class="button">${label}</button>`;
export const imageInput=(label='Photos (JPG, PNG, WebP, up to 4 MB each)',multiple=false)=>field(label,'image','','file',`accept="image/jpeg,image/png,image/webp" ${multiple?'multiple':''}`);
export const imageTag=(url,alt='',cls='')=>url?`<img class="${cls}" src="${esc(url)}" alt="${esc(alt)}" loading="lazy">`:`<div class="image-placeholder">${icon('image')}</div>`;
export const card=l=>`<article class="product-card"><div class="product-image"><a href="${href(l.kind==='trade'?'trade-details':'product','id='+l.id)}">${imageTag(l.images?.[0]?.url,l.title)}</a><button class="icon-button favorite" data-action="favorite" data-id="${l.id}" aria-label="Save listing" aria-pressed="${state.favorites.includes(l.id)}">${icon('heart')}</button></div><div class="product-name-row"><h3><a href="${href(l.kind==='trade'?'trade-details':'product','id='+l.id)}">${esc(l.title)}</a></h3><span class="price">${l.kind==='trade'?'For trade':money(l.price)}</span></div><a class="seller-line" href="${href('seller','id='+l.seller_id)}">${esc(l.seller?.store_name||l.seller?.full_name)}</a><p class="seller-line">${l.kind==='trade'?esc(l.trade_preference):l.stock>0?`${l.stock} available`:'Out of stock'}</p></article>`;
export const accountNav=()=>`<nav class="account-nav" aria-label="Account">${[['profile','Profile'],['orders','Orders & sales'],['my-listings','My listings'],['my-trades','My trades'],['messages','Messages'],['favorites','Favorites'],['seller-register','Seller account'],['history','Activity'],['support','Support']].map(([p,t])=>`<a href="${href(p)}" ${p===page?'aria-current="page"':''}>${t}</a>`).join('')}${state.profile?.role==='admin'?`<a href="/admin/index.html">Administration</a>`:''}<button data-action="logout">Sign out</button></nav>`;
export const icons=()=>window.lucide?.createIcons();
export function out(html){$('#page-content').innerHTML=html;icons();}
export function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('visible'),5000);}
export function modal(title,html){$('#modal-content').innerHTML=`<h2 id="modal-title">${esc(title)}</h2>${html}`;if(!$('#modal').open)$('#modal').showModal();icons();}
export const closeModal=()=>$('#modal').close();
export function needUser(){if(state.profile)return true;location.assign('/login.html?next='+encodeURIComponent(location.pathname+location.search));return false;}
export function safeNext(value){try{const u=new URL(value||'/profile.html',location.origin);return u.origin===location.origin&&!['/login.html','/register.html','/auth-callback.html'].includes(u.pathname)?u.pathname+u.search:'/profile.html';}catch{return '/profile.html';}}
export async function api(path,{method='GET',body,...options}={}){
 const headers=new Headers(options.headers);if(state.auth){const {data}=await state.auth.auth.getSession();state.session=data.session;if(data.session)headers.set('Authorization','Bearer '+data.session.access_token);}
 if(body&&!(body instanceof FormData)){headers.set('Content-Type','application/json');body=JSON.stringify(body);}
 let response;try{response=await fetch('/api'+path,{...options,method,body,headers});}catch{throw Error('Connection lost. Check your internet and try again.');}
 const data=await response.json().catch(()=>({error:response.status===413?'This upload is too large. Choose an image up to 4 MB.':'The server returned an unreadable response.'}));
 if(!response.ok){const e=Error(data.error||'Request failed.');e.status=response.status;throw e;}return data;
}
export async function upload(file,purpose){if(!file?.size)return null;if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>(state.config?.maxUploadBytes||4_000_000))throw Error('Choose a JPG, PNG, or WebP image up to 4 MB.');const body=new FormData();body.append('image',file);return api('/uploads/'+purpose,{method:'POST',body});}
export async function refreshMe(){const me=await api('/me');state.profile=me.profile;state.email=me.email;return me;}
export async function render(){try{await (pages[page]||pages.info)();icons();}catch(e){out(empty('Unable to load this page',e.message,btn('Try again','reload')));}}
export async function badges(){if(!state.profile)return;try{const [cart,notes]=await Promise.all([api('/cart'),api('/notifications')]);const el=$('#cart-count');if(el){el.textContent=cart.reduce((n,r)=>n+r.quantity,0);el.hidden=!Number(el.textContent);}const dot=$('.notification-dot');if(dot)dot.hidden=!notes.some(n=>!n.read);}catch{}}
export async function init(){
 state.config=await api('/config');
 if(!state.config.configured)return;
 state.auth=createClient(state.config.supabaseUrl,state.config.publicKey,{auth:{flowType:'pkce',detectSessionInUrl:true,persistSession:true,autoRefreshToken:true}});
 const {data,error}=await state.auth.auth.getSession();if(error)throw error;state.session=data.session;
 if(state.session){try{await refreshMe();state.favorites=(await api('/favorites')).map(l=>l.id);}catch(e){if(![401,403].includes(e.status))throw e;await state.auth.auth.signOut({scope:'local'});state.session=null;state.profile=null;state.favorites=[];}}
 state.auth.auth.onAuthStateChange((event,session)=>{
  state.session=session;
  if(event==='TOKEN_REFRESHED')window.dispatchEvent(new Event('aqua:token'));
  if(event==='SIGNED_OUT'&&state.profile){state.profile=null;location.assign('/login.html');}
  if(event==='PASSWORD_RECOVERY'&&page!=='reset-password')location.assign('/reset-password.html');
 });
}
actions.reload=()=>location.reload();actions['close-modal']=closeModal;
actions.logout=async()=>{await state.auth.auth.signOut();location.assign('/index.html');};
actions.menu=()=>modal('AquaMarket',`<nav class="drawer-nav">${[['index','Home'],['marketplace','Marketplace'],['fish','Fish'],['trade','Trade'],['profile','Account'],['messages','Messages'],['cart','Cart'],['about','About']].map(([p,t])=>`<a href="${href(p)}">${t}</a>`).join('')}</nav>`);
actions.search=()=>modal('Find your next favorite',`<form data-form="search">${field('Search listings','q','','search','required maxlength="120"')}${submit('Search marketplace')}</form>`);
forms.search=f=>location.assign('/marketplace.html?q='+encodeURIComponent(formData(f).q));
actions.notifications=async()=>{if(!needUser())return;const list=await api('/notifications');modal('Notifications',list.length?`<div class="notification-list">${list.map(n=>`<a href="${esc(n.href)}"><span>${esc(n.body)}<small>${date(n.created_at)}</small></span>${n.read?'':icon('circle')}</a>`).join('')}</div>`:'<p>You are all caught up.</p>');await api('/notifications',{method:'PATCH'});badges();};
actions.favorite=async el=>{if(!needUser())return;const id=el.dataset.id,exists=state.favorites.includes(id);await api('/favorites/'+id,{method:exists?'DELETE':'PUT'});state.favorites=exists?state.favorites.filter(x=>x!==id):[...state.favorites,id];$$(`[data-action="favorite"][data-id="${CSS.escape(id)}"]`).forEach(b=>b.setAttribute('aria-pressed',!exists));toast(exists?'Removed from favorites':'Saved to favorites');if(page==='favorites')render();};
actions.report=el=>{if(!needUser())return;modal('Report a concern',`<form data-form="report"><input type="hidden" name="target_type" value="${esc(el.dataset.type)}"><input type="hidden" name="target_id" value="${esc(el.dataset.id)}">${select('Reason','reason',['Listing information','Animal welfare concern','Inappropriate content','Suspected scam','Other'])}${area('What happened?','details','','required minlength="5" maxlength="3000"')}${submit('Submit report')}</form>`);};
forms.report=async f=>{await api('/reports',{method:'POST',body:formData(f)});closeModal();toast('Report saved. You can follow its progress in Support.');};
