const express = require('express');
const http = require('http');
const https = require('https');
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

const streamCache = {};

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
        '--single-process',
        '--no-zygote',
        '--autoplay-policy=no-user-gesture-required'
      ]
    });

    const page = await browser.newPage();
    let detectedAudioUrl = null;

    // Fetch instant.audio JSON API directly if trapped
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('api.instant.audio/data/streams/')) {
        try {
          const json = await response.json();
          if (json && json.result && json.result.streams) {
            // Find valid audio stream URL inside JSON
            const audioStream = json.result.streams.find(
              (s) => s.mime === 'audio/mpeg' || s.url.includes('/stream/') || s.url.includes('.mp3')
            );
            if (audioStream && audioStream.url) {
              detectedAudioUrl = audioStream.url;
            }
          }
        } catch (e) {}
      }
    });

    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      const resourceType = req.resourceType();

      // Direct MP3/AAC or Stream URL Detection
      if (
        (url.includes('.mp3') || url.includes('.aac') || url.includes('/stream/') || url.includes(':8000') || url.includes(':70')) &&
        !url.includes('google') && !url.includes('analytics') && !url.includes('api.instant.audio')
      ) {
        if (!detectedAudioUrl) {
          detectedAudioUrl = url;
        }
      }

      if (['image', 'stylesheet', 'font', 'other'].includes(resourceType) && !url.includes('stream')) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

    try {
      await page.waitForSelector('button, .play, #play, .fa-play', { timeout: 3000 });
      await page.click('button, .play, #play, .fa-play');
    } catch (e) {}

    await new Promise((r) => setTimeout(r, 4000));

    await browser.close();
    return detectedAudioUrl;
  } catch (err) {
    console.error(`Puppeteer Scrape Error [${pageUrl}]:`, err.message);
    if (browser) await browser.close();
    return null;
  }
}

app.get('/radio/:station', async (req, res) => {
  const station = req.params.station.toLowerCase();
  const targetPage = PAGES[station];

  if (!targetPage) {
    return res.status(404).send('Station page not mapped.');
  }

  let liveStreamUrl = streamCache[station];

  if (!liveStreamUrl) {
    console.log(`Scraping stream URL for ${station}...`);
    liveStreamUrl = await extractAudioUrlFromPage(targetPage);
    if (liveStreamUrl) {
      console.log(`Found live stream for ${station}:`, liveStreamUrl);
      streamCache[station] = liveStreamUrl;
      setTimeout(() => delete streamCache[station], 30 * 60 * 1000);
    }
  }

  const FALLBACKS = {
    hiru: 'http://209.133.216.3:7018/stream',
    shaa: 'http://209.133.216.3:7048/stream',
    derana: 'http://209.133.216.3:7008/stream',
    yfm: 'http://209.133.216.3:7038/stream',
    siyatha: 'http://108.61.34.50:8408/stream',
    neth: 'http://209.133.216.3:7028/stream',
    sirasa: 'http://192.99.8.192:3032/stream'
  };

  const finalUrl = liveStreamUrl || FALLBACKS[station];

  if (!finalUrl) {
    return res.status(502).send('Radio Stream Unavailable');
  }

  const client = finalUrl.startsWith('https') ? https : http;

  const options = {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://radio.com.lk/',
      'Icy-MetaData': '1'
    }
  };

  const streamReq = client.get(finalUrl, options, (streamRes) => {
    // Handle Redirects
    if (streamRes.statusCode >= 300 && streamRes.statusCode < 400 && streamRes.headers.location) {
      const redirectUrl = streamRes.headers.location;
      const redirectClient = redirectUrl.startsWith('https') ? https : http;
      
      return redirectClient.get(redirectUrl, options, (redRes) => {
        res.setHeader('Content-Type', redRes.headers['content-type'] || 'audio/mpeg');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Cache-Control', 'no-cache');
        redRes.pipe(res);
      });
    }

    if (streamRes.statusCode !== 200) {
      console.error(`Stream Status Code Error [${station}]: ${streamRes.statusCode}`);
      delete streamCache[station];
      return res.status(500).send(`Stream Failed with Status: ${streamRes.statusCode}`);
    }

    res.setHeader('Content-Type', streamRes.headers['content-type'] || 'audio/mpeg');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Cache-Control', 'no-cache');

    streamRes.pipe(res);

    req.on('close', () => {
      streamRes.destroy();
    });
  });

  streamReq.on('error', (err) => {
    console.error(`Stream Request Error [${station}]:`, err.message);
    delete streamCache[station];
    if (!res.headersSent) {
      res.status(500).send('Stream Proxy Connection Failed');
    }
  });
});

app.get('/', (req, res) => {
  res.send('ETS2 Radio Scraper Proxy Active!');
});

app.listen(PORT, () => {
  console.log(`Server active on port ${PORT}`);
});
