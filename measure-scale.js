const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const INPUT_FILE = path.resolve('fonts.json');
const OUTPUT_FILE = path.resolve('google-fonts.json');

const BASE_FONT = 'Roboto';
const BASE_URL = 'https://fonts.googleapis.com/css2?family=Roboto&display=swap';
const TEST_STRING = 'HhWwXxOo123';
const TEST_SIZE = 100;

async function measureFont(page, font) {
  const fontUrls = [BASE_URL, font.importUrl];

  const html = `
    <html>
    <head>
      ${fontUrls.map((url) => `<link rel="stylesheet" href="${url}">`).join('\n')}
      <style>
        body {
          margin: 0;
        }
        .test {
          font-size: ${TEST_SIZE}px;
          line-height: 1;
          font-weight: 400;
          font-style: normal;
        }
        .base {
          font-family: '${BASE_FONT}', sans-serif;
        }
        .target {
          font-family: ${font.cssFamily};
        }
      </style>
    </head>
    <body>
      <div class="test base">${TEST_STRING}</div>
      <div class="test target">${TEST_STRING}</div>
    </body>
    </html>
  `;

  await page.setViewport({ width: 800, height: 200 });
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);

  const rects = await page.evaluate(() => {
    const base = document.querySelector('.base').getBoundingClientRect();
    const target = document.querySelector('.target').getBoundingClientRect();
    return {
      baseHeight: base.height,
      targetHeight: target.height,
    };
  });

  return rects.baseHeight / rects.targetHeight;
}

(async () => {
  const fonts = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf-8'));
  const results = {};

  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();

  for (const [key, font] of Object.entries(fonts)) {
    const scale = await measureFont(page, font);
    font.scale = parseFloat(scale.toFixed(3));
    results[key] = font;
    console.log(`${key}: scale=${font.scale}`);
  }

  await browser.close();

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
  console.log(`✅ Output written to ${OUTPUT_FILE}`);
})();
