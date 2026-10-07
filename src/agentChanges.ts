import { validFixturePath, type Workspace } from './workspace';

export type AgentChange = { path: string; before?: Uint8Array; after?: Uint8Array };
type ChangeWorkspace = Pick<Workspace, 'files' | 'fixtures' | 'write' | 'remove' | 'writeFixture' | 'removeFixture'>;

function sameBytes(a?: Uint8Array, b?: Uint8Array): boolean {
  return a && b ? a.length === b.length && a.every((byte, index) => byte === b[index]) : a === b;
}

export async function applyAgentChange(workspace: ChangeWorkspace, change: AgentChange): Promise<boolean> {
  const fixture = validFixturePath(change.path);
  const current = (fixture ? workspace.fixtures : workspace.files).get(change.path);
  if (!sameBytes(current, change.before)) throw new Error(`${change.path} changed while the agent was editing it. Read it again before retrying.`);
  if (sameBytes(current, change.after)) return false;
  if (fixture && !change.before && change.after) {
    const alternate = change.path.endsWith('.csv') ? change.path.slice(0, -4) + '.xlsx' : change.path.slice(0, -5) + '.csv';
    if (workspace.fixtures.has(alternate)) throw new Error(`A fixture for ${change.path} already exists at ${alternate}. Read it and use write_table to update it.`);
  }
  if (change.after) {
    if (fixture) await workspace.writeFixture(change.path, change.after);
    else await workspace.write(change.path, change.after);
  } else {
    if (fixture) await workspace.removeFixture(change.path);
    else await workspace.remove(change.path);
  }
  return true;
}
