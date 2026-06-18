# Long-term memory (Hindsight)

## What it is

**Hindsight** is a long-term memory layer for Claude Code. The `hindsight` role
wires [Vectorize Hindsight](https://github.com/vectorize-io/hindsight) into each
profile so the agent remembers things across sessions — context from past work,
decisions made, patterns it noticed — without any manual note-taking.

The role is **on by default**. To opt a profile out entirely, set:

```yaml
hindsight_enabled: false
```

in `group_vars/all.yml` (or per-profile in the `profiles` list).

---

## How it works

Three pieces cooperate once provisioning runs:

1. **Recall hook (UserPromptSubmit)** — before each prompt, the plugin queries
   the memory bank and injects relevant snippets as context. The agent sees
   what's relevant before it replies.

2. **Retain hook (Stop, custom)** — after each session, `/usr/local/bin/hindsight-retain-tagged`
   runs. It calls the plugin's retain path and stamps every saved memory with
   three automatic tags (see [Memory model](#memory-model) below). The plugin's
   own auto-retain is disabled so retention fires exactly once, via this hook.

3. **`agent_knowledge_*` tools** — `enableKnowledgeTools: true` exposes a small
   set of MCP tools the agent can call directly during a session: create, search,
   and delete memories. Useful for explicit "remember this" or "forget that"
   instructions, or for filtered recall (e.g. query restricted to a single project).

Underneath all of this runs a **fully local daemon** (`uvx hindsight-embed`, the plugin's default port 9077), one per profile. It stores memories on disk and handles the embedding
work locally. **Only LLM extraction and recall calls leave the box** (to whichever
LLM provider you configure). The embeddings themselves never leave: remote
embeddings are not supported through this integration, and the daemon's default
local mode is the only one used.

---

## Networking & access

By default the daemon is **loopback-only** (`127.0.0.1`). It is reachable only
by the agent process running on the same box — not reachable from the network,
not exposed on Tailscale, not public in any way.

### Per-profile ports (`hindsight_base_port`)

Each profile gets its own daemon instance. To avoid port collisions when
multiple profiles coexist on one box, ports are allocated as
`base + profile_index`:

| Profile index | Default port |
| ------------- | ------------ |
| 0 (first)     | 9077         |
| 1 (second)    | 9078         |
| …             | …            |

The base is controlled by:

```yaml
hindsight_base_port: 9077   # default
```

A single-profile setup simply stays on `9077` and never notices the scheme.

### Optional Tailscale exposure (`hindsight_expose_tailscale`)

If you want to query or browse the memory daemon from another machine on your
**tailnet** (e.g. your laptop browsing memory from the devbox), set:

```yaml
hindsight_expose_tailscale: true
hindsight_serve_https_port: 9443    # default; HTTPS port = serve_port + index
```

When enabled, provisioning publishes each profile's loopback daemon through
**Tailscale Serve**:

```
https://<node>.<tailnet>.ts.net:(serve_port + index)  ->  127.0.0.1:(base + index)
```

so it's reachable over your tailnet **by hostname with a valid TLS cert**
(e.g. `https://devbox.tail1234.ts.net:9443`). Tailscale Serve is tailnet-gated by
Tailscale itself — the daemon stays bound to `127.0.0.1` and nothing is opened on
a public interface (no `0.0.0.0` bind, no firewall rule needed).

Access is therefore **tailnet-only** — it relies on the user's Tailscale ACLs
for fine-grained control. The daemon itself has no authentication layer;
security comes entirely from Tailscale Serve's tailnet gating and your ACL policy.

This option is **off by default** (`hindsight_expose_tailscale: false`).

---

## Memory model

Each profile gets **one profile-wide memory bank** (the `bankId` is the profile's
Linux username). It's intentionally not per-project: Hindsight is meant as a
personal-assistant layer that accumulates continuity across all your projects over
time, not an isolated per-conversation scratchpad. This mirrors how Verti
(verti-monorepo) uses Hindsight — a single user-scoped bank with tag-based
filtering rather than per-project silos.

Every retained memory is auto-tagged:

| Tag | Value | Purpose |
| --- | --- | --- |
| `source` | `claude-code` | identifies the origin system |
| `profile` | `<Linux username>` | which profile retained it |
| `project` | `<repo name>` | which repo (worktree-aware) |

These tags let you filter later using the `agent_knowledge_*` tools. For example,
to recall only memories from a specific repo you can ask the agent to search with
`project:<repo>`, or to see everything from your work profile, filter by
`profile:work`. The tools accept tag filters directly.

### Per-project isolation (escape hatch)

If you genuinely want a separate bank per project — sacrificing cross-project
continuity — set:

```yaml
hindsight_per_project: true
```

This switches the `bankId` to a per-project value and skips the custom tagging
hook. Default is `false`.

---

## Provider configuration

Hindsight needs an LLM for the extraction and recall steps. Configure it in
`group_vars/all.yml` via these knobs (they map to the `HINDSIGHT_API_LLM_*`
environment variables written to `~/.hindsight/llm.env`, mode 0600):

| Variable | Purpose |
| --- | --- |
| `hindsight_llm_provider` | Provider name: `openai`, `anthropic`, `gemini`, `groq`, `ollama`, `openrouter`, … |
| `hindsight_llm_api_key` | API key (required unless the provider is keyless or a `base_url` is set) |
| `hindsight_llm_model` | Model identifier, in the provider's format |
| `hindsight_llm_base_url` | Optional — custom OpenAI-compatible endpoint |

**Example — OpenRouter** (cheap, many models, one key):

```yaml
hindsight_llm_provider: openrouter
hindsight_llm_api_key: "sk-or-..."
hindsight_llm_model: "openai/gpt-oss-20b"
```

**Example — Ollama** (fully keyless, fully local):

```yaml
hindsight_llm_provider: ollama
hindsight_llm_base_url: "http://localhost:11434"
hindsight_llm_model: "llama3.2"
# hindsight_llm_api_key not needed
```

The playbook fails fast at provision time if `hindsight_enabled: true` but no
provider/key is configured (and there is no `base_url` to substitute) — better
to catch it early than have the daemon silently fail at runtime.

---

## Prerequisites

The daemon runs via `uvx`, so `uv` must be in your `runtimes` list:

```yaml
runtimes:
  uv: "latest"
  # ... other tools
```

If `uv` is absent the role will error during provisioning with a clear message.

---

## Tuning what gets remembered

By default the bank's missions are tightened to remember **important, durable things,
not everything** — they keep the user's preferences/conventions, project architecture,
final configuration state, and decisions (with rationale), and drop the dominant noise:
**skill/framework documentation** (brainstorming/plan/worktree/TDD/model-selection text
that gets injected into agent prompts and otherwise memorized + duplicated), git/commit/
branch/test/task-progress logs, transient errors, and per-session summaries.

These live in the role's `defaults/main.yml` and are overridable in `group_vars/all.yml`:

| Var | Applied via | Purpose |
|-----|-------------|---------|
| `hindsight_retain_mission` | `claude-code.json` (`retainMission`) — plugin sets it on first retain | what the extractor pulls from each conversation |
| `hindsight_bank_mission` | `claude-code.json` (`bankMission`) → bank `reflect_mission` | the bank's persona when surfacing memory |
| `hindsight_observations_mission` | daemon HTTP API (`PATCH …/config`), best-effort task | what consolidation turns into long-term observations; also enforces "one canonical fact" to fight TR/EN duplicate paraphrases |
| `hindsight_retain_every_n_turns` | `claude-code.json` (`retainEveryNTurns`) | how often a session flushes a retain (higher = fewer, less noisy writes) |

`observations_mission` isn't a plugin config key, so the role sets it directly on the
bank via the daemon API — a **best-effort** task that no-ops when the daemon is down
(provision time) and converges on any later run while a session is up. Hermes/Codex
clients have their own retain frequency; the **bank missions apply centrally** to every
client writing to the shared bank. Changing a mission affects **future** retains only —
existing memory stays until you prune or reset the bank.

---

## Verifying / troubleshooting

After provisioning, confirm the plugin is active for each profile:

```bash
sudo -u <user> env HOME=/home/<user> /home/<user>/.local/bin/claude plugin list
```

`hindsight-memory` should appear in the output and be listed as enabled.

If memories are being **saved** but never **recalled** (i.e. nothing is injected into context at the start of a prompt), the most likely cause is that the plugin is installed but not enabled — or the installed Claude Code version does not auto-load plugin hooks. Re-enable the plugin (`claude plugin enable hindsight-memory` as the profile user) or update Claude Code, then re-test.

The custom tagged retain hook (`/usr/local/bin/hindsight-retain-tagged`) is registered directly in `~/.claude/settings.json` and runs independently of plugin enablement. This means **saving can work even when recall doesn't** — which is the tell-tale sign of this issue: memories accumulate but are never surfaced.

---

## References

- [Vectorize Hindsight — GitHub](https://github.com/vectorize-io/hindsight)
- [Claude Code plugin marketplace](https://www.anthropic.com/claude-code)
- [Runtimes (mise) & isolation](runtimes.md) — how `uv` ends up on PATH
