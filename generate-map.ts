import fs from 'fs';
import path from 'path';
import slugify from 'slugify';
import axios from 'axios';

const API_KEY = process.env.GOOGLE_FONTS_API_KEY!;
const OUTPUT_FILE = path.join(__dirname, '../gFontLibrary.ts');

async function generateFontLibrary() {
  const { data } = await axios.get(
    `https://www.googleapis.com/webfonts/v1/webfonts?key=${API_KEY}`
  );

  const fonts: Record<string, { importUrl: string; cssFamily: string }> = {};

  for (const font of data.items) {
    const key = slugify(font.family, { lower: true });
    fonts[key] = {
      importUrl: `https://fonts.googleapis.com/css2?family=${font.family.replace(/ /g, '+')}&display=swap`,
      cssFamily: `'${font.family}', ${font.category}`,
    };
  }

  const tsExport = `export const gFontLibrary = ${JSON.stringify(fonts, null, 2)};\n`;

  fs.writeFileSync(OUTPUT_FILE, tsExport);
  console.log('Font library updated.');
}

generateFontLibrary();
