const express = require('express');
const axios = require('axios');
const app = express();

const PORT = process.env.PORT || 3000;

// radio.com.lk and Direct Live Audio Endpoints Map
const STATIONS = {
  hiru: [
    'http://stream.hirufm.lk:8000/hirufm',
    'http://209.133.216.3:7018/stream',
    'https://hirufm.lk/live/'
  ],
  shaa: [
    'http://stream.shaafm.lk:8000/shaafm',
    'http://209.133.216.3:7048/stream'
  ],
  derana: [
    'http://fmderana.lk:8000/fmderana',
    'http://209.133.216.3:7008/stream'
  ],
  yfm: [
    'http://stream.yfm.lk:8000/yfm',
    'http://209.133.216.3:7038/stream'
  ],
  siyatha: [
    'http://s3.voscast.com:8408/stream',
    'http://108.61.34.50:8408/stream'
  ],
  neth: [
    'http://pub.nethfm.com:8000/nethfm',
    'http://209.133.216.3:7028/stream'
  ],
  sirasa: [
    'http://192.99.8.192:3032/stream',
    'http://stream.sirasafm.lk:8000/sirasa'
  ]
};

// Function to find an active audio stream
async function getWorkingStream(urls) {
  for (const url of urls) {
    try {
      const res = await axios.get(url, {
        responseType: 'stream',
        timeout: 4000,
        headers: { 'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18' }
      });
      if (res.status === 200) {
        return { streamUrl: url, response: res };
      }
    } catch (err) {
      // Try next stream URL
      continue;
    }
  }
  return null;
}

app.get('/radio/:station', async (req, res) => {
  const station = req.params.station.toLowerCase();
  const streamUrls = STATIONS[station];

  if (!streamUrls) {
    return res.status(404).send('Station not found');
  }

  const activeStream = await getWorkingStream(streamUrls);

  if (!activeStream) {
    console.error(`No working stream for ${station}`);
    return res.status(502).send('Radio Stream Unavailable');
  }

  try {
    // ETS 2 Audio Engine Compatible Headers
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Accept-Ranges', 'none');

    activeStream.response.data.pipe(res);

    req.on('close', () => {
      if (activeStream.response.data) {
        activeStream.response.data.destroy();
      }
    });
  } catch (error) {
    console.error(`Streaming error on ${station}:`, error.message);
    res.status(500).send('Streaming Error');
  }
});

app.get('/', (req, res) => {
  res.send('ETS2 Radio Proxy Active!');
});

app.listen(PORT, () => {
  console.log(`Radio proxy running on port ${PORT}`);
});
