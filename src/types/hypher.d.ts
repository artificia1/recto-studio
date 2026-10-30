declare module 'hypher' {
  export default class Hypher { constructor(patterns: unknown); hyphenate(word: string): string[]; }
}
declare module 'hyphenation.en-us' { const patterns: unknown; export default patterns; }
declare module 'hyphenation.de' { const patterns: unknown; export default patterns; }
declare module 'hyphenation.fr' { const patterns: unknown; export default patterns; }
