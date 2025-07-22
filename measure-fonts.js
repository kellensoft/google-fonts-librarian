import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const CONFIG = {
  INPUT_FILE: path.resolve('fonts.json'),
  OUTPUT_FILE: path.resolve('google-fonts.json'),
  TEST_SIZE: 100,
  BATCH_SIZE: 500,
  FONT_LOAD_TIMEOUT: 10000,
  PAGE_TIMEOUT: 30000,
  MAX_RETRIES: 3
};

const CHARACTER_RANGES = [
  [0x0021, 0x007E],
  [0x00A1, 0x00FF],
  [0x0100, 0x017F],
  [0x0180, 0x024F],
  [0x1E00, 0x1EFF],
  [0x2010, 0x2027],
  [0x2030, 0x205F],
  [0x20A0, 0x20CF],
  [0x2100, 0x214F],
  [0x2190, 0x21FF],
  [0x2200, 0x22FF],
];

function generateCharacterMappings() {
  const characterMap = new Map();
  
  for (const [start, end] of CHARACTER_RANGES) {
    for (let codePoint = start; codePoint <= end; codePoint++) {
      const char = String.fromCharCode(codePoint);
      
      if (isVisibleCharacter(char)) {
        const key = `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
        characterMap.set(key, char);
      }
    }
  }
  
  return characterMap;
}

function isVisibleCharacter(char) {
  if (/\s/.test(char) && char !== ' ') return false;
  
  if (/\p{Cc}/u.test(char)) return false;
  
  if (/\p{Cn}/u.test(char)) return false;
  
  if (/\p{Cf}/u.test(char)) return false;
  
  if (/\p{Co}/u.test(char)) return false;
  
  if (/\p{Cs}/u.test(char)) return false;
  
  return true;
}

const CHARACTER_MAP = generateCharacterMappings();
const CHARACTERS_ARRAY = Array.from(CHARACTER_MAP.values());
console.log(`📊 Testing ${CHARACTER_MAP.size} visible characters`);

function validateInput() {
  if (!fs.existsSync(CONFIG.INPUT_FILE)) {
    throw new Error(`❌ Input file not found: ${CONFIG.INPUT_FILE}`);
  }
  
  try {
    const content = fs.readFileSync(CONFIG.INPUT_FILE, 'utf-8');
    const fonts = JSON.parse(content);
    
    if (!fonts || typeof fonts !== 'object') {
      throw new Error('❌ Input file must contain a valid JSON object');
    }
    
    for (const [key, font] of Object.entries(fonts)) {
      if (!font.importUrl || !font.cssFamily) {
        throw new Error(`❌ Font ${key} missing required properties (importUrl, cssFamily)`);
      }
    }
    
    return fonts;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`❌ Invalid JSON in input file: ${error.message}`);
    }
    throw error;
  }
}

function getFontHtml(font, characters) {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <link rel="preload" href="${font.importUrl}" as="style" onload="this.onload=null;this.rel='stylesheet'">
        <noscript><link rel="stylesheet" href="${font.importUrl}"></noscript>
        <style>
          * { box-sizing: border-box; }
          body { 
            margin: 0; 
            padding: 20px;
            font-feature-settings: normal;
          }
          .char {
            font-family: ${font.cssFamily}, monospace;
            font-size: ${CONFIG.TEST_SIZE}px;
            line-height: 1;
            position: absolute;
            top: -9999px;
            left: -9999px;
            visibility: hidden;
            white-space: nowrap;
            font-variant: normal;
            font-kerning: none;
          }
        </style>
      </head>
      <body>
        <div id="container"></div>
        <script>
          window.measureReady = false;
          document.addEventListener('DOMContentLoaded', () => {
            window.measureReady = true;
          });
        </script>
      </body>
    </html>
  `;
}

async function measureCharactersInBatches(page, font, characters) {
  const results = {};
  const batches = [];
  
  for (let i = 0; i < characters.length; i += CONFIG.BATCH_SIZE) {
    batches.push(characters.slice(i, i + CONFIG.BATCH_SIZE));
  }
  
  console.log(`  📦 Processing ${batches.length} batches`);
  
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    let retries = 0;
    
    while (retries < CONFIG.MAX_RETRIES) {
      try {
        console.log(`  🔄 Batch ${batchIndex + 1}/${batches.length} (attempt ${retries + 1})`);
        
        await page.setContent(getFontHtml(font, batch), { 
          waitUntil: 'domcontentloaded',
          timeout: CONFIG.PAGE_TIMEOUT 
        });
        
        await Promise.race([
          page.evaluate(async (fontFamily, size) => {
            while (!window.measureReady) {
              await new Promise(resolve => setTimeout(resolve, 10));
            }
            
            await document.fonts.ready;
            
            try {
              await document.fonts.load(`${size}px "${fontFamily}"`);
            } catch (e) {
              console.warn('Font load warning:', e.message);
            }
            
            return true;
          }, font.cssFamily, CONFIG.TEST_SIZE),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Font loading timeout')), CONFIG.FONT_LOAD_TIMEOUT)
          )
        ]);
        
        const batchResults = await page.evaluate((chars, characterMap) => {
          const container = document.getElementById('container');
          const results = {};
          
          const charToKeyMap = {};
          for (const [key, char] of Object.entries(characterMap)) {
            charToKeyMap[char] = key;
          }
          
          for (const char of chars) {
            try {
              const el = document.createElement('div');
              el.className = 'char';
              el.textContent = char;
              container.appendChild(el);
              
              const rect = el.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                const unicodeKey = charToKeyMap[char];
                if (unicodeKey) {
                  results[unicodeKey] = Math.round(rect.width * 100) / 100;
                }
              }
              
              container.removeChild(el);
            } catch (error) {
              console.warn(`Error measuring character "${char}":`, error.message);
            }
          }
          
          return results;
        }, batch, Object.fromEntries(CHARACTER_MAP));
        
        Object.assign(results, batchResults);
        break;
        
      } catch (error) {
        retries++;
        console.warn(`  ⚠️ Batch ${batchIndex + 1} attempt ${retries} failed:`, error.message);
        
        if (retries >= CONFIG.MAX_RETRIES) {
          console.error(`  ❌ Batch ${batchIndex + 1} failed after ${CONFIG.MAX_RETRIES} attempts`);
          break;
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000 * retries));
      }
    }
  }
  
  return results;
}

async function processFont(page, key, font) {
  try {
    console.log(`📐 Measuring characters for "${key}"`);
    console.log(`  🔗 Font URL: ${font.importUrl}`);
    console.log(`  📝 CSS Family: ${font.cssFamily}`);
    
    const startTime = Date.now();
    const charMetrics = await measureCharactersInBatches(page, font, CHARACTERS_ARRAY);
    const endTime = Date.now();
    
    const measuredCount = Object.keys(charMetrics).length;
    console.log(`  ✅ Measured ${measuredCount}/${CHARACTER_MAP.size} characters in ${endTime - startTime}ms`);
    
    font.characters = charMetrics;
    font.characterCount = measuredCount;
    font.lastMeasured = new Date().toISOString();
    delete font.scale;
    
    return true;
  } catch (error) {
    console.error(`  ❌ Failed to measure "${key}": ${error.message}`);
    
    font.measurementError = error.message;
    font.lastMeasured = new Date().toISOString();
    
    return false;
  }
}

function writeOutputSafely(fonts) {
  const outputData = JSON.stringify(fonts, null, 2);
  
  try {
    if (fs.existsSync(CONFIG.OUTPUT_FILE)) {
      const backupFile = CONFIG.OUTPUT_FILE.replace('.json', '.backup.json');
      fs.copyFileSync(CONFIG.OUTPUT_FILE, backupFile);
      console.log(`📋 Created backup: ${backupFile}`);
    }
    
    fs.writeFileSync(CONFIG.OUTPUT_FILE, outputData, 'utf-8');
    console.log(`💾 Output written to: ${CONFIG.OUTPUT_FILE}`);
    
  } catch (error) {
    throw new Error(`Failed to write output file: ${error.message}`);
  }
}

(async () => {
  let browser = null;
  
  try {
    console.log('🚀 Starting font character measurement...');
    
    const fonts = validateInput();
    const fontEntries = Object.entries(fonts);
    console.log(`📚 Found ${fontEntries.length} fonts to process`);
    
    browser = await puppeteer.launch({ 
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions'
      ]
    });
    
    const page = await browser.newPage();
    
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    
    page.setDefaultTimeout(CONFIG.PAGE_TIMEOUT);
    
    let successCount = 0;
    let failureCount = 0;
    
    for (let i = 0; i < fontEntries.length; i++) {
      const [key, font] = fontEntries[i];
      
      console.log(`\n[${i + 1}/${fontEntries.length}] Processing font: ${key}`);
      
      const success = await processFont(page, key, font);
      if (success) {
        successCount++;
      } else {
        failureCount++;
      }
      
      await page.goto('about:blank');
    }
    
    writeOutputSafely(fonts);
    
    console.log('\n✅ Font character measurement complete!');
    console.log(`📊 Results: ${successCount} successful, ${failureCount} failed`);
    
  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    process.exit(1);
    
  } finally {
    if (browser) {
      await browser.close();
      console.log('🔒 Browser closed');
    }
  }
})();
