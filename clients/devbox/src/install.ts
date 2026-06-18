/**
 * Client-side transport installer. The box side (etserver / mosh) is provisioned by
 * Ansible, but the matching CLIENT binary (`et` / `mosh`) is a local prerequisite that
 * nothing installed automatically. When `devbox` wants a transport that's missing, it
 * notifies, asks for confirmation, and installs it with the platform's package manager.
 *
 * Coverage: mosh installs cleanly everywhere (brew + every major Linux pkg manager).
 * et installs via brew (macOS / Linuxbrew) and the Ubuntu/Debian PPA; for the messier
 * cases (Arch AUR, Fedora copr) we print the exact manual command instead of half-doing
 * it. Either way, on decline / unsupported / failure we return false and the caller
 * falls back to ssh — never leaving you stuck.
 */
import { spawnSync } from "node:child_process";

type Tool = "et" | "mosh";

const has = (bin: string): boolean =>
  spawnSync("sh", ["-c", `command -v ${bin}`], { stdio: "ignore" }).status === 0;

/** The auto-install command for `tool` on this machine, or null if we won't auto-do it. */
function installPlan(tool: Tool): { cmd: string[]; via: string } | null {
  const brew = has("brew");
  if (brew) return { cmd: ["brew", "install", tool], via: "brew" };
  if (tool === "mosh") {
    // mosh is a plain package in every major distro repo.
    if (has("apt-get")) return { cmd: ["sudo", "apt-get", "install", "-y", "mosh"], via: "apt" };
    if (has("dnf")) return { cmd: ["sudo", "dnf", "install", "-y", "mosh"], via: "dnf" };
    if (has("pacman")) return { cmd: ["sudo", "pacman", "-S", "--noconfirm", "mosh"], via: "pacman" };
    if (has("zypper")) return { cmd: ["sudo", "zypper", "install", "-y", "mosh"], via: "zypper" };
    return null;
  }
  // et: only Ubuntu/Debian has a clean non-brew path (the maintainer's PPA).
  if (has("apt-get")) {
    return {
      cmd: ["sh", "-c", "sudo add-apt-repository -y ppa:jgmath2000/et && sudo apt-get update && sudo apt-get install -y et"],
      via: "apt (PPA)",
    };
  }
  return null;
}

/** Exact manual install instruction for `tool`, shown when we can't (or won't) auto-install. */
function manualHint(tool: Tool): string {
  if (process.platform === "darwin") return `brew install ${tool}`;
  if (tool === "mosh") return "install 'mosh' with your package manager (apt/dnf/pacman/zypper) or brew";
  return "see https://eternalterminal.dev/download/ — Ubuntu PPA, Arch AUR, Fedora copr, or Linuxbrew (brew install et)";
}

/**
 * Ensure `tool` is available on this client, prompting before installing. Returns true if
 * it's installed (already, or after a confirmed+successful install), false otherwise — in
 * which case the caller should fall back to ssh.
 */
export function ensureClientTransport(tool: Tool): boolean {
  if (has(tool)) return true;
  const plan = installPlan(tool);
  process.stderr.write(`\ndevbox: '${tool}' is not installed on this client.\n`);
  if (!plan) {
    process.stderr.write(`  install it manually: ${manualHint(tool)}\n  → falling back to ssh for now.\n\n`);
    return false;
  }
  const ans = (globalThis.prompt(`  Install '${tool}' now via ${plan.via}? [Y/n]`, "Y") ?? "").trim();
  if (/^n/i.test(ans)) {
    process.stderr.write(`  skipped. Manual: ${manualHint(tool)}\n  → falling back to ssh.\n\n`);
    return false;
  }
  process.stderr.write(`  running: ${plan.cmd.join(" ")}\n`);
  const r = spawnSync(plan.cmd[0]!, plan.cmd.slice(1), { stdio: "inherit" });
  if (r.status === 0 && has(tool)) {
    process.stderr.write(`  ✓ '${tool}' installed.\n\n`);
    return true;
  }
  process.stderr.write(`  install did not complete — falling back to ssh. Manual: ${manualHint(tool)}\n\n`);
  return false;
}
