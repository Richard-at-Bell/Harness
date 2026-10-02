import { describe, expect, it } from 'vitest';
import { createModels } from '@earendil-works/pi-ai';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
import { DEFAULT_MODEL, MODEL_CHOICES, pricePerMillion } from './models';

describe('model picker', () => {
  it('offers unique model IDs understood by the installed Pi provider', () => {
    const models = createModels();
    models.setProvider(openrouterProvider());
    expect(new Set(MODEL_CHOICES.map(choice => choice.id)).size).toBe(MODEL_CHOICES.length);
    expect(MODEL_CHOICES[0].id).toBe(DEFAULT_MODEL);
    for (const choice of MODEL_CHOICES) expect(models.getModel('openrouter', choice.id), choice.id).toBeDefined();
  });

  it('formats live per-token prices as rates per million', () => {
    expect(pricePerMillion('0.000002')).toBe('$2');
    expect(pricePerMillion('0.00000005')).toBe('$0.05');
    expect(pricePerMillion('0.000000005')).toBe('$0.005');
    expect(pricePerMillion('0')).toBe('$0');
    expect(pricePerMillion('')).toBeUndefined();
    expect(pricePerMillion('-0.000001')).toBeUndefined();
    expect(pricePerMillion('unknown')).toBeUndefined();
    expect(pricePerMillion(undefined)).toBeUndefined();
  });
});
