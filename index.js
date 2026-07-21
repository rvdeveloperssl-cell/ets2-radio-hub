const express = require('express');
const https = require('https');
const http = require('http');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 3000;

const PAGES = {
  hiru: 'https://radio.com.lk/abc-hiru-fm/',
  shaa: 'https://radio.com.lk/abc-shaa-fm/',
  derana: 'https://radio.com.lk/fm-derana/',
  yfm: 'https://radio.com.lk/y-fm/',
  siyatha: 'https://radio.com.lk/siyatha-fm/',
  neth: 'https://radio.com.lk/neth-fm/',
  sirasa: 'https://radio.com.lk/sirasa-fm/'
};

const FALLBACKS = {
  hiru: 'https://radio.lotustechnologieslk.net:2020/stream/hirufmgarden/stream/1/',
  shaa: 'http://209.133.216.3:7048/stream',
  derana: 'http://209.133.216.3:7008/stream',
  yfm: 'http://209.133.216.3:7038/stream',
  siyatha: 'http://108.61.34.50:8408/stream',
  neth: 'http://209.133.216.3:7028/stream',
  sirasa: 'http://192.99.8.192:3032/stream'
};

const streamCache = {};

// Helper: JSON response එකක් ආවොත් ඒකෙන් audio stream URL එක අරගැනීම
function extractFromAudioJson(jsonObj) {
  if (jsonObj && jsonObj.result && Array.isArray(jsonObj.result.streams)) {
    const audioObj = jsonObj.result.streams.find(
      (s) => s.mime === 'audio/mpeg' || s.mime === 'audio/aac' || (s.url && s.url.includes('/stream/'))
    );
    if (audioObj && audioObj.url) {
      return audioObj.url;
    }
  }
  return null;
}

async function extractAudioUrlFromPage(pageUrl) {
  let browser = null;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process'
      ]
    });

    const page = await browser.newPage();
    let detectedAudioUrl = null;

    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      const resourceType = req.resourceType();

      if (
        (url.includes('.mp3') || url.includes('.aac') || url.includes('/stream/') || url.includes('api.instant.audio')) &&
        !url.includes('google') && !url.includes('analytics')
      ) {
        if (!detectedAudioUrl) {
          detectedAudioUrl = url;
        }
      }

      if (['image', 'stylesheet', 'font', 'other'].includes(resourceType) && !url.includes('stream')) {
        req.abort().catch(() => {});
      } else {
        req.continue().catch(() => {});
      }
    });

    const response = await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 12000 }).catch(() => null);

    // Page එකෙන් direct JSON response එකක් ආවොත් ඒක parse කරලා ගන්නවා
    if (response) {
      try {
        const textContent = await response.text();
        const parsedJson = JSON.parse(textContent);
        const streamFromJson = extractFromAudioJson(parsedJson);
        if (streamFromJson) {
          await browser.close();
          return streamFromJson;
        }
      } catch (e) {
        // Direct JSON එකක් නෙමෙයි නම් normal page handling එකට යනවා
      }
    }

    try {
      await page.waitForSelector('button, .play, #play, .fa-play', { timeout: 3000 });
      await page.click('button, .play, #play, .fa-play');
    } catch (e) {}

    await new Promise((r) => setTimeout(r, 2000));

    await browser.close();
    return detectedAudioUrl;
  } catch (err) {
    console.error(`Puppeteer Error:`, err.message);
    if (browser) await browser.close().catch(() => {});
    return null;
  }
}

app.get('/radio/:station', async (req, res) => {
  try {
    const station = req.params.station.toLowerCase();
    const targetPage = PAGES[station];

    if (!targetPage) {
      return res.status(404).send('Station not mapped.');
    }

    let liveStreamUrl = streamCache[station];

    if (!liveStreamUrl) {
      let detectedUrl = await extractAudioUrlFromPage(targetPage);

      if (detectedUrl) {
        liveStreamUrl = detectedUrl;
        streamCache[station] = liveStreamUrl;
        setTimeout(() => delete streamCache[station], 30 * 60 * 1000); // 30 min cache
      }
    }

    const finalUrl = liveStreamUrl || FALLBACKS[station];

    if (!finalUrl) {
      return res.status(502).send('Radio Stream Unavailable');
    }

    // Direct redirecting to the live audio stream
    return res.redirect(302, finalUrl);

  } catch (globalErr) {
    const station = req.params.station ? req.params.station.toLowerCase() : null;
    if (station && FALLBACKS[station]) {
      return res.redirect(302, FALLBACKS[station]);
    }
    return res.status(500).send('Internal Server Error');
  }
});

app.get('/', (req, res) => {
  res.send('Radio Scraper Proxy Active!');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
