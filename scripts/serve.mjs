#!/usr/bin/env node
// The search page, served from this clone: node scripts/serve.mjs [--port 5190]. Everything it shows is read from
// data/ and icons/ on disk; it makes no requests anywhere.
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const at = process.argv.indexOf('--port');
const PORT = at >= 0 ? Number(process.argv[at + 1]) : 5190;
const TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.tsv': 'text/tab-separated-values; charset=utf-8',
	'.png': 'image/png',
};
// Only these trees are served; anything else (the renderer, .work, .git) is a 404.
const SERVED = ['web', 'data', 'icons', 'scripts/filter-core.mjs'];

const server = http.createServer((req, res) =>
{
	let rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '');
	if (rel === '')
	{
		rel = 'web/index.html';
	}
	const file = path.join(ROOT, rel);
	const inside = SERVED.some(s => file === path.join(ROOT, s) || file.startsWith(path.join(ROOT, s) + path.sep));
	if (!inside || !fs.existsSync(file) || !fs.statSync(file).isFile())
	{
		res.writeHead(404).end('not found');
		return;
	}
	res.writeHead(200, {
		'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
		// Icons only change with a new release; let the browser keep them for the session.
		'Cache-Control': rel.startsWith('icons/') ? 'max-age=3600' : 'no-cache',
	});
	fs.createReadStream(file).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => console.log(`item search: http://localhost:${PORT}`));
