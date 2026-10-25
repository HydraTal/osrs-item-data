#!/usr/bin/env node
// Releases code from the private working repo to the public one as a single commit, the way combo-tags releases do.
//
// The public repo maintains icons/ and data/ itself (.github/workflows/update.yml), so the release commit is this
// clone's tree with those two directories taken from the public main instead: whatever data this clone happens to
// hold, stale or edited, never reaches it. Everything else (rules, filters, the search page, the build) is this
// clone's. A release that changes scripts/rules.mjs makes the public repo re-run the classification and release new
// categories on its own.
//
//   node scripts/release-code.mjs -m "Filters: split CONSUMABLE"          dry run: show what the commit would change
//   node scripts/release-code.mjs -m "Filters: split CONSUMABLE" --push   make it and push it to the public main
//   node scripts/release-code.mjs --sync-data                             copy the public icons/ and data/ here
//
// Remotes: `origin` is the public repo, `dev` this private one (pushDefault), as in combo-tags.
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = 'origin';
const MAINTAINED = ['icons', 'data']; // the public repo's own

const args = process.argv.slice(2);
const option = name =>
{
	const at = args.indexOf(name);
	return at >= 0 ? args[at + 1] : undefined;
};

function git(gitArgs, env = {})
{
	const res = spawnSync('git', gitArgs, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 });
	if (res.status !== 0)
	{
		throw new Error(`git ${gitArgs.join(' ')}: ${(res.stderr || '').trim()}`);
	}
	return res.stdout.trim();
}

function tryGit(gitArgs)
{
	const res = spawnSync('git', gitArgs, { cwd: ROOT, encoding: 'utf8' });
	return res.status === 0 ? res.stdout.trim() : null;
}

function main()
{
	git(['fetch', '-q', PUBLIC]);
	const base = tryGit(['rev-parse', '--verify', '-q', `${PUBLIC}/main`]);

	if (args.includes('--sync-data'))
	{
		if (!base)
		{
			throw new Error(`${PUBLIC} has no main yet; nothing to sync`);
		}
		git(['checkout', `${PUBLIC}/main`, '--', ...MAINTAINED]);
		// Drop icons the public repo no longer has (an item removed by a game update).
		const kept = new Set(git(['ls-tree', '-r', '--name-only', `${PUBLIC}/main`, '--', 'icons']).split('\n'));
		const stale = git(['ls-files', '--', 'icons']).split('\n').filter(f => f && !kept.has(f));
		if (stale.length)
		{
			git(['rm', '-q', '--', ...stale]);
		}
		console.log(`icons/ and data/ now match ${PUBLIC}/main (${base.slice(0, 7)})${stale.length ? `; removed ${stale.length} icons` : ''}. Commit them here when you're ready.`);
		return;
	}

	const message = option('-m');
	if (!message)
	{
		throw new Error('give the release a message: -m "..."');
	}
	if (git(['status', '--porcelain', '--untracked-files=no']))
	{
		throw new Error('commit or set aside your changes first; the release is cut from HEAD');
	}

	// Build the tree in a scratch index: HEAD's tree, with the maintained directories swapped for the public ones.
	const index = path.join(ROOT, '.git', 'release-code.index');
	const env = { GIT_INDEX_FILE: index };
	fs.rmSync(index, { force: true });
	try
	{
		git(['read-tree', 'HEAD'], env);
		if (base)
		{
			git(['rm', '-r', '-q', '--cached', '--ignore-unmatch', '--', ...MAINTAINED], env);
			for (const dir of MAINTAINED)
			{
				if (tryGit(['rev-parse', '--verify', '-q', `${base}:${dir}`]))
				{
					git(['read-tree', `--prefix=${dir}/`, `${base}:${dir}`], env);
				}
			}
		}
		const tree = git(['write-tree'], env);
		if (base && tree === git(['rev-parse', `${base}^{tree}`]))
		{
			console.log(`Nothing to release: ${PUBLIC}/main already has this code.`);
			return;
		}
		const commit = git(['commit-tree', tree, ...(base ? ['-p', base] : []), '-m', message]);
		const stat = base ? git(['diff', '--stat', base, commit]) : '(the public repo\'s first commit, seeded with this clone\'s data)';
		console.log(stat);
		const rules = base && git(['diff', '--name-only', base, commit, '--', 'scripts/rules.mjs']);
		if (rules)
		{
			console.log('\nscripts/rules.mjs changed: the public repo will re-run the classification and release new categories.');
		}
		if (!args.includes('--push'))
		{
			console.log(`\nDry run. Commit ${commit.slice(0, 7)} is built but not pushed; add --push to publish it.`);
			return;
		}
		git(['push', '-q', PUBLIC, `${commit}:refs/heads/main`]);
		console.log(`\nPushed ${commit.slice(0, 7)} to ${PUBLIC}/main.`);
	}
	finally
	{
		fs.rmSync(index, { force: true });
	}
}

try
{
	main();
}
catch (err)
{
	console.error(err.message);
	process.exit(1);
}
