/**
 * add.ts — `devbox add`: register the current git repo as a claude-devbox project.
 *
 * Detects the project (origin remote → canonical SSH url, branch, name), targets a
 * profile, and either PREVIEWS the YAML snippet + the playbook command (default, and
 * whenever DEVBOX_DRYRUN is set) or — with --write — does a comment-preserving textual
 * insert into ansible/group_vars/all.yml under that profile's `projects:`.
 *
 * It NEVER runs the playbook: that has remote side effects and needs the operator /
 * Tailscale secrets, which aren't present on every client. The `/<prefix>-add-project`
 * slash command drives the playbook run (and the GitHub-access check) with confirmation.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Config, die, resolveProfile } from "./config";

/** Convert any git remote URL (https://, ssh://, scp-like git@host:path) to the
 *  canonical `git@host:owner/repo.git` form used in group_vars for private clones. */
export function toSshUrl(url: string): string {
  let u = url.trim();
  u = u.replace(/^[a-z+]+:\/\//i, ""); // scheme: https:// ssh:// git://
  u = u.replace(/^[^@/]*@/, ""); // user@  (only when it precedes the host, before any /)
  u = u.replace(/\.git$/i, "").replace(/\/+$/, "");
  const m = u.match(/^([^/:]+)[/:](.+)$/); // host <sep> path  (sep is ':' for scp-like, '/' otherwise)
  if (!m) die(`cannot parse git remote url: ${url}`);
  const host = m[1];
  const path = m[2].replace(/^\/+/, "").replace(/\/+$/, "");
  return `git@${host}:${path}.git`;
}

const git = (args: string[], cwd: string): string | null => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return r.status === 0 && r.stdout ? r.stdout.trim() : null;
};

export type Detected = { name: string; repo: string; branch: string };

/** Inspect the git repo at `cwd` (default: process.cwd()) to fill name/repo/branch. */
export function detectProject(opts: { name?: string; branch?: string; cwd?: string }): Detected {
  const cwd = opts.cwd ?? process.cwd();
  const top = git(["rev-parse", "--show-toplevel"], cwd);
  if (!top) die("not inside a git repository (run this from the project you want to add)");
  const origin = git(["remote", "get-url", "origin"], cwd);
  if (!origin) die("this repo has no 'origin' remote — add one, or pass the repo url by hand");
  const branch = opts.branch ?? git(["rev-parse", "--abbrev-ref", "HEAD"], cwd) ?? "main";
  const name = opts.name ?? top.split("/").pop()!;
  return { name, repo: toSshUrl(origin), branch };
}

/** The YAML block for one project, indented to match group_vars (6-space list items).
 *  Writes the FULL schema (install/update/ports) — a partial entry crashes the projects
 *  role, because a missing `update` key makes Jinja's `item.update` resolve to the dict's
 *  built-in .update() method instead of the value. Defaults mirror all.example.yml. */
export function projectEntry(d: Detected): string {
  return (
    `      - name: ${d.name}\n` +
    `        repo: "${d.repo}"\n` +
    `        branch: ${d.branch}\n` +
    `        install: true # run \`bun install\` after clone\n` +
    `        update: false # don't git-pull over Claude's local edits\n` +
    `        ports: []\n`
  );
}

/**
 * Insert `snippet` at the end of `user`'s `projects:` list in an all.yml `content`,
 * preserving every other line (comments included). Refuses (via die) if the profile
 * or its projects: block is missing, or a project of `name` already exists there.
 * Pure: returns the new content, touches no files.
 */
export function addProjectToYaml(content: string, user: string, snippet: string, name: string): string {
  const lines = content.split("\n");
  const cleaned = (s: string) => s.trim().replace(/^['"]|['"]$/g, "");

  // Locate the profile's `- user: <user>` list item.
  let i = -1;
  let userIndent = 2;
  for (let j = 0; j < lines.length; j++) {
    const m = lines[j].match(/^(\s*)-\s+user:\s*(.+?)\s*$/);
    if (m && cleaned(m[2]) === user) {
      i = j;
      userIndent = m[1].length;
      break;
    }
  }
  if (i < 0) die(`profile "${user}" not found in group_vars/all.yml`);

  // The profile block ends at the next `- user:` at the same indent (or EOF).
  let end = lines.length;
  for (let j = i + 1; j < lines.length; j++) {
    const m = lines[j].match(/^(\s*)-\s+user:/);
    if (m && m[1].length === userIndent) {
      end = j;
      break;
    }
  }

  // `projects:` is a mapping key inside the list item (indent = userIndent + 2).
  const keyIndent = userIndent + 2;
  let pj = -1;
  for (let j = i + 1; j < end; j++) {
    if (new RegExp(`^\\s{${keyIndent}}projects:\\s*$`).test(lines[j])) {
      pj = j;
      break;
    }
  }
  if (pj < 0) die(`profile "${user}" has no projects: block in group_vars/all.yml`);

  // The projects list runs until the next line (in-block) indented <= keyIndent.
  let pend = end;
  for (let j = pj + 1; j < end; j++) {
    if (lines[j].trim() === "") continue;
    const ind = lines[j].match(/^(\s*)/)![1].length;
    if (ind <= keyIndent) {
      pend = j;
      break;
    }
    const nm = lines[j].match(/^\s*-\s+name:\s*(.+?)\s*$/);
    if (nm && cleaned(nm[1]) === name) die(`profile "${user}" already has a project named "${name}"`);
  }

  const snippetLines = snippet.replace(/\n$/, "").split("\n");
  lines.splice(pend, 0, ...snippetLines);
  return lines.join("\n");
}

export type AddOpts = { name?: string; branch?: string; profile?: string; write?: boolean };

/** CLI entrypoint for `devbox add`. Preview unless --write (and never on DEVBOX_DRYRUN). */
export function runAdd(cfg: Config, opts: AddOpts) {
  const prof = resolveProfile(cfg, opts.profile);
  const d = detectProject(opts);
  const snippet = projectEntry(d);
  const repoForCmd = cfg.repoPath ?? "<claude-devbox-repo>";
  const playbookCmd = `cd ${repoForCmd}/ansible && ansible-playbook -i inventory.ini playbook.yml --tags projects`;

  const preview = !opts.write || !!process.env.DEVBOX_DRYRUN;
  if (preview) {
    const target = cfg.repoPath
      ? join(cfg.repoPath, "ansible", "group_vars", "all.yml")
      : "ansible/group_vars/all.yml  (repoPath not set — `--write` will fail until you re-run gen-editor-config.py --cli)";
    process.stdout.write(
      `Add project '${d.name}' to profile '${prof}'.\n\n` +
        `Would insert under that profile's projects: in\n  ${target}\n\n${snippet}\n` +
        `Then apply on the box:\n  ${playbookCmd}\n`,
    );
    return;
  }

  // --write: edit all.yml in place. Still does NOT run the playbook.
  if (!cfg.repoPath) die("config has no repoPath — re-run `gen-editor-config.py --cli` to record the repo location");
  const ymlPath = join(cfg.repoPath, "ansible", "group_vars", "all.yml");
  if (!existsSync(ymlPath)) die(`group_vars not found at ${ymlPath}`);
  const after = addProjectToYaml(readFileSync(ymlPath, "utf8"), prof, snippet, d.name);
  writeFileSync(ymlPath, after);
  process.stdout.write(
    `✓ added project '${d.name}' to profile '${prof}' in\n  ${ymlPath}\n\n` +
      `Now apply on the box:\n  ${playbookCmd}\n`,
  );
}
