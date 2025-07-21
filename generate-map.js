import fs from 'fs';
import path from 'path';
import axios from 'axios';
import slugify from 'slugify';
import https from 'https';

function fetchStatusCode(url) {
  return new Promise((resolve) => {
    https.get(url, (res) => resolve(res.statusCode)).on('error', () => resolve(null));
  });
}

async function getWorkingImportUrl(fontName) {
  const encoded = encodeURIComponent(fontName);
  const css2Wght = `https://fonts.googleapis.com/css2?family=${encoded}:wght@400&display=swap`;
  const css2 = `https://fonts.googleapis.com/css2?family=${encoded}&display=swap`;
  const css = `https://fonts.googleapis.com/css?family=${encoded}&display=swap`;

  const css2WghtStatus = await fetchStatusCode(css2Wght);
  if (css2WghtStatus === 200) return css2Wght;

  const css2Status = await fetchStatusCode(css2);
  if (css2Status === 200) return css2;

  const cssStatus = await fetchStatusCode(css);
  if (cssStatus === 200) return css;

  console.warn(`❌ No working import URL for "${fontName}"`);
  return null;
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
      const importUrl = await getWorkingImportUrl(name);
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
