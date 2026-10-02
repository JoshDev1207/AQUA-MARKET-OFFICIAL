import { z } from 'zod';
import { createHash, randomUUID } from 'node:crypto';
import { AppError } from './validation.js';

export const periods = z.union([z.literal(7), z.literal(30), z.literal(90)]);
export const metricLabels = {
  total_users: 'Total users', new_users: 'New users', active_sellers: 'Active approved sellers',
  pending_sellers: 'Pending seller applications', active_sale_listings: 'Visible sale listings',
  active_trade_listings: 'Visible trade listings', out_of_stock_listings: 'Out-of-stock listings',
  low_stock_listings: 'Listings with 1–3 units', orders_placed: 'Orders placed',
  orders_completed_paid: 'Completed paid orders', completed_paid_value: 'Completed paid order value (PHP)',
  orders_cancelled: 'Cancelled orders', orders_pending: 'Pending orders',
  previous_orders_placed: 'Orders placed in preceding period',
  previous_completed_paid_value: 'Completed paid value in preceding period (PHP)',
  open_reports: 'Open support reports', trades_completed: 'Completed trades'
};
const metricNames = Object.keys(metricLabels);
const nonnegative = z.number().finite().nonnegative();
const timestamp = z.string().refine(value => Number.isFinite(Date.parse(value)));
const category = z.enum(['Fish','Plants','Aquariums','Equipment','Food','Other']);
// Explicit projection prevents personal data or free-text user content from
// entering an AI prompt even if the database function gains fields later.
export const snapshotSchema = z.object({
  period_days: periods, generated_at: timestamp, window_start: timestamp, window_end: timestamp,
  currency: z.literal('PHP'),
  metrics: z.object(Object.fromEntries(metricNames.map(key => [key, nonnegative]))),
  daily: z.array(z.object({ date:z.iso.date(), orders:nonnegative, value:nonnegative })).max(92),
  categories: z.array(z.object({ category, active_listings:nonnegative, available_units:nonnegative, sold_units:nonnegative, completed_paid_value:nonnegative })).max(6)
});
const resultSchema = z.object({
  summary: z.string().min(1).max(1500),
  recommendations: z.array(z.object({
    title:z.string().min(1).max(120), observation:z.string().min(1).max(800),
    action:z.string().min(1).max(800), priority:z.enum(['high','medium','low']),
    evidence_keys:z.array(z.enum(metricNames)).min(1).max(4)
  }).strict()).max(5),
  limitations:z.array(z.string().min(1).max(400)).max(4)
}).strict();
const jsonSchema = {
  type:'object', additionalProperties:false, required:['summary','recommendations','limitations'],
  properties:{
    summary:{type:'string'},
    recommendations:{type:'array',items:{type:'object',additionalProperties:false,
      required:['title','observation','action','priority','evidence_keys'],properties:{
        title:{type:'string'},observation:{type:'string'},action:{type:'string'},
        priority:{type:'string',enum:['high','medium','low']},
        evidence_keys:{type:'array',items:{type:'string',enum:metricNames}}
      }}},
    limitations:{type:'array',items:{type:'string'}}
  }
};
const systemPrompt = `You help the administrator of AquaMarket, an aquarium marketplace.
Use only the supplied numeric aggregates. Recommend practical actions the admin can review.
Do not invent users, products, sales, demand forecasts, causes, conversion rates, or profit.
Order figures use the order creation date and its current status; value includes only completed paid orders and is not platform revenue or profit.
Stock and application/report counts are current snapshots, not historical trends. Zero previous value cannot support percentage growth.
No recommendations to automatically change prices, stock, approvals, or accounts. You have no tools.
Return the required JSON with a short summary, at most 5 recommendations, and at most 4 data limitations.
Each recommendation must name 1–4 actual metric keys as evidence. Keep each text field under 600 characters.
Say when the sample is too small. Never treat historical order counts as guaranteed future demand.`;

export function createInsightService({config, shared=null, fetchImpl=fetch}) {
  const cache = new Map(), locks = new Set();
  const read = async key => shared ? shared.getJson(key) : (cache.get(key)?.expires > Date.now() ? cache.get(key).value : null);
  const save = async (key,value) => shared ? shared.setJson(key,value,900) : cache.set(key,{value,expires:Date.now()+900_000});
  return {
    async generate(rawSnapshot) {
      const snapshot=snapshotSchema.parse(rawSnapshot);
      const m=snapshot.metrics;
      if (!(m.orders_placed+m.active_sale_listings+m.active_trade_listings+m.pending_sellers+m.open_reports)) {
        return {source:'insufficient-data',cached:false,snapshot,generated_at:new Date().toISOString(),
          summary:'There is not enough marketplace activity to generate useful AI recommendations yet.',
          recommendations:[],limitations:['Add real sellers, listings and transactions before drawing demand or sales conclusions.']};
      }
      if (!config.aiReady) throw new AppError(503,'AI insights are not configured. Add GROQ_API_KEY in the server environment.');
      const key='ai:v1:'+createHash('sha256').update(config.groqModel+':'+snapshot.period_days).digest('hex');
      const hit=await read(key);
      if(hit)return {...hit,cached:true};
      const token=randomUUID();
      const acquired=shared?await shared.acquire(key,token,45_000):!locks.has(key);
      if(!acquired)throw new AppError(409,'An analysis is already being generated. Please try again shortly.');
      locks.add(key);
      try {
        const secondHit=await read(key);if(secondHit)return {...secondHit,cached:true};
        const strictModels=['openai/gpt-oss-20b','openai/gpt-oss-120b','qwen/qwen3.8-27b'];
        const format=strictModels.includes(config.groqModel)
          ? {type:'json_schema',json_schema:{name:'aquamarket_admin_insights',strict:true,schema:jsonSchema}}
          : {type:'json_object'};
        let response;
        try {
          response=await fetchImpl('https://api.groq.com/openai/v1/chat/completions',{
            method:'POST',headers:{Authorization:'Bearer '+config.groqKey,'Content-Type':'application/json'},
            signal:AbortSignal.timeout(25_000),body:JSON.stringify({
              model:config.groqModel,temperature:0.2,max_completion_tokens:2500,response_format:format,
              messages:[{role:'system',content:systemPrompt+'\nJSON schema: '+JSON.stringify(jsonSchema)},
                {role:'user',content:JSON.stringify({metric_definitions:metricLabels,marketplace:snapshot})}]
            })
          });
        } catch { throw new AppError(504,'AI analysis timed out or could not connect. Your dashboard data is still available.'); }
        if(response.status===429)throw new AppError(429,'Groq’s usage limit was reached. Wait before generating another analysis.');
        if([401,403].includes(response.status))throw new AppError(503,'Groq could not authorize this request. Check the server API key and model access.');
        if(!response.ok)throw new AppError(502,'Groq could not generate this analysis. Check model availability or try again later.');
        let result;
        try {
          const payload=await response.json();
          if(payload.choices?.[0]?.finish_reason!=='stop')throw Error('Incomplete response');
          result=resultSchema.parse(JSON.parse(payload.choices[0].message.content));
        } catch { throw new AppError(502,'AI returned an incomplete analysis. Please try again.'); }
        const value={...result,source:'groq',model:config.groqModel,generated_at:new Date().toISOString(),snapshot};
        await save(key,value);
        return {...value,cached:false};
      } finally {
        locks.delete(key);
        if(shared)await shared.release(key,token).catch(()=>{});
      }
    }
  };
}
