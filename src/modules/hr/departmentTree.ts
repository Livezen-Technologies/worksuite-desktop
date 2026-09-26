/** Directory's departments as the HR screen lists them: a tree walked into a list. */
export interface Department {
  id: number;
  name: string;
  depth: number;
  code: string | null;
  parent_id: number | null;
  parent_name: string | null;
  org_id: number | null;
  org_name: string | null;
  manager_id: number | null;
  manager_name: string | null;
  status: string | null;
  members: number;
}

/**
 * Parents before children, each child under its parent: the tree as a list,
 * each row's `depth` being where it is drawn (the server's counts up a loop).
 */
export function inTreeOrder(list: Department[]): Department[] {
  const kids = new Map<number | null, Department[]>();
  const known = new Set(list.map((d) => d.id));
  for (const d of list) {
    const p = d.parent_id !== null && known.has(d.parent_id) ? d.parent_id : null;
    kids.set(p, [...(kids.get(p) ?? []), d]);
  }
  const out: Department[] = [];
  const walk = (p: number | null, seen: Set<number>, depth: number) => {
    for (const d of (kids.get(p) ?? []).sort((a, b) => a.name.localeCompare(b.name))) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      out.push({ ...d, depth });
      walk(d.id, seen, depth + 1);
    }
  };
  const seen = new Set<number>();
  walk(null, seen, 0);
  // One the walk never reaches (its parents loop, or it is its own parent) is
  // still a department: it goes at the top level rather than out of the list.
  for (const d of [...list].sort((a, b) => a.name.localeCompare(b.name))) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    out.push({ ...d, depth: 0 });
    walk(d.id, seen, 1);
  }
  return out;
}

/** The department and everything under it: none of these may become its parent. */
export function below(list: Department[], id: number): Set<number> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const d of list) {
      if (d.parent_id !== null && out.has(d.parent_id) && !out.has(d.id)) {
        out.add(d.id);
        grew = true;
      }
    }
  }
  return out;
}
