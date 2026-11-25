import { describe, expect, it } from 'vitest';
import { claimsProblem, factsText } from './claimsGuard';

const facts = factsText({ product: { name: 'Prod AI', retail_price: 1200.5, sale_price: 99 } });

describe('claims guard', () => {
  it('accepts plain text and numbers that are in the data', () => {
    expect(claimsProblem('Fresh rice for your shop', facts)).toBeNull();
    expect(claimsProblem('ETB 1,200.50', facts)).toBeNull();
    expect(claimsProblem('ETB 99.00', facts)).toBeNull();
    expect(claimsProblem('ETB 99', facts)).toBeNull();
  });
  it('refuses invented numbers, percentages, links, handles and markup', () => {
    expect(claimsProblem('ETB 850', facts)).toMatch(/not in the approved data/);
    expect(claimsProblem('Save 20% now', facts)).toMatch(/percentage/);
    expect(claimsProblem('Visit www.shop.com', facts)).toMatch(/link/);
    expect(claimsProblem('shop.com', facts)).toMatch(/link/);
    expect(claimsProblem('Call @mybrand', facts)).toMatch(/handle/);
    expect(claimsProblem('<b>x</b>', facts)).toMatch(/markup/);
    expect(claimsProblem('a\u0007b', facts)).toMatch(/control/);
    expect(claimsProblem('ዋጋ ፭ ብር', facts)).toMatch(/Ethiopic numerals/);
  });
  it('refuses marketing claims in English, Somali and Amharic unless the data has them', () => {
    for (const t of ['The best rice in town', 'Guaranteed quality', 'Cheapest in Addis', 'Waa ugu fiican', 'Bilaash ah', 'ምርጥ ሩዝ', 'ዋስትና አለው']) {
      expect(claimsProblem(t, facts), t).not.toBeNull();
    }
    expect(claimsProblem('free delivery', factsText({ note: 'free delivery' }))).toBeNull();
  });
  it('matches whole words only', () => {
    expect(claimsProblem('Prod AI is a bestseller', facts)).toBeNull();
    expect(claimsProblem('Original', facts)).not.toBeNull();
    expect(claimsProblem('Originality', facts)).toBeNull();
  });
});
