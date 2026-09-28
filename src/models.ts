export type ModelChoice = {
  id: string;
  name: string;
  maker: string;
  badge: string;
  description: string;
};

export const MODEL_CHOICES: ModelChoice[] = [
  { id: 'anthropic/claude-sonnet-5', name: 'Claude Sonnet 5', maker: 'Anthropic', badge: 'Recommended', description: 'Strong first choice for editing, tool use, and UI work.' },
  { id: 'openai/gpt-6-sol', name: 'GPT-6 Sol', maker: 'OpenAI', badge: 'Strong', description: 'For more demanding, multi-step coding changes.' },
  { id: 'openai/gpt-6-luna', name: 'GPT-6 Luna', maker: 'OpenAI', badge: 'Fast', description: 'Quick iterations at a lower cost.' },
  { id: 'qwen/qwen3-coder-next', name: 'Qwen3 Coder Next', maker: 'Qwen', badge: 'Budget', description: 'Focused coding model for inexpensive experiments.' },
  { id: 'deepseek/deepseek-v4-flash-0731', name: 'DeepSeek V4 Flash', maker: 'DeepSeek', badge: 'Budget', description: 'Low-cost option for trying agent workflows.' },
  { id: 'moonshotai/kimi-k2.6', name: 'Kimi K2.6', maker: 'Moonshot AI', badge: 'Alternative', description: 'Another coding and interface model to compare.' },
];

export const DEFAULT_MODEL = MODEL_CHOICES[0].id;

export type LiveModel = { id: string; pricing?: { prompt?: string; completion?: string } };

export async function loadLiveModels(signal?: AbortSignal): Promise<Map<string, LiveModel>> {
  const response = await fetch('https://openrouter.ai/api/v1/models?supported_parameters=tools', { signal });
  if (!response.ok) throw new Error(`OpenRouter catalog returned ${response.status}`);
  const body = await response.json() as { data?: LiveModel[] };
  if (!Array.isArray(body.data)) throw new Error('OpenRouter catalog has no model list');
  return new Map(body.data.map(model => [model.id, model]));
}

export function modelName(id: string): string {
  return MODEL_CHOICES.find(choice => choice.id === id)?.name || id.split('/').at(-1) || id;
}

export function pricePerMillion(value?: string): string | undefined {
  const price = Number(value) * 1_000_000;
  if (!Number.isFinite(price) || price < 0 || value == null) return undefined;
  return `$${price < 1 ? price.toFixed(2) : price.toFixed(2).replace(/\.00$/, '')}`;
}
