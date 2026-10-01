import { cp, mkdir, rm } from 'node:fs/promises';

const dist = 'dist';
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await Promise.all([
  cp('src/index.html', `${dist}/index.html`),
  cp('src/styles.css', `${dist}/styles.css`),
  cp('src/app.js', `${dist}/app.js`),
]);
console.log('Built static site in dist/.');
