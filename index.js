const express = require('express');
const axios = require('axios');
const http = require('http');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

const STATIONS = {
  hiru: { id: 26516, slug: 'abc-hiru-fm' },
  shaa: { id: 26517, slug: 'abc-shaa-fm' },
  derana: { id: 26515, slug: 'fm-derana' },
  yfm: { id: 26518, slug: 'y-fm' },
  siyatha: { id: 26519, slug: 'siyatha-fm' },
  neth: { id: 26520, slug: 'neth-fm' },
  sirasa: { id: 26521, slug: 'sirasa-fm' }
};

const FALLBACKS = {
  hiru: 'http://209.133.216.3:7018/stream',
  shaa: 'http://209.133.216.3:7048/stream',
  derana: 'http://209.133.216.3:7008/stream',
  yfm: 'http://209.133.216.3:7038/stream',
  siyatha: 'http://108.61.34.50:8408/stream',
  neth: 'http://209.133.216.3:7028/stream',
  sirasa: 'http://192.99.8.192:3032/stream'
};

async function getDirectAudioUrl(stationKey) {
  const station = STATIONS[stationKey];
  if (!station) return FALLBACKS[stationKey];

  try {
    const response = await axios.get(`https://api.instant.audio/data/streams/${station.id}/${station.slug}`, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://radio.com.lk/' },
      timeout: 4000
    });

    if (response.data?.result?.streams) {
      const mp3 = response.data.result.streams.find(s => (s.mime === 'audio/mpeg' || s.mime === 'audio/aac') && s.url?.startsWith('http'));
      if (mp3) return mp3.url;
    }
  } catch (e) {}

  return FALLBACKS[stationKey];
}

app.get('/radio/:station', async (req, res) => {
  const stationKey = req.params.station.toLowerCase();
  const targetUrl = await getDirectAudioUrl(stationKey);

  if (!targetUrl) {
    return res.status(502).send('Stream Unavailable');
  }

  console.log(`[ETS2 Stream Request] ${stationKey} -> ${targetUrl}`);

  const isHttps = targetUrl.startsWith('https');
  const client = isHttps ? https : http;

  // FMOD sound engine එකට අවශ්‍ය ICY headers සෙට් කිරීම
  const options = {
    rejectUnauthorized: false,
    headers: {
      'User-Agent': 'Winamp/5.66',
      'Accept': '*/*',
      'Icy-MetaData': '1',
      'Connection': 'keep-alive'
    }
  };

  const streamReq = client.get(targetUrl, options, (streamRes) => {
    // Handling 301/302 Redirects at source level
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
      console.error(`Source Stream Failed with status ${streamRes.statusCode}`);
      return res.status(502).send('Radio Stream Unavailable');
    }

    // Direct HTTP Stream headers required for ETS2 FMOD Engine
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
    console.error(`Stream Connection Error: ${err.message}`);
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
