const express = require('express');
const axios = require('axios');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 3000;

// radio.com.lk Target Page Slugs
const PAGES = {
  hiru: 'https://radio.com.lk/abc-hiru-fm/',
  shaa: 'https://radio.com.lk/abc-shaa-fm/',
  derana: 'https://radio.com.lk/fm-derana/',
  yfm: 'https://radio.com.lk/y-fm/',
  siyatha: 'https://radio.com.lk/siyatha-fm/',
  neth: 'https://radio.com.lk/neth-fm/',
  sirasa: 'https://radio.com.lk/sirasa-fm/'
};

// Stream Cache (සෑම පාරම Browser එක ඕපන් නොකර වේගවත් කිරීමට)
const streamCache = {};

async function extractAudioUrlFromPage(pageUrl) {
  let browser = null;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--autoplay-policy=no-user-gesture-required'
      ]
    });

    const page = await browser.newPage();
    let detectedAudioUrl = null;

    // Network Request මගින් Audio Stream එක අල්ලා ගැනීම
    page.on('request', (request) => {
      const url = request.url();
      if (
        (url.includes('.mp3') || url.includes('.aac') || url.includes('/stream') || url.includes(':8000') || url.includes(':70')) &&
        !url.includes('google') && !url.includes('analytics')
      ) {
        if (!detectedAudioUrl) {
          detectedAudioUrl = url;
        }
      }
    });

    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });

    // Web site එකේ Play button එක click කිරීම
    try {
      await page.waitForSelector('button, .play, #play, .fa-play', { timeout: 3000 });
      await page.click('button, .play, #play, .fa-play');
    } catch (e) {
      // Play button නොතිබුණත් ස්වයංක්‍රීයව play වේ නම් දිගටම යයි
    }

    // Audio Request එක හසුවන තෙක් තත්පර 4ක් රැඳී සිටීම
    await new Promise((r) => setTimeout(r, 4000));

    await browser.close();
    return detectedAudioUrl;
  } catch (err) {
    console.error(`Puppeteer Error [${pageUrl}]:`, err.message);
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

  // Cache එකේ නොමැති නම් Scraping සිදු කිරීම
  if (!liveStreamUrl) {
    console.log(`Scraping stream URL for ${station}...`);
    liveStreamUrl = await extractAudioUrlFromPage(targetPage);
    if (liveStreamUrl) {
      streamCache[station] = liveStreamUrl;
      // විනාඩි 30කට පසු Cache එක clear කිරීම
      setTimeout(() => delete streamCache[station], 30 * 60 * 1000);
    }
  }

  // Backup Manual Fallback URLs (Scraper එක අසාර්ථක වුවහොත්)
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

  try {
    const audioResponse = await axios({
      method: 'get',
      url: finalUrl,
      responseType: 'stream',
      headers: {
        'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18'
      },
      timeout: 10000
    });

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Cache-Control', 'no-cache');

    audioResponse.data.pipe(res);

    req.on('close', () => {
      if (audioResponse.data) audioResponse.data.destroy();
    });
  } catch (err) {
    console.error(`Stream Connection Error:`, err.message);
    // Link එක expire වී ඇත්නම් Cache එක Clear කිරීම
    delete streamCache[station];
    res.status(500).send('Stream Proxy Connection Failed');
  }
});

app.get('/', (req, res) => {
  res.send('ETS2 Radio Scraper Proxy Active!');
});

app.listen(PORT, () => {
  console.log(`Server active on port ${PORT}`);
});
