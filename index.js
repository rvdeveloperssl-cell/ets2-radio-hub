const express = require('express');
const axios = require('axios');
const http = require('http');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

// Instant Audio API IDs (Current Working)
const STATIONS = {
  hiru: { id: 26516, slug: 'abc-hiru-fm' },
  shaa: { id: 26517, slug: 'abc-shaa-fm' },
  derana: { id: 26515, slug: 'fm-derana' },
  yfm: { id: 26518, slug: 'y-fm' },
  siyatha: { id: 26519, slug: 'siyatha-fm' },
  neth: { id: 26520, slug: 'neth-fm' },
  sirasa: { id: 26521, slug: 'sirasa-fm' }
};

// Updated Active Direct Stream Fallbacks (2026 Active Links)
const FALLBACKS = {
  hiru: 'https://radio.lotustechnologieslk.net:2020/stream/hirufmgarden/stream/1/',
  shaa: 'https://radio.lotustechnologieslk.net:2020/stream/shaafmgarden/stream/1/',
  derana: 'http://162.254.206.227:8000/stream',
  yfm: 'http://162.254.206.227:8008/stream',
  siyatha: 'http://s3.voscast.com:8408/stream',
  neth: 'http://162.254.206.227:8002/stream',
  sirasa: 'http://162.254.206.227:8004/stream'
};

async function getDirectAudioUrl(stationKey) {
  const station = STATIONS[stationKey];
  if (!station) return FALLBACKS[stationKey];

  try {
    const response = await axios.get(`https://api.instant.audio/data/streams/${station.id}/${station.slug}`, {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 
        'Referer': 'https://radio.com.lk/' 
      },
      timeout: 3500
    });

    if (response.data?.result?.streams) {
      // Direct MP3 URL Search
      const mp3 = response.data.result.streams.find(s => 
        (s.mime === 'audio/mpeg' || s.mime === 'audio/aac' || s.mime === 'audio/x-mpegurl') && 
        s.url && s.url.startsWith('http')
      );
      if (mp3) return mp3.url;
    }
  } catch (e) {
    console.error(`API Fetch Error for ${stationKey}: ${e.message}`);
  }

  return FALLBACKS[stationKey];
}

app.get('/radio/:station', async (req, res) => {
  const stationKey = req.params.station.toLowerCase();
  
  if (!STATIONS[stationKey] && !FALLBACKS[stationKey]) {
    return res.status(404).send('Station not found');
  }

  const targetUrl = await getDirectAudioUrl(stationKey);

  if (!targetUrl) {
    return res.status(502).send('Stream Unavailable');
  }

  console.log(`[ETS2 Proxying Stream] ${stationKey} -> ${targetUrl}`);

  const isHttps = targetUrl.startsWith('https');
  const client = isHttps ? https : http;

  const options = {
    rejectUnauthorized: false,
    headers: {
      'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18',
      'Accept': '*/*',
      'Icy-MetaData': '1',
      'Connection': 'keep-alive'
    }
  };

  const streamReq = client.get(targetUrl, options, (streamRes) => {
    // Handling 301/302 Redirects
    if (streamRes.statusCode >= 300 && streamRes.statusCode < 400 && streamRes.headers.location) {
      const redirectUrl = streamRes.headers.location;
      const redirectClient = redirectUrl.startsWith('https') ? https : http;
      return redirectClient.get(redirectUrl, options, (redRes) => {
        res.writeHead(200, {
          'Content-Type': 'audio/mpeg',
          'Connection': 'keep-alive',
          'Cache-Control': 'no-cache, no-store'
        });
        redRes.pipe(res);
      });
    }

    if (streamRes.statusCode !== 200 && streamRes.statusCode !== 206) {
      console.error(`Source Stream Error HTTP ${streamRes.statusCode}`);
      return res.status(502).send('Radio Stream Unavailable');
    }

    res.writeHead(200, {
      'Content-Type': 'audio/mpeg',
      'Connection': 'keep-alive',
      'Cache-Control': 'no-cache, no-store'
    });

    streamRes.pipe(res);

    req.on('close', () => {
      streamRes.destroy();
    });
  });

  streamReq.on('error', (err) => {
    console.error(`Stream Request Error: ${err.message}`);
    if (!res.headersSent) {
      res.status(500).send('Stream Error');
    }
  });
});

app.get('/', (req, res) => {
  res.send('ETS2 Dedicated Radio Stream Proxy Active');
});

app.listen(PORT, () => {
  console.log(`ETS2 Radio Proxy Server active on port ${PORT}`);
});
