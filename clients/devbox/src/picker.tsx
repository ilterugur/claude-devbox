import { MouseProvider, useOnMouseClick } from "@zenobius/ink-mouse";
import { Box, type DOMElement, render, Text, useInput } from "ink";
import React, { useEffect, useRef, useState } from "react";

export type PickResult = string | "__home__" | "__new__" | null;
export type PickProfile = { user: string; projects: string[] };

const CLAY = "#d77757"; // clawd's body orange (rgb 215,119,87) — Claude Code's accent
const MAX_ROWS = 12;
const ACTIONS = [
  { value: "__home__" as const, label: "open in HOME" },
  { value: "__new__" as const, label: "new project" },
];

/** Subsequence fuzzy match (e.g. "isc" matches "insurchat"). */
function fuzzy(label: string, query: string): boolean {
  const s = label.toLowerCase();
  const q = query.toLowerCase();
  let i = 0;
  for (const c of s) if (c === q[i]) i++;
  return i === q.length;
}

/** clawd — Claude Code's own mascot, block art straight from the CLI, lightly animated:
 *  mostly idle, with the odd glance left/right and an arms-up wave. Drawn in clawd's
 *  orange with NO background fill, so it blends into a dark terminal (a fill shows up as
 *  a grey box on themes that map ANSI "black" to grey). Every pose is 9 cells × 3 rows
 *  so nothing jitters between frames. */
const POSES: Record<string, [string, string, string]> = {
  idle: [" ▐▛███▜▌ ", "▝▜█████▛▘", "  ▘▘ ▝▝  "],
  left: [" ▐▟███▟▌ ", "▝▜█████▛▘", "  ▘▘ ▝▝  "],
  right: [" ▐▙███▙▌ ", "▝▜█████▛▘", "  ▘▘ ▝▝  "],
  wave: ["▗▟▛███▜▙▖", " ▜█████▛ ", "  ▘▘ ▝▝  "],
};
// Frame timeline (one entry per tick): mostly idle, with occasional motion.
const FRAMES = ["idle", "idle", "idle", "idle", "idle", "left", "idle", "idle", "right", "idle", "idle", "idle", "idle", "wave", "idle", "idle"];

function Mascot() {
  const [f, setF] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setF((n) => (n + 1) % FRAMES.length), 450);
    return () => clearInterval(t);
  }, []);
  return (
    <Box flexDirection="column" marginRight={2}>
      {POSES[FRAMES[f]].map((line, i) => (
        <Text key={i} color={CLAY}>
          {line}
        </Text>
      ))}
    </Box>
  );
}

/** Ink's useInput also receives raw mouse-report bytes (ink-mouse parses them for
 *  hover/click, but Ink still hands the same data to useInput). Detect those so they
 *  never land in the filter — SGR mouse: ESC[<b;x;y(M|m); legacy X10: ESC[M… */
function looksLikeMouse(s: string): boolean {
  return s.includes("\x1b") || s.includes("[<") || s.includes("[M") || /<?\d+;\d+;\d+[Mm]/.test(s);
}

/** A clickable row — click via ink-mouse; the selection highlight is keyboard-driven
 *  (arrows). Hover/mouse-motion was dropped on purpose: Warp doesn't deliver motion
 *  events reliably, and click + keyboard cover everything. Each row is its own component
 *  so the click hook stays stable across filtering (rules of hooks). */
function Row({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  const ref = useRef<DOMElement>(null) as React.RefObject<DOMElement>;
  useOnMouseClick(ref, (c) => c && onClick());
  return (
    <Box ref={ref}>
      <Text color={active ? CLAY : undefined} bold={active}>
        {active ? "❯ " : "  "}
        {label}
      </Text>
    </Box>
  );
}

function Picker({
  profiles,
  active,
  onDone,
}: {
  profiles: PickProfile[];
  active: string;
  onDone: (profile: string, r: PickResult) => void;
}) {
  const start = Math.max(0, profiles.findIndex((p) => p.user === active));
  const [pIdx, setPIdx] = useState(start);
  const [query, setQuery] = useState("");
  const [pane, setPane] = useState<0 | 1>(0); // 0 = projects, 1 = actions
  const [row, setRow] = useState(0);
  const [aRow, setARow] = useState(0);

  const profile = profiles[pIdx]?.user ?? active;
  const projects = profiles[pIdx]?.projects ?? [];
  const filtered = query ? projects.filter((p) => fuzzy(p, query)) : projects;
  const sel = Math.max(0, Math.min(row, filtered.length - 1));

  const cycleProfile = () => {
    if (profiles.length < 2) return;
    setPIdx((i) => (i + 1) % profiles.length);
    setQuery("");
    setRow(0);
    setPane(0);
  };

  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === "c")) return onDone(profile, null);
    if (key.ctrl && input === "p") return cycleProfile();
    if (key.tab || key.leftArrow || key.rightArrow) return setPane((p) => (p === 0 ? 1 : 0));
    if (key.upArrow) return pane === 0 ? setRow(Math.max(0, sel - 1)) : setARow((i) => Math.max(0, i - 1));
    if (key.downArrow)
      return pane === 0 ? setRow(Math.min(filtered.length - 1, sel + 1)) : setARow((i) => Math.min(ACTIONS.length - 1, i + 1));
    if (key.return) {
      if (pane === 1) return onDone(profile, ACTIONS[aRow].value);
      if (filtered[sel]) return onDone(profile, filtered[sel]);
      return;
    }
    if (key.backspace || key.delete) {
      setQuery((q) => q.slice(0, -1));
      setRow(0);
      setPane(0);
      return;
    }
    if (input && !key.ctrl && !key.meta && !key.tab && !looksLikeMouse(input)) {
      setQuery((q) => q + input);
      setRow(0);
      setPane(0);
    }
  });

  const profRef = useRef<DOMElement>(null) as React.RefObject<DOMElement>;
  useOnMouseClick(profRef, (c) => c && cycleProfile());
  const shown = filtered.slice(0, MAX_ROWS);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Mascot />
        <Box flexDirection="column">
          <Text>
            <Text bold color={CLAY}>
              devbox
            </Text>
            <Text dimColor>{"  ·  remote dev"}</Text>
          </Text>
          <Box ref={profRef}>
            <Text dimColor>profile </Text>
            <Text color={CLAY}>{profile}</Text>
            {profiles.length > 1 && <Text dimColor>{`  (${pIdx + 1}/${profiles.length} · click or ⌃p)`}</Text>}
          </Box>
        </Box>
      </Box>

      <Box>
        <Box flexDirection="column" width="60%" borderStyle="round" borderColor={pane === 0 ? CLAY : "gray"} paddingX={1}>
          <Text dimColor>
            projects{"  "}
            {query ? <Text color={CLAY}>/{query}</Text> : <Text dimColor>type to filter</Text>}
          </Text>
          {shown.length === 0 ? (
            <Text dimColor>{"  — no match —"}</Text>
          ) : (
            shown.map((p, i) => (
              <Row key={p} label={p} active={pane === 0 && i === sel} onClick={() => onDone(profile, p)} />
            ))
          )}
          {filtered.length > MAX_ROWS && <Text dimColor>{`  …${filtered.length - MAX_ROWS} more`}</Text>}
        </Box>

        <Box flexDirection="column" borderStyle="round" borderColor={pane === 1 ? CLAY : "gray"} paddingX={1} marginLeft={1}>
          <Text dimColor>actions</Text>
          {ACTIONS.map((a, i) => (
            <Row key={a.value} label={a.label} active={pane === 1 && i === aRow} onClick={() => onDone(profile, a.value)} />
          ))}
        </Box>
      </Box>

      <Box paddingX={1}>
        <Text dimColor>
          {"↑↓ move · ⇄ tab · ↵/click open"}
          {profiles.length > 1 ? " · ⌃p profile" : ""}
          {" · esc quit"}
        </Text>
      </Box>
    </Box>
  );
}

/** Two-pane, mouse-clickable picker. Resolves with the (possibly switched) profile + choice. */
export function pickUI(profiles: PickProfile[], active: string): Promise<{ profile: string; result: PickResult }> {
  return new Promise((resolve) => {
    const app = render(
      <MouseProvider>
        <Picker
          profiles={profiles}
          active={active}
          onDone={(profile, result) => {
            app.unmount();
            resolve({ profile, result });
          }}
        />
      </MouseProvider>,
    );
  });
}
