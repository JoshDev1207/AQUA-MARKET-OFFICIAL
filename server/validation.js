import { z } from 'zod';
export const uuid = z.uuid();
export const username = z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,30}$/, 'Use 3–30 letters, numbers, or underscores.');
export const password = z.string().min(10).max(128);
const text = (min,max) => z.string().trim().min(min).max(max);
export const schemas = {
 login: z.object({identifier:text(3,254),password:z.string().min(1).max(128)}).strict(),
 register: z.object({username,full_name:text(2,100),email:z.email().max(254),password}).strict(),
 verifyEmail:z.object({email:z.email().max(254).transform(v=>v.toLowerCase()),token:z.string().trim().regex(/^\d{6}$/,'Enter the six-digit email code.')}).strict(),
 resendEmail:z.object({email:z.email().max(254).transform(v=>v.toLowerCase())}).strict(),
 profile: z.object({username,full_name:text(2,100),phone:text(0,30),address:text(0,500),location:text(0,150),bio:text(0,2000),avatar_id:uuid.nullable()}).strict(),
 seller: z.object({store_name:text(3,100),seller_type:z.enum(['Hobbyist','Vendor','Breeder/Trader']),location:text(3,150),bio:text(10,2000)}).strict(),
 listing: z.object({kind:z.enum(['sale','trade']),title:text(3,120),description:text(10,5000),category:z.enum(['Fish','Plants','Aquariums','Equipment','Food','Other']),species:text(0,100),location:text(3,150),price:z.number().min(0).max(99999999).multipleOf(.01),stock:z.number().int().min(0).max(100000),trade_preference:text(0,1000),status:z.enum(['active','draft','archived']),image_ids:z.array(uuid).min(1).max(6)}).strict().refine(x=>x.kind!=='trade'||x.trade_preference.length>=3,{message:'Describe the trade you want.',path:['trade_preference']}),
 cart:z.object({listing_id:uuid,quantity:z.number().int().min(0).max(1000)}).strict(),
 checkout:z.object({request_key:uuid,info:z.object({recipient:text(2,100),phone:text(7,30),address:text(5,500),arrangement:z.enum(['Meet-up','Delivery']),payment_method:z.enum(['Cash on delivery','Cash on meet-up','GCash (manual)','Maya (manual)'])}).strict(),reviewed:z.array(z.object({id:uuid,quantity:z.number().int().positive(),price:z.number().nonnegative()}).strict()).min(1).max(100)}).strict(),
 order:z.object({action:z.enum(['confirmed','shipped','completed','cancelled','paid','refunded']),reference:text(0,200).default('')}).strict(),
 trade:z.object({wanted:uuid,offered:uuid,note:text(0,1000)}).strict(),
 tradeChange:z.object({action:z.enum(['accepted','declined','cancelled','completed'])}).strict(),
 message:z.object({conversation_id:uuid,client_id:uuid,body:text(0,5000),media_id:uuid.nullable().default(null)}).strict().refine(x=>x.body.length||x.media_id,{message:'Write a message or attach a photo.'}),
 review:z.object({listing_id:uuid,order_id:uuid,rating:z.number().int().min(1).max(5),body:text(3,2000),media_id:uuid.nullable().default(null)}).strict(),
 report:z.object({target_type:z.enum(['listing','seller','order','support']),target_id:uuid.nullable(),reason:text(3,120),details:text(5,3000)}).strict(),
 announcement:z.object({title:text(3,120),body:text(3,3000),media_id:uuid.nullable(),published:z.boolean()}).strict()
};
export class AppError extends Error { constructor(status,message){super(message);this.status=status;} }
export function requireMember(c,userId) {if(!c||![c.user_a,c.user_b].includes(userId))throw new AppError(404,'Conversation not found.');return c;}
export function sameOrigin(origin,appUrl){return !origin||origin===new URL(appUrl).origin;}
