const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Radio Station ID Mapping (instant.audio IDs)
const STATIONS = {
  hiru: { id: 26516, slug: 'abc-hiru-fm' },
  shaa: { id: 26517, slug: 'abc-shaa-fm' },
  derana: { id: 26515, slug: 'fm-derana' },
  yfm: { id: 26518, slug: 'y-fm' },
  siyatha: { id: 26519, slug: 'siyatha-fm' },
  neth: { id: 26520, slug: 'neth-fm' },
  sirasa: { id: 26521, slug: 'sirasa-fm' }
};

// Emergency Direct Fallbacks
const FALLBACKS = {
  hiru: 'https://radio.lotustechnologieslk.net:2020/stream/hirufmgarden/stream/1/',
  shaa: 'http://209.133.216.3:7048/stream',
  derana: 'http://209.133.216.3:7008/stream',
  yfm: 'http://209.133.216.3:7038/stream',
  siyatha: 'http://108.61.34.50:8408/stream',
  neth: 'http://209.133.216.3:7028/stream',
  sirasa: 'http://192.99.8.192:3032/stream'
};

const cache = {};

// Helper: Instant Audio API එකෙන් Direct MP3 Stream URL එක අරගැනීම
async function fetchDirectAudioStream(stationKey) {
  const station = STATIONS[stationKey];
  if (!station) return null;

  const apiUrl = `https://api.instant.audio/data/streams/${station.id}/${station.slug}`;

  try {
    const response = await axios.get(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Referer': 'https://radio.com.lk/'
      },
      timeout: 5000
    });

    if (response.data && response.data.result && Array.isArray(response.data.result.streams)) {
      const streams = response.data.result.streams;

      // 1. First priority: Direct audio/mpeg MP3 URL
      const mp3Stream = streams.find(s => s.mime === 'audio/mpeg' && s.url && s.url.startsWith('http'));
      if (mp3Stream) return mp3Stream.url;

      // 2. Second priority: Any stream URL with /stream/ or .mp3
      const fallbackStream = streams.find(s => s.url && (s.url.includes('/stream/') || s.url.includes('.mp3')));
      if (fallbackStream) return fallbackStream.url;
    }
  } catch (err) {
    console.error(`API Fetch Error for ${stationKey}:`, err.message);
  }

  return null;
}

app.get('/radio/:station', async (req, res) => {
  const stationKey = req.params.station.toLowerCase();

  if (!STATIONS[stationKey] && !FALLBACKS[stationKey]) {
    return res.status(404).send('Radio station not found');
  }

  // 1. Check Cache (1 Hour cache for super fast response)
  if (cache[stationKey]) {
    return res.redirect(302, cache[stationKey]);
  }

  // 2. Fetch Direct Stream URL from API
  let directAudioUrl = await fetchDirectAudioStream(stationKey);

  // 3. Fallback if API fails
  if (!directAudioUrl) {
    directAudioUrl = FALLBACKS[stationKey];
  }

  if (directAudioUrl) {
    cache[stationKey] = directAudioUrl;
    setTimeout(() => delete cache[stationKey], 60 * 60 * 1000); // Clear cache in 1 hour

    console.log(`[SUCCESS] Redirecting ${stationKey} -> ${directAudioUrl}`);
    return res.redirect(302, directAudioUrl);
  }

  return res.status(502).send('Audio Stream Unavailable');
});

app.get('/', (req, res) => {
  res.send('ETS2 Radio Scraper - High Speed Proxy Active!');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
