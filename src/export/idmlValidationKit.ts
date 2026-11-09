import { createZipArchive } from '../zip';
import validationScript from '../../public/conversion/Recto-Validate-IDML.jsx?raw';

export function createIdmlValidationKit(fileName: string, idml: Uint8Array) {
  return createZipArchive({
    [fileName]: idml,
    'Recto-Validate-IDML.jsx': validationScript,
    'README.txt': [
      'Recto Studio IDML validation kit', '',
      '1. Install the publication fonts and gather its linked images.',
      '2. In a licensed InDesign installation, open Window > Utilities > Scripts.',
      '3. Reveal the User scripts folder and copy Recto-Validate-IDML.jsx into it.',
      `4. Run the script and choose ${fileName}. Choose a folder for the results.`,
      '5. Read roundtrip-report.txt and compare the rendered pages.',
      '6. Open indesign-roundtrip.idml in Recto to complete the return check.',
      '', 'The script writes to a separate folder and leaves the input file untouched.', '',
    ].join('\n'),
  });
}
