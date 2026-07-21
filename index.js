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

// Helper: JSON API එකෙන් Audio Stream Link එක Extract කිරීම
async function getStreamFromJsonApi(apiUrl) {
  return new Promise((resolve) => {
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Referer': 'https://radio.com.lk/'
      }
    };

    https.get(apiUrl, options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json && json.result && json.result.streams) {
            // Priority 1: Direct Audio Stream with mime audio/mpeg
            const audioObj = json.result.streams.find(
              (s) => s.mime === 'audio/mpeg' || (s.url && s.url.includes('/stream/'))
            );
            if (audioObj && audioObj.url) {
              return resolve(audioObj.url);
            }
          }
        } catch (e) {}
        resolve(null);
      });
    }).on('error', () => resolve(null));
  });
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
        '--single-process',
        '--no-zygote',
        '--autoplay-policy=no-user-gesture-required'
      ]
    });

    const page = await browser.newPage();
    let detectedAudioUrl = null;

    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      const resourceType = req.resourceType();

      if (
        (url.includes('.mp3') || url.includes('.aac') || url.includes('/stream/') || url.includes('api.instant.audio') || url.includes(':8000') || url.includes(':70')) &&
        !url.includes('google') && !url.includes('analytics')
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
    let detectedUrl = await extractAudioUrlFromPage(targetPage);

    if (detectedUrl && detectedUrl.includes('api.instant.audio')) {
      console.log(`Instant Audio API detected: ${detectedUrl}. Extracting direct stream...`);
      const directAudioUrl = await getStreamFromJsonApi(detectedUrl);
      if (directAudioUrl) {
        detectedUrl = directAudioUrl;
      }
    }

    if (detectedUrl) {
      liveStreamUrl = detectedUrl;
      console.log(`Final live stream for ${station}:`, liveStreamUrl);
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

  const isHttps = finalUrl.startsWith('https');
  const client = isHttps ? https : http;

  // 🎯 FIX 1: Ignore SSL errors on streaming servers + Full Browser Emulation Headers
  const options = {
    rejectUnauthorized: false,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Range': 'bytes=0-',
      'Connection': 'keep-alive',
      'Icy-MetaData': '1'
    }
  };

  const streamReq = client.get(finalUrl, options, (streamRes) => {
    // Handle Redirects (301/302)
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

    // 🎯 FIX 2: Radio server එක තවමත් Proxy IP block කරලා 403 දෙනවා නම් Direct Browser 302 Redirect එකක් දීම!
    if (streamRes.statusCode === 403 || streamRes.statusCode === 401) {
      console.warn(`Server blocked proxy with ${streamRes.statusCode}. Redirecting client directly to stream...`);
      return res.redirect(302, finalUrl);
    }

    if (streamRes.statusCode !== 200 && streamRes.statusCode !== 206) {
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
    
    // Fail-safe: Direct redirect on error
    if (!res.headersSent) {
      console.log(`Fallback redirect for ${station}...`);
      return res.redirect(302, finalUrl);
    }
  });
});

app.get('/', (req, res) => {
  res.send('ETS2 Radio Scraper Proxy Active!');
});

app.listen(PORT, () => {
  console.log(`Server active on port ${PORT}`);
});
