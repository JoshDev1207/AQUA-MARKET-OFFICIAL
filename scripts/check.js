import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
for (const dir of ['server','client','scripts','tests']) {
 for (const name of await readdir(dir)) {
  if (!name.endsWith('.js')) continue;
  const r=spawnSync(process.execPath,['--check',`${dir}/${name}`],{stdio:'inherit'});
  if(r.status) process.exit(r.status);
 }
}
console.log('JavaScript syntax checked.');
