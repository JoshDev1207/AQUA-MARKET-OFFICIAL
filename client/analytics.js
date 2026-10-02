import {pages,actions,forms,$,esc,money,date,params,btn,heading,empty,select,submit,out,api,formData} from './core.js';
import {guard} from './admin.js';

let days=[7,30,90].includes(Number(params.get('days')))?Number(params.get('days')):30;
const metricLabels={
 total_users:'Total users',new_users:'New users',active_sellers:'Active approved sellers',pending_sellers:'Pending seller applications',
 active_sale_listings:'Visible sale listings',active_trade_listings:'Visible trade listings',out_of_stock_listings:'Out-of-stock listings',
 low_stock_listings:'Listings with 1–3 units',orders_placed:'Orders placed',orders_completed_paid:'Completed paid orders',
 completed_paid_value:'Completed paid order value',orders_cancelled:'Cancelled orders',orders_pending:'Pending orders',
 previous_orders_placed:'Orders in previous period',previous_completed_paid_value:'Paid value in previous period',open_reports:'Open reports',trades_completed:'Completed trades'
};
const valueFor=(key,value)=>key.includes('value')?money(value):Number(value).toLocaleString();
const table=(headers,rows)=>`<div class="table-wrap"><table><thead><tr>${headers.map(x=>`<th scope="col">${esc(x)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(x=>`<td>${x}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
function chart(daily){
 const max=Math.max(0,...daily.map(d=>d.orders));
 if(!max)return empty('No orders in this period.','The chart will appear after real orders are placed.');
 return `<figure class="analytics-chart"><figcaption>Orders placed each day (UTC)</figcaption><div class="analytics-bars" role="img" aria-label="Daily order counts, from ${esc(daily[0].date)} to ${esc(daily.at(-1).date)}. The daily figures table follows.">${daily.map(d=>`<span style="height:${Math.max(1,100*d.orders/max)}%;opacity:${d.orders?1:0.15}" title="${esc(d.date)}: ${d.orders} orders"></span>`).join('')}</div><div class="row-between"><small>${esc(daily[0].date)}</small><small>Peak: ${max} orders/day</small><small>${esc(daily.at(-1).date)}</small></div></figure>`;
}
pages['admin-analytics']=async()=>{
 if(!guard())return;
 const {snapshot:s,ai}=await api('/admin/analytics?days='+days);
 const m=s.metrics;
 out(heading('Analytics & recommendations.')+`<form data-form="analytics-period" class="analytics-controls">${select('Reporting period','days',[{value:'7',label:'Past 7 days'},{value:'30',label:'Past 30 days'},{value:'90',label:'Past 90 days'}],String(days))}${submit('Apply period')}</form><p class="muted">Updated ${date(s.generated_at)}. Order figures use the date an order was placed and its current status.</p><div class="metrics-grid">${['orders_placed','orders_completed_paid','completed_paid_value','new_users','pending_sellers','open_reports'].map(key=>`<article class="metric"><p>${metricLabels[key]}</p><strong>${valueFor(key,m[key])}</strong></article>`).join('')}</div><p class="form-note">Completed paid value is the value of sellers’ completed orders, not AquaMarket profit. The preceding ${days} days had ${m.previous_orders_placed} orders and ${money(m.previous_completed_paid_value)} in completed paid value.</p><section class="admin-section">${chart(s.daily)}<details class="analytics-details"><summary>View daily figures</summary>${table(['Date (UTC)','Orders placed','Completed paid value'],s.daily.map(d=>[esc(d.date),d.orders,money(d.value)]))}</details></section><section class="admin-section"><h2>Categories & stock</h2><p class="muted">Stock is current. Sold units and value cover completed paid orders placed in the selected period.</p>${table(['Category','Visible sale listings','Available units','Sold units','Completed paid value'],s.categories.map(c=>[esc(c.category),c.active_listings,c.available_units,c.sold_units,money(c.completed_paid_value)]))}<p>${m.out_of_stock_listings} visible sale listings are out of stock; ${m.low_stock_listings} have 1–3 units left. There are ${m.active_trade_listings} visible trade listings.</p></section><section class="admin-section ai-section"><div class="row-between"><div><h2>AI recommendations</h2><p class="muted">Use marketplace figures to identify actions worth reviewing.</p></div>${btn('Generate insights','generate-insights',ai.configured?'':'disabled')}</div><p class="form-note">Only aggregate counts and values are sent to Groq. Suggestions require your review and do not change marketplace records.</p><div id="ai-result" aria-live="polite">${ai.configured?'<p>Generate an analysis when you need it. Results are reused for up to 15 minutes.</p>':'<p class="notice">AI is not connected yet. Configure the Groq API key using the setup guide. Your analytics above remain available.</p>'}</div></section>`);
};
forms['analytics-period']=async f=>{days=Number(formData(f).days);const url=new URL(location.href);url.searchParams.set('days',days);history.replaceState(null,'',url);await pages['admin-analytics']();};
actions['generate-insights']=async el=>{
 el.disabled=true;el.textContent='Analyzing…';const target=$('#ai-result');target.textContent='Analyzing the selected period…';
 try{
  const result=await api('/admin/insights',{method:'POST',body:{days}});
  if(!target.isConnected)return;
  target.innerHTML=`<p class="ai-summary">${esc(result.summary)}</p><p class="muted">${result.source==='groq'?`AI generated ${date(result.generated_at)}${result.cached?' · Cached result':''}`:'No AI request was made.'} · Data snapshot: ${date(result.snapshot.generated_at)}</p><div class="ai-recommendations">${result.recommendations.map(r=>`<article class="ai-recommendation"><div class="row-between"><h3>${esc(r.title)}</h3><span class="ai-priority priority-${esc(r.priority)}">${esc(r.priority)} priority</span></div><p>${esc(r.observation)}</p><p><strong>Suggested action:</strong> ${esc(r.action)}</p><div class="ai-evidence">${r.evidence_keys.map(key=>`<span>${esc(metricLabels[key]||key)}: <strong>${esc(valueFor(key,result.snapshot.metrics[key]))}</strong></span>`).join('')}</div></article>`).join('')}</div>${result.limitations.length?`<div class="notice"><strong>Data limits</strong><ul>${result.limitations.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`:''}`;
 }catch(error){if(target.isConnected)target.innerHTML=`<p class="notice" role="alert">${esc(error.message)}</p>`;}
 finally{if(el.isConnected){el.disabled=false;el.textContent='Generate insights';}}
};
