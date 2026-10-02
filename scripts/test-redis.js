import {spawnSync} from 'node:child_process';
if(!process.env.TEST_REDIS_URL){console.error('Set TEST_REDIS_URL to a disposable test Redis database, then run npm run test:redis. Never use production Redis.');process.exit(1);}
const result=spawnSync(process.execPath,['--test','tests/redis.test.js'],{stdio:'inherit',env:process.env});
process.exit(result.status??1);
