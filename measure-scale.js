import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const INPUT_FILE = path.resolve('fonts.json');
const OUTPUT_FILE = path.resolve('google-fonts.json');

const BASE_FONT = 'Roboto';
const BASE_URL = 'https://fonts.googleapis.com/css2?family=Roboto&display=swap';

const TEST_STRING = 'WWWWWwwwww';
const TEST_SIZE = 100;

const BATCH_SIZE = 20;
const MAX_RETRIES = 2;

async function retryFailedFont(page, key, font, attempt = 1) {
  console.log(`🔄 Retrying ${key} (attempt ${attempt}/${MAX_RETRIES})`);
  
  const html = `
    <html>
    <head>
      <link rel="stylesheet" href="${BASE_URL}" media="print" onload="this.media='all'">
      <link rel="stylesheet" href="${font.importUrl}" media="print" onload="this.media='all'">
      <style>
        body { margin: 0; font-display: swap; }
        .test {
          font-size: ${TEST_SIZE}px;
          line-height: 1;
          font-weight: 400;
          font-style: normal;
          display: inline-block;
          position: absolute;
          white-space: nowrap;
          visibility: hidden;
        }
        .base { font-family: '${BASE_FONT}', sans-serif; }
        .target { font-family: '${font.name}', sans-serif; }
      </style>
    </head>
    <body>
      <div class="test base" id="base">${TEST_STRING}</div>
      <div class="test target" id="target">${TEST_STRING}</div>
    </body>
    </html>
  `;

  await page.setContent(html, { waitUntil: 'networkidle2' });
  
  await page.evaluate(async (fontName, testSize) => {
    await document.fonts.ready;
    await document.fonts.load(`400 ${testSize}px "${fontName}"`);
    let attempts = 0;
    while (!document.fonts.check(`400 ${testSize}px "${fontName}"`) && attempts < 30) {
      await new Promise(r => setTimeout(r, 100));
      attempts++;
    }
  }, font.name, TEST_SIZE);

  await new Promise(resolve => setTimeout(resolve, 200));

  const measurement = await page.evaluate(() => {
    const baseRect = document.getElementById('base').getBoundingClientRect();
    const targetRect = document.getElementById('target').getBoundingClientRect();
    
    return {
      baseWidth: baseRect.width,
      targetWidth: targetRect.width,
      scale: baseRect.width / targetRect.width
    };
  });

  if (Math.abs(measurement.baseWidth - measurement.targetWidth) < 0.1) {
    return null;
  }

  console.log(`✅ Retry successful for ${key}`);
  return measurement;
}

async function measureFontBatch(page, fontBatch) {
  const fontUrls = [BASE_URL, ...fontBatch.map(([key, font]) => font.importUrl)];
  
  const fontClasses = fontBatch.map(([key, font]) => `
    .font-${key} {
      font-family: '${font.name}', sans-serif;
    }
  `).join('');

  const html = `
    <html>
    <head>
      ${fontUrls.map((url) => `<link rel="stylesheet" href="${url}" media="print" onload="this.media='all'">`).join('\n')}
      <style>
        body { margin: 0; font-display: swap; }
        .test {
          font-size: ${TEST_SIZE}px;
          line-height: 1;
          font-weight: 400;
          font-style: normal;
          display: inline-block;
          position: absolute;
          white-space: nowrap;
          visibility: hidden;
        }
        .base { font-family: '${BASE_FONT}', sans-serif; }
        ${fontClasses}
      </style>
    </head>
    <body>
      <div class="test base" id="base">${TEST_STRING}</div>
      ${fontBatch.map(([key]) => `<div class="test font-${key}" id="target-${key}">${TEST_STRING}</div>`).join('')}
    </body>
    </html>
  `;

  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  
  const fontNames = fontBatch.map(([key, font]) => font.name);
  const loadResults = await page.evaluate(async (fontNames) => {
    await document.fonts.ready;
    const results = {};
    const promises = fontNames.map(async (fontName) => {
      let attempts = 0;
      while (!document.fonts.check('400 100px "' + fontName + '"') && attempts < 20) {
        await new Promise(r => setTimeout(r, 50));
        attempts++;
      }
      results[fontName] = attempts < 20;
    });
    await Promise.all(promises);
    return results;
  }, fontNames);

  const measurements = await page.evaluate((fontKeys) => {
    const baseRect = document.getElementById('base').getBoundingClientRect();
    const results = {};
    fontKeys.forEach(key => {
      const targetRect = document.getElementById(`target-${key}`).getBoundingClientRect();
      results[key] = {
        baseWidth: baseRect.width,
        targetWidth: targetRect.width,
        scale: baseRect.width / targetRect.width
      };
    });
    return results;
  }, fontBatch.map(([key]) => key));

  const failedFonts = [];
  fontBatch.forEach(([key, font]) => {
    if (!loadResults[font.name]) {
      console.warn(`⚠️ Font loading timeout: ${key}`);
    }
    const measurement = measurements[key];
    if (Math.abs(measurement.baseWidth - measurement.targetWidth) < 0.1) {
      failedFonts.push([key, font]);
    }
  });

  return { measurements, failedFonts };
}

(async () => {
  const fonts = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf-8'));
  const results = {};
  const fontEntries = Object.entries(fonts);

  console.log(`Processing ${fontEntries.length} fonts in batches of ${BATCH_SIZE}...`);

  const browser = await puppeteer.launch({
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--disable-gpu',
      '--no-first-run',
      '--disable-default-apps'
    ],
    headless: true
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    
    for (let i = 0; i < fontEntries.length; i += BATCH_SIZE) {
      const batch = fontEntries.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(fontEntries.length / BATCH_SIZE);
      
      console.log(`Processing batch ${batchNumber}/${totalBatches} (${batch.length} fonts)`);

      // Set scale=1 for Roboto fonts and skip measuring and retrying
      batch.forEach(([key, font]) => {
        if (font.name === 'Roboto') {
          font.scale = 1.0;
          results[key] = font;
        }
      });

      const filteredBatch = batch.filter(([key, font]) => font.name !== 'Roboto');

      try {
        if (filteredBatch.length > 0) {
          const { measurements, failedFonts } = await measureFontBatch(page, filteredBatch);
          filteredBatch.forEach(([key, font]) => {
            if (!font.cssFamily) {
              font.cssFamily = `'${font.name}'`;
            }
            font.scale = parseFloat(measurements[key].scale.toFixed(3));
            results[key] = font;
          });

          if (failedFonts.length > 0) {
            console.log(`🔄 Retrying ${failedFonts.length} fonts from batch ${batchNumber}`);
            
            for (const [key, font] of failedFonts) {
              if (font.name === 'Roboto') {
                font.scale = 1.0;
                results[key] = font;
                continue;
              }
              let retrySuccessful = false;
              
              for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                try {
                  const retryMeasurement = await retryFailedFont(page, key, font, attempt);
                  if (retryMeasurement) {
                    font.scale = parseFloat(retryMeasurement.scale.toFixed(3));
                    results[key] = font;
                    retrySuccessful = true;
                    break;
                  }
                } catch (retryError) {
                  console.warn(`⚠️ Retry attempt ${attempt} failed for ${key}: ${retryError.message}`);
                }
                if (attempt < MAX_RETRIES) {
                  await new Promise(resolve => setTimeout(resolve, 500));
                }
              }
              
              if (!retrySuccessful) {
                console.warn(`❌ Font ${key} failed after ${MAX_RETRIES} retries - using fallback scale`);
                font.scale = 1.0;
                results[key] = font;
              }
            }
          }
        }
      } catch (error) {
        console.error(`❌ Error processing batch ${batchNumber}: ${error.message}`);
        batch.forEach(([key, font]) => {
          if (font.name === 'Roboto') {
            font.scale = 1.0;
          } else {
            font.scale = 1.0;
          }
          results[key] = font;
        });
      }
      
      if (i + BATCH_SIZE < fontEntries.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

  } finally {
    await browser.close();
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
  console.log(`✅ Completed processing ${Object.keys(results).length} fonts`);
  console.log(`📄 Output written to ${OUTPUT_FILE}`);
})();
