import { describe, expect, it } from 'vitest';
import { embeddedAsset } from '../src/export/publicationAssets';

describe('self-contained SVG security boundaries', () => {
  const svg = (body: string) => `data:image/svg+xml,${body}`;
  it.each([
    '<svg><s:script xmlns:s="http://www.w3.org/2000/svg">alert(1)</s:script></svg>',
    '<svg><image href=https://private.example/a.png /></svg>',
    '<svg><s:style xmlns:s="http://www.w3.org/2000/svg">path{fill:u\\72l(https://private.example/a)}</s:style></svg>',
    '<svg><rect fill="url(&#x68;ttps://private.example/a)"/></svg>',
    '<svg><animate attributeName="href" to="https://private.example/a"/></svg>',
    '<svg xml:base="https://private.example/"><use href="#a"/></svg>',
  ])('rejects active, obfuscated or malformed resources: %s', source => {
    expect(() => embeddedAsset(svg(source))).toThrow();
  });
  it('retains safe internal references and static artwork', () => {
    expect(embeddedAsset(svg('<svg><defs><path id="a" d="M0 0L1 1"/></defs><use href="#a"/></svg>')).mediaType).toBe('image/svg+xml');
  });
});
