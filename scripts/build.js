import { build } from 'esbuild';
await build({entryPoints:['client/main.js'],bundle:true,minify:true,sourcemap:false,format:'esm',target:['es2022'],outfile:'public/assets/js/bundle.js'});
console.log('Browser application built.');
