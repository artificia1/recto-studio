import Hypher from 'hypher';
import english from 'hyphenation.en-us';
import german from 'hyphenation.de';
import french from 'hyphenation.fr';

const dictionaries = new Map([
  ['en-US', new Hypher(english)], ['de', new Hypher(german)], ['fr', new Hypher(french)],
]);
export function hyphenateLanguage(word: string, language = 'en-US'): string[] {
  if (!/^\p{L}+$/u.test(word)) return [word];
  return dictionaries.get(language)?.hyphenate(word) || [word];
}
