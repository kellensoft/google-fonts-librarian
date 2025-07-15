import fs from 'fs';
import path from 'path';
import axios from 'axios';
import slugify from 'slugify';

const API_KEY = process.env.GOOGLE_FONTS_API_KEY;
const OUTPUT_FILE = path.resolve('gFontLibrary.js');

async function generateFontLibrary() {
  try {
    const { data } = await axios.get(
      `https://www.googleapis.com/webfonts/v1/webfonts?key=${API_KEY}`
    );

    const fonts = {};

    for (const font of data.items) {
      const name = font.family;
      const key = slugify(font.family, { lower: true });
      fonts[key] = {
        name,
        importUrl: `https://fonts.googleapis.com/css2?family=${font.family.replace(/ /g, '+')}&display=swap`,
        cssFamily: `'${name}', ${font.category}`,
      };
    }

    const exportString = `export const gFontLibrary = ${JSON.stringify(fonts, null, 2)};\n`;
    fs.writeFileSync(OUTPUT_FILE, exportString);
    console.log('✅ Font library updated.');
  } catch (err) {
    console.error('❌ Error generating font library:', err);
    process.exit(1);
  }
}

generateFontLibrary();
