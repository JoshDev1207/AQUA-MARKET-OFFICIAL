import {config,db} from '../server/config.js';
const username=process.argv[2]?.toLowerCase();
if(!config.dbReady||!username){console.error('Usage: npm run admin -- your_username (configure .env first)');process.exit(1);}
const {data,error}=await db.from('profiles').update({role:'admin',seller_status:'approved'}).eq('username',username).select('id,username').single();
if(error){console.error('Account not found or database unavailable. Register and confirm your account first.');process.exit(1);}
console.log(`Administrator access granted to ${data.username}. Sign out and sign in again.`);
