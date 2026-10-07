import { fixtureIds } from './fixtures';
import { toText, validFixturePath, type Workspace } from './workspace';

export type PathChange = { path: string; before?: Uint8Array; after?: Uint8Array };
export type AgentChange = PathChange & { related?: PathChange[] };
type ChangeWorkspace = Pick<Workspace, 'files' | 'fixtures' | 'write' | 'remove' | 'writeFixture' | 'removeFixture'>;

function sameBytes(a?: Uint8Array, b?: Uint8Array): boolean {
  return a && b ? a.length === b.length && a.every((byte, index) => byte === b[index]) : a === b;
}

export async function applyAgentChange(workspace: ChangeWorkspace, change: AgentChange): Promise<boolean> {
  const changes = [change, ...(change.related ?? [])];
  // Validate the complete group before writing any path. Production callers use
  // a WorkspaceWriter, so schema and data reach storage in one atomic commit.
  for (const item of changes) {
    if (item.path.endsWith('.dataset.json') && !item.before && item.after) {
      const name = JSON.parse(toText(item.after)).definition.name;
      if (fixtureIds(workspace.fixtures).includes(name) && !changes.some(c => c.before && /\.(csv|xlsx)$/.test(c.path))) throw new Error(`A fixture named ${name} already exists. Read it again.`);
    }
    const fixture = validFixturePath(item.path), current = (fixture ? workspace.fixtures : workspace.files).get(item.path);
    if (!sameBytes(current, item.before)) throw new Error(`${item.path} changed while the agent was editing it. Read it again before retrying.`);
    if (fixture && /\.(csv|xlsx)$/.test(item.path) && !item.before && item.after) {
      const alternate = item.path.replace(/\.(csv|xlsx)$/, item.path.endsWith('.csv') ? '.xlsx' : '.csv');
      if (workspace.fixtures.has(alternate)) throw new Error(`A fixture for ${item.path} already exists at ${alternate}. Read it and use write_table to update it.`);
    }
  }
  let changed = false;
  for (const item of changes) {
    if (sameBytes(item.before, item.after)) continue;
    const fixture = validFixturePath(item.path);
    if (item.after) { if (fixture) await workspace.writeFixture(item.path, item.after); else await workspace.write(item.path, item.after); }
    else { if (fixture) await workspace.removeFixture(item.path); else await workspace.remove(item.path); }
    changed = true;
  }
  return changed;
}
