// Issue conventions shared by the server's scheduler and the client's whiteboard.

/** The specialty an issue is routed to, from its swarm:<specialty> label ('' = anyone). */
export function issueSpecialty(labels: string[]) {
  const l = labels.find((x) => /^swarm:/i.test(x) && !/^swarm:skip$/i.test(x));
  return l ? l.slice(6).toLowerCase() : '';
}

/** Open issues this issue waits for, from "Depends on #3" / "Blocked by #4, #5" in its body. */
export function blockers(body: string, open: Set<number>) {
  const out = new Set<number>();
  for (const m of (body ?? '').matchAll(/\b(?:depends\s+on|blocked\s+by)\s*:?\s*((?:#\d+(?:\s*(?:,|and|&)\s*)?)+)/gi)) {
    for (const n of m[1].matchAll(/#(\d+)/g)) if (open.has(Number(n[1]))) out.add(Number(n[1]));
  }
  return [...out];
}
