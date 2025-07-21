import fs from 'fs';
import path from 'path';
import axios from 'axios';
import slugify from 'slugify';

function getWorkingImportUrl(font) {
  const name = font.family;
  const encoded = name.replace(/ /g, '+');
  const weightVariants = font.variants.filter(v => /^\d+$/.test(v));

  if (font.variants.length === 1 && font.variants[0] === 'italic') {
    return `https://fonts.googleapis.com/css2?family=${encoded}:ital@1&display=swap`;
  }

  if (weightVariants.length > 0) {
    const minWeight = Math.min(...weightVariants.map(Number));
    return `https://fonts.googleapis.com/css2?family=${encoded}:wght@${minWeight}&display=swap`;
  }

  return `https://fonts.googleapis.com/css2?family=${encoded}&display=swap`;
}

const API_KEY = process.env.GOOGLE_FONTS_API_KEY;
const OUTPUT_FILE = path.resolve('fonts.json');

async function generateFontLibrary() {
  try {
    const { data } = await axios.get(
      `https://www.googleapis.com/webfonts/v1/webfonts?key=${API_KEY}`
    );

    const fonts = {};

    for (const font of data.items) {
      const name = font.family;
      const key = slugify(font.family, { lower: true });
      const importUrl = await getWorkingImportUrl(font);
      if (!importUrl) continue;

      fonts[key] = {
        name,
        importUrl,
        cssFamily: `'${name}', ${font.category}`,
      };
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(fonts, null, 2));
    console.log('✅ Font library updated.');
  } catch (err) {
    console.error('❌ Error generating font library:', err);
    process.exit(1);
  }
}

generateFontLibrary();
