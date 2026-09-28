import { describe, expect, it } from 'vitest';
import { normalizeSession, Stage, toBytes, validProjectPath } from './workspace';

describe('studio workspace boundaries', () => {
  it('migrates the original single chat into a named chat without losing its history', () => {
    const old = { chat: [{ id: 'one', role: 'user' as const, text: 'Make the page blue', time: '2026-01-01T00:00:00.000Z' }], tools: [], agentMessages: [{ role: 'user', content: 'Make the page blue' }], modelId: 'openai/gpt-6-luna' };
    const saved = normalizeSession(old);
    expect(saved.chats).toHaveLength(1);
    expect(saved.chats[0]).toMatchObject({ title: 'Make the page blue', chat: old.chat, agentMessages: old.agentMessages, modelId: old.modelId });
    expect(saved.activeChatId).toBe(saved.chats[0].id);
  });

  it('keeps studio fixtures out of project file tools while tracking fixture changes', () => {
    const fixturePath = 'fixtures/todos.csv';
    expect(validProjectPath(fixturePath)).toBe(false);
    const stage = new Stage(new Map([['index.html', toBytes('<h1>Old</h1>')]]), 1, new Map([[fixturePath, toBytes('id,title\n1,Old\n')]]));
    expect(stage.list()).toEqual(['index.html']);
    expect(() => stage.write(fixturePath, 'id,title\n1,New\n')).toThrow('Invalid project path');
    stage.writeFixtureBytes(fixturePath, toBytes('id,title\n1,New\n'));
    expect(stage.changes()).toEqual([fixturePath]);
  });
});
