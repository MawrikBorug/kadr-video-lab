import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('backend-public',{recursive:true});
await writeFile('backend-public/index.html','<!doctype html><meta charset="utf-8"><title>KADR private adapter</title><p>Private API adapter. The video lab remains on GitHub Pages.</p>');
