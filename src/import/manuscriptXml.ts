/** Non-executing XML reader. DTDs and external entities are never loaded. */
export interface XmlNode { name: string; attrs: Record<string, string>; children: (XmlNode | string)[] }
export function decodeXml(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (all, code: string) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (named[code]) return named[code];
    const value = code.startsWith('#x') ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff) ? String.fromCodePoint(value) : all;
  });
}
export function parseManuscriptXml(xml: string): XmlNode {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('DOCX XML entity declarations are not supported.');
  const root: XmlNode = { name: '#root', attrs: {}, children: [] };
  const stack = [root];
  const tokens = xml.match(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]+>|[^<]+/g) || [];
  for (const token of tokens) {
    if (token.startsWith('<!--') || token.startsWith('<?')) continue;
    if (token.startsWith('<![CDATA[')) { stack.at(-1)!.children.push(token.slice(9, -3)); continue; }
    if (token.startsWith('</')) {
      if (stack.length === 1 || stack.at(-1)!.name !== token.slice(2, -1).trim().split(':').at(-1)) throw new Error('The DOCX contains malformed XML.');
      stack.pop();
    } else if (token.startsWith('<')) {
      const match = /^<([^\s/>]+)/.exec(token);
      if (!match) throw new Error('The DOCX contains malformed XML.');
      const node: XmlNode = { name: match[1].split(':').at(-1)!, attrs: {}, children: [] };
      for (const attr of token.matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) node.attrs[attr[1].split(':').at(-1)!] = decodeXml(attr[2] ?? attr[3]);
      stack.at(-1)!.children.push(node);
      if (!token.endsWith('/>')) stack.push(node);
    } else stack.at(-1)!.children.push(decodeXml(token));
    if (stack.length > 256) throw new Error('The DOCX XML is nested too deeply.');
  }
  if (stack.length !== 1) throw new Error('The DOCX contains incomplete XML.');
  return root;
}
export const children = (node: XmlNode, name?: string): XmlNode[] => node.children.filter((c): c is XmlNode => typeof c !== 'string' && (!name || c.name === name));
export const child = (node: XmlNode | undefined, name: string): XmlNode | undefined => node && children(node, name)[0];
export const descendants = (node: XmlNode, name: string): XmlNode[] => children(node).flatMap(n => [...(n.name === name ? [n] : []), ...descendants(n, name)]);
export const nodeText = (node: XmlNode): string => node.children.map(c => typeof c === 'string' ? c : nodeText(c)).join('');
