import { normalizeHandle } from './handle';

describe('normalizeHandle', () => {
  it('strips @ and lowercases', () => {
    expect(normalizeHandle('@Ada.Creates')).toBe('ada.creates');
  });

  it('trims whitespace', () => {
    expect(normalizeHandle('  Someone  ')).toBe('someone');
  });
});
