import type { PagePreset } from '../types';

const choices: { preset: PagePreset; facing: boolean; name: string; description: string; title: string }[] = [
  { preset: 'A4', facing: true, name: 'Blank Editorial Magazine (A4)', description: '210 × 297 mm · Facing pages',
    title: 'Create blank facing spread magazine (210 x 297 mm)' },
  { preset: 'Book-Trade-6x9', facing: true, name: 'Blank Novel / Trade Book (6 × 9 in)', description: '152.4 × 228.6 mm · Fiction and nonfiction',
    title: 'Create blank fiction / trade paperback book (6 x 9 in)' },
  { preset: 'US-Letter', facing: true, name: 'Blank Magazine (US Letter)', description: '8.5 × 11 in · Facing pages',
    title: 'Create blank North American standard publication (8.5 x 11 in)' },
  { preset: 'Digest-5.5x8.5', facing: true, name: 'Blank Digest (5.5 × 8.5 in)', description: '139.7 × 215.9 mm · Journals and memoirs',
    title: 'Create blank digest journal / essay book (5.5 x 8.5 in)' },
  { preset: 'Zine-A5', facing: true, name: 'Blank Zine / Pamphlet (A5)', description: '148 × 210 mm · Zines and chapbooks',
    title: 'Create blank compact zine or chapbook (148 x 210 mm)' },
  { preset: 'A4', facing: false, name: 'Single Sheet / Poster (A4)', description: '210 × 297 mm · Single pages',
    title: 'Create blank single page poster or flyer (210 x 297 mm)' },
];

export default function NewProjectMenu({ onCreate }: { onCreate: (preset: PagePreset, facing: boolean) => void }) {
  return <div className="top-dropdown-menu new-dropdown-menu">
    {choices.map(choice => <button className="top-dropdown-item" key={choice.name} title={choice.title}
      onClick={() => onCreate(choice.preset, choice.facing)}>
      <div><div className="dropdown-item-title">{choice.name}</div><div className="dropdown-item-sub">{choice.description}</div></div>
    </button>)}
  </div>;
}
