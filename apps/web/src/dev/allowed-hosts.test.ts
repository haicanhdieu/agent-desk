import { parseAllowedHosts } from './allowed-hosts';

describe('parseAllowedHosts', () => {
  it('returns no hosts when the variable is unset or blank', () => {
    expect(parseAllowedHosts(undefined)).toEqual([]);
    expect(parseAllowedHosts('')).toEqual([]);
    expect(parseAllowedHosts('  , ,')).toEqual([]);
  });

  it('splits a comma separated list and trims each host', () => {
    expect(parseAllowedHosts('a.example.com, b.example.com ,c.example.com')).toEqual([
      'a.example.com',
      'b.example.com',
      'c.example.com',
    ]);
  });

  it('keeps a leading-dot wildcard host as written', () => {
    expect(parseAllowedHosts('.example.com')).toEqual(['.example.com']);
  });

  it('drops duplicates and keeps order', () => {
    expect(parseAllowedHosts('a.example.com,b.example.com,a.example.com')).toEqual(['a.example.com', 'b.example.com']);
  });
});
