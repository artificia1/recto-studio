// Recto Font Manager: Google Fonts Loader & Custom Font Drop Engine

export interface FontMetadata {
  family: string;
  category: 'serif' | 'sans-serif' | 'display' | 'monospace' | 'handwriting';
  source: 'system' | 'google' | 'custom';
  fallback: string;
  loaded?: boolean;
}

export const POPULAR_GOOGLE_FONTS: FontMetadata[] = [
  // Serif
  { family: 'Playfair Display', category: 'serif', source: 'google', fallback: 'Georgia, serif' },
  { family: 'Merriweather', category: 'serif', source: 'google', fallback: 'Georgia, serif' },
  { family: 'Lora', category: 'serif', source: 'google', fallback: 'serif' },
  { family: 'Cinzel', category: 'serif', source: 'google', fallback: 'serif' },
  { family: 'EB Garamond', category: 'serif', source: 'google', fallback: 'Georgia, serif' },
  { family: 'PT Serif', category: 'serif', source: 'google', fallback: 'serif' },
  { family: 'Libre Baskerville', category: 'serif', source: 'google', fallback: 'Georgia, serif' },
  { family: 'Cormorant Garamond', category: 'serif', source: 'google', fallback: 'serif' },
  { family: 'Bodoni Moda', category: 'serif', source: 'google', fallback: 'serif' },
  { family: 'Spectral', category: 'serif', source: 'google', fallback: 'serif' },
  { family: 'Bitter', category: 'serif', source: 'google', fallback: 'serif' },
  { family: 'Cardo', category: 'serif', source: 'google', fallback: 'serif' },

  // Sans-serif
  { family: 'Inter', category: 'sans-serif', source: 'google', fallback: 'system-ui, sans-serif' },
  { family: 'Roboto', category: 'sans-serif', source: 'google', fallback: 'sans-serif' },
  { family: 'Open Sans', category: 'sans-serif', source: 'google', fallback: 'sans-serif' },
  { family: 'Lato', category: 'sans-serif', source: 'google', fallback: 'sans-serif' },
  { family: 'Montserrat', category: 'sans-serif', source: 'google', fallback: 'sans-serif' },
  { family: 'Poppins', category: 'sans-serif', source: 'google', fallback: 'sans-serif' },
  { family: 'Raleway', category: 'sans-serif', source: 'google', fallback: 'sans-serif' },
  { family: 'Nunito', category: 'sans-serif', source: 'google', fallback: 'sans-serif' },
  { family: 'Work Sans', category: 'sans-serif', source: 'google', fallback: 'sans-serif' },
  { family: 'DM Sans', category: 'sans-serif', source: 'google', fallback: 'sans-serif' },
  { family: 'Rubik', category: 'sans-serif', source: 'google', fallback: 'sans-serif' },
  { family: 'Oswald', category: 'sans-serif', source: 'google', fallback: 'sans-serif' },
  { family: 'Manrope', category: 'sans-serif', source: 'google', fallback: 'sans-serif' },
  { family: 'Plus Jakarta Sans', category: 'sans-serif', source: 'google', fallback: 'sans-serif' },

  // Display
  { family: 'Space Grotesk', category: 'display', source: 'google', fallback: 'sans-serif' },
  { family: 'Syne', category: 'display', source: 'google', fallback: 'sans-serif' },
  { family: 'Bebas Neue', category: 'display', source: 'google', fallback: 'sans-serif' },
  { family: 'Abril Fatface', category: 'display', source: 'google', fallback: 'serif' },
  { family: 'Righteous', category: 'display', source: 'google', fallback: 'cursive' },
  { family: 'Alfa Slab One', category: 'display', source: 'google', fallback: 'serif' },
  { family: 'Comfortaa', category: 'display', source: 'google', fallback: 'sans-serif' },
  { family: 'Lobster', category: 'display', source: 'google', fallback: 'cursive' },
  { family: 'Unbounded', category: 'display', source: 'google', fallback: 'sans-serif' },

  // Monospace
  { family: 'JetBrains Mono', category: 'monospace', source: 'google', fallback: 'monospace' },
  { family: 'Fira Code', category: 'monospace', source: 'google', fallback: 'monospace' },
  { family: 'Source Code Pro', category: 'monospace', source: 'google', fallback: 'monospace' },
  { family: 'Roboto Mono', category: 'monospace', source: 'google', fallback: 'monospace' },
  { family: 'Space Mono', category: 'monospace', source: 'google', fallback: 'monospace' },
  { family: 'Courier Prime', category: 'monospace', source: 'google', fallback: 'Courier, monospace' },

  // Handwriting
  { family: 'Caveat', category: 'handwriting', source: 'google', fallback: 'cursive' },
  { family: 'Dancing Script', category: 'handwriting', source: 'google', fallback: 'cursive' },
  { family: 'Pacifico', category: 'handwriting', source: 'google', fallback: 'cursive' },
  { family: 'Great Vibes', category: 'handwriting', source: 'google', fallback: 'cursive' },
];

export const SYSTEM_FONTS: FontMetadata[] = [
  { family: 'Georgia', category: 'serif', source: 'system', fallback: 'serif' },
  { family: 'Times New Roman', category: 'serif', source: 'system', fallback: 'serif' },
  { family: 'Palatino', category: 'serif', source: 'system', fallback: 'serif' },
  { family: 'Garamond', category: 'serif', source: 'system', fallback: 'serif' },
  { family: 'Arial', category: 'sans-serif', source: 'system', fallback: 'sans-serif' },
  { family: 'Helvetica', category: 'sans-serif', source: 'system', fallback: 'sans-serif' },
  { family: 'Verdana', category: 'sans-serif', source: 'system', fallback: 'sans-serif' },
  { family: 'Trebuchet MS', category: 'sans-serif', source: 'system', fallback: 'sans-serif' },
  { family: 'Courier New', category: 'monospace', source: 'system', fallback: 'monospace' },
  { family: 'Impact', category: 'display', source: 'system', fallback: 'sans-serif' },
];

export class FontManager {
  private fontAssets = new Map<string, { family: string; fileName: string; data: string }>();
  private parsedFonts = new Map<string, import('fontkit').Font>();
  private activeFaces = new Map<string, FontFace>();
  private googleRequests = new Map<string, Promise<boolean>>();
  private customFonts: Map<string, FontMetadata> = new Map();
  private loadedGoogleFonts: Set<string> = new Set();
  private listeners: Set<() => void> = new Set();

  constructor() {
    // A font is cached only after its actual bytes or stylesheet have loaded.
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {}
    }
  }

  public getAvailableFonts(): FontMetadata[] {
    const list: FontMetadata[] = [
      ...Array.from(this.customFonts.values()),
      ...SYSTEM_FONTS,
      ...POPULAR_GOOGLE_FONTS,
    ];
    return list;
  }

  public searchFonts(query: string, category?: string): FontMetadata[] {
    const q = query.trim().toLowerCase();
    return this.getAvailableFonts().filter((f) => {
      if (category && category !== 'all' && f.category !== category) return false;
      if (!q) return true;
      return f.family.toLowerCase().includes(q);
    });
  }

  public isGoogleFont(family: string): boolean {
    const clean = family.split(',')[0].trim().replace(/['"]/g, '');
    return POPULAR_GOOGLE_FONTS.some((g) => g.family.toLowerCase() === clean.toLowerCase());
  }

  public isCustomFont(family: string): boolean {
    const clean = family.split(',')[0].trim().replace(/['"]/g, '');
    return this.customFonts.has(clean);
  }

  public async loadGoogleFont(family: string): Promise<boolean> {
    const key = family.split(',')[0].trim().replace(/['"]/g, '');
    const pending = this.googleRequests.get(key);
    if (pending) return pending;
    const request = this.loadGoogleFontOnce(family).finally(() => this.googleRequests.delete(key));
    this.googleRequests.set(key, request);
    return request;
  }

  private async loadGoogleFontOnce(family: string): Promise<boolean> {
    const cleanFamily = family.split(',')[0].trim().replace(/['"]/g, '');
    if (!cleanFamily) return false;
    if (this.isCustomFont(cleanFamily)) return true;

    // Cache hit short-circuit
    if (this.loadedGoogleFonts.has(cleanFamily)) return true;

    // Platform system fonts bypass
    if (SYSTEM_FONTS.some((s) => s.family.toLowerCase() === cleanFamily.toLowerCase())) {
      return true;
    }

    if (typeof document === 'undefined') {
      this.loadedGoogleFonts.add(cleanFamily);
      return true;
    }

    try {
      const linkId = `gfont-${cleanFamily.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
      if (!document.getElementById(linkId)) {
        const link = document.createElement('link');
        link.id = linkId;
        link.rel = 'stylesheet';
        link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(cleanFamily)}:ital,wght@0,400;0,700;1,400;1,700&display=swap`;
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            link.remove();
            reject(new Error('Font download timed out'));
          }, 15000);
          link.onload = () => { clearTimeout(timer); resolve(); };
          link.onerror = () => { clearTimeout(timer); link.remove(); reject(new Error('Font download failed')); };
          document.head.appendChild(link);
        });
      }
      await document.fonts.load(`16px "${cleanFamily}"`);
      this.loadedGoogleFonts.add(cleanFamily);
      this.notify();
      return true;
    } catch {
      return false;
    }
  }

  public async registerFontBuffer(
    fileName: string,
    buffer: ArrayBuffer | Uint8Array
  ): Promise<string> {
    const bytes = buffer instanceof Uint8Array ? new Uint8Array(buffer) : new Uint8Array(buffer.slice(0));
    if (!bytes.length || bytes.length > 32 * 1024 * 1024) {
      throw new Error('Choose a font file smaller than 32 MB.');
    }
    const { create } = await import('fontkit');
    let parsed: import('fontkit').Font;
    try {
      const result = create(bytes as Parameters<typeof create>[0]);
      if ('fonts' in result) throw new Error('collection');
      parsed = result;
      if (!parsed.unitsPerEm || !parsed.numGlyphs) throw new Error('empty font');
    } catch {
      throw new Error('This font could not be read. Choose a valid TTF, OTF, WOFF, or WOFF2 file. For collections, export an individual font first.');
    }
    const familyName = parsed.fullName || parsed.familyName || fileName.replace(/\.[^.]+$/, '');

    const metadata: FontMetadata = {
      family: familyName,
      category: 'display',
      source: 'custom',
      fallback: 'sans-serif',
      loaded: true,
    };

    if (typeof document !== 'undefined' && typeof FontFace === 'undefined') {
      throw new Error('This browser does not support custom fonts. Try a current browser.');
    }
    if (typeof document !== 'undefined' && typeof FontFace !== 'undefined') {
      try {
        const arrayBuffer = bytes.buffer;
        const fontFace = new FontFace(familyName, arrayBuffer as unknown as BufferSource);
        await fontFace.load();
        const previous = this.activeFaces.get(familyName);
        if (previous) document.fonts.delete(previous);
        document.fonts.add(fontFace);
        this.activeFaces.set(familyName, fontFace);
      } catch (err) {
        throw new Error(`Your browser could not activate "${familyName}". Try the TTF or OTF version of this font.`);
      }
    }

    this.customFonts.set(familyName, metadata);
    this.parsedFonts.set(familyName, parsed);
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    }
    this.fontAssets.set(familyName, { family: familyName, fileName, data: btoa(binary) });
    this.notify();
    return familyName;
  }

  public getCustomFonts(): FontMetadata[] {
    return Array.from(this.customFonts.values());
  }

  public getFont(family = '') {
    return this.parsedFonts.get(family.split(',')[0].trim().replace(/['"]/g, ''));
  }

  public getFontAssets() {
    return Array.from(this.fontAssets.values());
  }

  public async restoreFonts(assets: { family: string; fileName: string; data: string }[] = []) {
    for (const asset of assets) {
      if (this.fontAssets.get(asset.family)?.data === asset.data) continue;
      const bytes = Uint8Array.from(atob(asset.data), character => character.charCodeAt(0));
      await this.registerFontBuffer(asset.fileName, bytes);
    }
  }
}

export const fontManager = new FontManager();
