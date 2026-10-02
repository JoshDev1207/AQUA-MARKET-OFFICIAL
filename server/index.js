import {config,db,authClient,cloudinary} from './config.js';
import {createAquaServer} from './app.js';
import {createSharedBackend} from './shared.js';
const shared=await createSharedBackend(config);
const {http,io}=createAquaServer({config,db,authClient,cloudinary,shared});
http.listen(config.port,'0.0.0.0',()=>{
 console.log(`AquaMarket listening at ${config.appUrl}`);
 if(!config.dbReady)console.log('Setup needed: copy .env.example to .env, fill the credentials, and run the SQL migration. See SETUP.md.');
});
let stopping=false;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{
 if(stopping)return;stopping=true;
 // Close sockets first so the browser reconnects to a healthy instance.
 io.close(()=>{shared?.close();process.exit(0);});
 setTimeout(()=>{shared?.close();process.exit(1);},10000).unref();
});
