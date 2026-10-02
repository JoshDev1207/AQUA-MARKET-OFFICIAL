import {io} from 'socket.io-client';
import {state,pages,actions,forms,$,esc,date,params,link,icon,btn,heading,empty,field,submit,imageTag,out,toast,needUser,api,upload,icons} from './core.js';
let socket,current=null,conversations=[],messages=[],hasMore=false,pending=null,loadVersion=0,typingTime=0;
const peer=c=>esc(c.peer?.full_name||'AquaMarket member');
const status=text=>{const el=$('#chat-connection');if(el)el.textContent=text;};
function drawThreads(){
 const el=$('#chat-threads');if(!el)return;
 el.innerHTML=conversations.length?conversations.map(c=>`<button class="conversation ${c.id===current?.id?'active':''}" data-action="open-chat" data-id="${c.id}"><span class="avatar">${esc((c.peer.full_name||'?').slice(0,2).toUpperCase())}</span><span><strong>${peer(c)}</strong><small>@${esc(c.peer.username)}</small></span></button>`).join(''):'<p class="chat-empty-note">No conversations yet. Open a listing and choose “Message seller”.</p>';
}
function drawMessages(scroll=false){
 const el=$('#chat-message-list');if(!el)return;
 el.innerHTML=(hasMore?btn('Load earlier messages','older-messages','',true):'')+messages.map(m=>`<article class="chat-bubble ${m.sender_id===state.profile.id?'mine':''}" data-message="${m.id}">${m.body?`<p class="prewrap">${esc(m.body)}</p>`:''}${m.attachment?`<a href="${esc(m.attachment)}" target="_blank" rel="noopener noreferrer">${imageTag(m.attachment,'Chat attachment')}</a>`:''}<small>${date(m.created_at)}${m.sender_id===state.profile.id&&current?.peer_read_at>=m.created_at?' · Read':''}</small></article>`).join('');
 icons();if(scroll)el.scrollTop=el.scrollHeight;
}
async function read(){if(current&&!document.hidden){await api('/conversations/'+current.id+'/read',{method:'PATCH'}).catch(()=>{});}}
async function refreshConversations(){conversations=await api('/conversations');if(current)current=conversations.find(c=>c.id===current.id)||current;drawThreads();}
async function loadMessages(){if(!current)return;const version=++loadVersion,cid=current.id;const data=await api('/conversations/'+cid+'/messages');if(version!==loadVersion||cid!==current?.id)return;messages=data.items;hasMore=data.hasMore;drawMessages(true);await read();}
async function openChat(cid){
 if(current?.id===cid)return;current=conversations.find(c=>c.id===cid);if(!current)throw Error('Conversation not found.');pending=null;messages=[];drawThreads();
 $('#chat-panel').innerHTML=`<header class="chat-panel-heading"><div><h2>${peer(current)}</h2><p id="chat-typing" aria-live="polite">@${esc(current.peer.username)}</p></div>${btn('Refresh','refresh-chat','',true)}</header><div class="chat-message-list" id="chat-message-list" aria-live="polite" role="log"></div><form class="chat-compose" data-form="chat"><label class="sr-only" for="chat-body">Message</label><textarea id="chat-body" name="body" rows="2" maxlength="5000" placeholder="Write a message…"></textarea><div class="chat-compose-actions"><label class="attach-button">${icon('image')}<span>Add photo</span><input name="image" type="file" accept="image/jpeg,image/png,image/webp"></label>${submit('Send')}</div><p id="chat-attachment-name" class="muted"></p></form>`;
 const url=new URL(location.href);url.search='conversation='+cid;history.replaceState(null,'',url);icons();await loadMessages();
 $('#chat-body').addEventListener('input',()=>{pending=null;if(socket?.connected&&Date.now()-typingTime>2000){socket.emit('chat:typing',{conversation_id:cid});typingTime=Date.now();}});
 $('#chat-body').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();e.target.form.requestSubmit();}});
 $('#chat-panel input[type=file]').addEventListener('change',e=>{pending=null;$('#chat-attachment-name').textContent=e.target.files[0]?.name||'';});
}
function connect(){
 socket=io({auth:cb=>cb({token:state.session?.access_token}),transports:['websocket'],reconnection:true,reconnectionDelay:1000,reconnectionDelayMax:10000,randomizationFactor:0.5,autoConnect:true});
 socket.on('connect',()=>{status('Connected · messages are saved');refreshConversations().then(loadMessages).catch(e=>toast(e.message));});
 socket.on('disconnect',reason=>{status('Reconnecting…');if(reason==='io server disconnect')setTimeout(async()=>{try{await api('/me');socket.connect();}catch(e){status(e.message);}},1000);});
 socket.on('connect_error',e=>status('Chat connection unavailable. You can still send and refresh messages.'));
 socket.on('chat:message',m=>{refreshConversations().catch(()=>{});if(m.conversation_id!==current?.id)return;if(!messages.some(x=>x.id===m.id)){messages.push(m);messages.sort((a,b)=>a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id));drawMessages(true);}read();});
 socket.on('chat:typing',m=>{if(m.conversation_id!==current?.id)return;$('#chat-typing').textContent='Typing…';clearTimeout(connect.typingTimer);connect.typingTimer=setTimeout(()=>{if($('#chat-typing'))$('#chat-typing').textContent='@'+(current?.peer.username||'');},2500);});
 socket.on('chat:read',r=>{if(r.conversation_id===current?.id&&r.user_id!==state.profile.id){current.peer_read_at=r.at;drawMessages();}});
 window.addEventListener('aqua:token',()=>{socket.disconnect();socket.connect();});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)loadMessages().catch(e=>toast(e.message));});
 window.addEventListener('pagehide',()=>socket.disconnect(),{once:true});
}
pages.messages=async()=>{
 if(!needUser())return;
 out(heading('A good conversation starts here.')+`<p id="chat-connection" class="chat-connection" role="status">Connecting…</p><div class="chat-layout"><aside class="chat-thread-list"><h2>Messages</h2><div id="chat-threads"></div></aside><section class="chat-panel" id="chat-panel">${empty('Choose a conversation.','Message a seller from a listing to get started.',link('Explore marketplace','marketplace','',true))}</section></div>`);
 let target=params.get('conversation');if(params.get('seller')){const c=await api('/conversations',{method:'POST',body:{peer_id:params.get('seller')}});target=c.id;}
 await refreshConversations();if(target)await openChat(target);else if(conversations.length)await openChat(conversations[0].id);connect();
};
actions['open-chat']=el=>openChat(el.dataset.id);
actions['refresh-chat']=async()=>{await refreshConversations();await loadMessages();};
actions['older-messages']=async()=>{if(!current||!messages.length)return;const cid=current.id,oldHeight=$('#chat-message-list').scrollHeight;const data=await api('/conversations/'+cid+'/messages?before='+messages[0].id);if(current.id!==cid)return;messages=[...data.items.filter(m=>!messages.some(x=>x.id===m.id)),...messages];hasMore=data.hasMore;drawMessages();$('#chat-message-list').scrollTop=$('#chat-message-list').scrollHeight-oldHeight;};
forms.chat=async f=>{
 if(!current)return;const cid=current.id,body=f.elements.body.value.trim();if(!body&&!f.elements.image.files[0])throw Error('Write a message or choose a photo.');
 if(!pending){const media=await upload(f.elements.image.files[0],'chat');pending={conversation_id:cid,client_id:crypto.randomUUID(),body,media_id:media?.id||null};}
 const payload=pending;
 let sent;
 if(socket?.connected){try{const result=await socket.timeout(8000).emitWithAck('chat:send',payload);if(!result.ok)throw Error(result.error);sent=result.message;}catch{sent=await api('/messages',{method:'POST',body:payload});}}
 else sent=await api('/messages',{method:'POST',body:payload});
 if(current?.id===cid){if(!messages.some(m=>m.id===sent.id))messages.push(sent);drawMessages(true);f.reset();$('#chat-attachment-name').textContent='';pending=null;await read();}
};
