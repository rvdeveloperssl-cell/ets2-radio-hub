const express = require('express');
const axios = require('axios');
const http = require('http');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

// Direct Working Active Audio Streams (Tested & Direct Source Stream Nodes)
const STATIONS = {
  hiru: {
    id: 26516,
    slug: 'abc-hiru-fm',
    directUrl: 'https://radio.lotustechnologieslk.net:2020/stream/hirufmgarden/stream/1/'
  },
  shaa: {
    id: 26517,
    slug: 'abc-shaa-fm',
    directUrl: 'https://radio.lotustechnologieslk.net:2020/stream/shaafmgarden/stream/1/'
  },
  derana: {
    id: 26515,
    slug: 'fm-derana',
    directUrl: 'https://e1.everestcast.com:4085/stream'
  },
  yfm: {
    id: 26518,
    slug: 'y-fm',
    directUrl: 'https://mbc.dialog.lk/yfm'
  },
  siyatha: {
    id: 26519,
    slug: 'siyatha-fm',
    directUrl: 'https://stream.zeno.fm/f382a8497z8uv'
  },
  neth: {
    id: 26520,
    slug: 'neth-fm',
    directUrl: 'https://s2.voscast.com:10100/stream'
  },
  sirasa: {
    id: 26521,
    slug: 'sirasa-fm',
    directUrl: 'https://mbc.dialog.lk/sirasa'
  }
};

async function getDirectAudioUrl(stationKey) {
  const station = STATIONS[stationKey];
  if (!station) return null;

  // 1st Priority: Instant Audio API
  try {
    const response = await axios.get(`https://api.instant.audio/data/streams/${station.id}/${station.slug}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://radio.com.lk/'
      },
      timeout: 3000
    });

    if (response.data?.result?.streams) {
      const stream = response.data.result.streams.find(s =>
        (s.mime === 'audio/mpeg' || s.mime === 'audio/aac' || s.mime === 'audio/mp3') &&
        s.url && s.url.startsWith('http')
      );
      if (stream) return stream.url;
    }
  } catch (e) {
    // API Failed (e.g. 403 Forbidden on VPS) -> Silently fallback to direct URL
  }

  // 2nd Priority: Guaranteed Direct Source URL
  return station.directUrl;
}

app.get('/radio/:station', async (req, res) => {
  const stationKey = req.params.station.toLowerCase();
  
  if (!STATIONS[stationKey]) {
    return res.status(404).send('Station not found');
  }

  const targetUrl = await getDirectAudioUrl(stationKey);

  console.log(`[ETS2 Proxying Stream] ${stationKey} -> ${targetUrl}`);

  // Custom Agent to bypass HTTPS / Custom Port SSL Errors on Nodes
  const isHttps = targetUrl.startsWith('https');
  const client = isHttps ? https : http;

  const agentOptions = {
    rejectUnauthorized: false // Ignore SSL Port Certificate Mismatch for FMOD Engine compatibility
  };

  const agent = isHttps ? new https.Agent(agentOptions) : new http.Agent(agentOptions);

  const requestHeaders = {
    'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18',
    'Accept': '*/*',
    'Icy-MetaData': '1',
    'Connection': 'keep-alive'
  };

  const streamReq = client.get(targetUrl, { headers: requestHeaders, agent: agent }, (streamRes) => {
    // Handling HTTP Redirects (301, 302, 307)
    if (streamRes.statusCode >= 300 && streamRes.statusCode < 400 && streamRes.headers.location) {
      const redirectUrl = streamRes.headers.location;
      console.log(`[Redirect Detected] -> ${redirectUrl}`);
      
      const redIsHttps = redirectUrl.startsWith('https');
      const redClient = redIsHttps ? https : http;
      const redAgent = redIsHttps ? new https.Agent(agentOptions) : new http.Agent(agentOptions);

      return redClient.get(redirectUrl, { headers: requestHeaders, agent: redAgent }, (redRes) => {
        res.writeHead(200, {
          'Content-Type': 'audio/mpeg',
          'Connection': 'keep-alive',
          'Cache-Control': 'no-cache, no-store'
        });
        redRes.pipe(res);
      });
    }

    if (streamRes.statusCode !== 200 && streamRes.statusCode !== 206) {
      console.error(`Source Stream Failed with HTTP Status: ${streamRes.statusCode}`);
      return res.status(502).send('Radio Stream Source Unavailable');
    }

    // Force Clean Chunked Audio Header for ETS2 FMOD Engine
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
    console.error(`Stream Request Error for ${stationKey}: ${err.message}`);
    if (!res.headersSent) {
      res.status(500).send('Stream Proxy Error');
    }
  });
});

app.get('/', (req, res) => {
  res.send('ETS2 Dedicated Radio Stream Proxy Active & Healthy');
});

app.listen(PORT, () => {
  console.log(`ETS2 Radio Proxy Server active on port ${PORT}`);
});
