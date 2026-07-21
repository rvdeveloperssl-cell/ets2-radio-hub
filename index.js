const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const app = express();

const PORT = process.env.PORT || 3000;

// radio.com.lk Page Slugs Mapping
const PAGES = {
  hiru: 'https://radio.com.lk/abc-hiru-fm/',
  shaa: 'https://radio.com.lk/abc-shaa-fm/',
  derana: 'https://radio.com.lk/fm-derana/',
  yfm: 'https://radio.com.lk/y-fm/',
  siyatha: 'https://radio.com.lk/siyatha-fm/',
  neth: 'https://radio.com.lk/neth-fm/',
  sirasa: 'https://radio.com.lk/sirasa-fm/'
};

// Web Page එකෙන් Audio Source URL එක සොයාගැනීමේ Function එක
async function fetchStreamUrl(pageUrl) {
  try {
    const { data } = await axios.get(pageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const $ = cheerio.load(data);
    
    // 1. HTML <audio> tag එකෙන් src එක සෙවීම
    let streamUrl = $('audio').attr('src') || $('source').attr('src');

    // 2. JavaScript variables ඇතුලෙන් stream URL එක Regex මගින් සෙවීම (Fallback)
    if (!streamUrl) {
      const match = data.match(/https?:\/\/[^"'\s]+\.(mp3|aac|stream)[^"'\s]*/i) ||
                    data.match(/https?:\/\/[^"'\s]+:8000\/[^"'\s]*/i);
      if (match) streamUrl = match[0];
    }

    return streamUrl;
  } catch (error) {
    console.error(`Error scraping ${pageUrl}:`, error.message);
    return null;
  }
}

app.get('/radio/:station', async (req, res) => {
  const station = req.params.station.toLowerCase();
  const targetPage = PAGES[station];

  if (!targetPage) {
    return res.status(404).send('Station page not mapped.');
  }

  // Page එකට Call කර සැබෑ Stream URL එක ලබාගැනීම
  const liveStreamUrl = await fetchStreamUrl(targetPage);

  if (!liveStreamUrl) {
    return res.status(500).send('Could not extract audio stream URL from page.');
  }

  try {
    const audioResponse = await axios({
      method: 'get',
      url: liveStreamUrl,
      responseType: 'stream',
      headers: {
        'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18'
      },
      timeout: 10000
    });

    res.setHeader('Content-Type', 'audio/mpeg');
    audioResponse.data.pipe(res);
  } catch (err) {
    console.error(`Stream Connection Error:`, err.message);
    res.status(500).send('Stream Unavailable');
  }
});

app.listen(PORT, () => {
  console.log(`Dynamic Scraper Radio Proxy active on port ${PORT}`);
});
