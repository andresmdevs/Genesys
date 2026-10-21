/**
 * Publishes `dist/` to the `gh-pages` branch, which is what GitHub Pages
 * serves. Run `npm run deploy`, which builds first.
 *
 * It works through a throwaway worktree so the branch never shares a checkout
 * with your source, and nothing in your working tree is touched.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = (args, cwd) =>
  execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' }).trim();

const repo = process.cwd();
if (!existsSync(join(repo, 'dist', 'index.html'))) {
  console.error('No hay nada que publicar: falta dist/index.html. Ejecuta npm run build.');
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), 'genesys-pages-'));
try {
  // Start from the published branch when it exists so history is kept.
  let based = false;
  try {
    run(['fetch', 'origin', 'gh-pages'], repo);
    run(['worktree', 'add', '--detach', work, 'origin/gh-pages'], repo);
    run(['checkout', '-B', 'gh-pages'], work);
    based = true;
  } catch {
    run(['worktree', 'add', '--orphan', '-b', 'gh-pages', work], repo);
  }

  // Replace the contents wholesale: `git rm` only removes tracked files, so
  // nothing outside the branch is ever at risk.
  if (based) {
    try {
      run(['rm', '-r', '--quiet', '.'], work);
    } catch {
      // An empty branch has nothing to remove.
    }
  }

  cpSync(join(repo, 'dist'), work, { recursive: true });
  // Without this, GitHub Pages hides files and folders that start with "_".
  writeFileSync(join(work, '.nojekyll'), '');

  run(['add', '-A'], work);
  const status = run(['status', '--porcelain'], work);
  if (!status) {
    console.log('El sitio publicado ya está al día.');
  } else {
    run(['commit', '-m', 'Publish the built site'], work);
    run(['push', '-u', 'origin', 'gh-pages'], work);
    console.log('Publicado. GitHub Pages tarda un minuto en servir la versión nueva.');
  }
} finally {
  try {
    run(['worktree', 'remove', '--force', work], repo);
  } catch {
    rmSync(work, { recursive: true, force: true });
  }
}
