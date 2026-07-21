const express = require('express');
const axios = require('axios');
const app = express();

const PORT = process.env.PORT || 3000;

// Direct Audio Stream Endpoints (Primary & Backup Nodes)
const STATIONS = {
  hiru: [
    'http://stream.hirufm.lk:8000/hirufm',
    'http://209.133.216.3:7018/stream'
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

// Available stream එකක් සොයාගන්නා Helper Function එක
async function getWorkingStream(urls) {
  for (const url of urls) {
    try {
      const response = await axios({
        method: 'get',
        url: url,
        responseType: 'stream',
        timeout: 5000,
        headers: {
          'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18',
          'Icy-MetaData': '1'
        }
      });

      if (response.status === 200) {
        return { streamUrl: url, response };
      }
    } catch (err) {
      // Primary link එක වැඩ නැත්නම් ඊළඟ Backup Link එක බලයි
      continue;
    }
  }
  return null;
}

app.get('/radio/:station', async (req, res) => {
  const station = req.params.station.toLowerCase();
  const stationUrls = STATIONS[station];

  if (!stationUrls) {
    return res.status(404).send('Station not mapped');
  }

  const activeStream = await getWorkingStream(stationUrls);

  if (!activeStream) {
    console.error(`[Error] All stream nodes down for: ${station}`);
    return res.status(502).send('Radio Stream Unavailable');
  }

  try {
    // ETS2 Audio Engine (FMOD) එකට අවශ්‍ය Headers
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Cache-Control', 'no-cache, no-store');

    // Audio stream එක Client / Game එකට Pipe කිරීම
    activeStream.response.data.pipe(res);

    // Game එකෙන් වෙනත් station එකකට මාරු වුණොත් Stream Connection එක ක්ලෝස් කිරීම
    req.on('close', () => {
      if (activeStream.response.data) {
        activeStream.response.data.destroy();
      }
    });
  } catch (err) {
    console.error(`Streaming Pipe Error [${station}]:`, err.message);
    if (!res.headersSent) {
      res.status(500).send('Streaming Error');
    }
  }
});

app.get('/', (req, res) => {
  res.send('ETS2 Radio Proxy Server Active!');
});

app.listen(PORT, () => {
  console.log(`Radio proxy running on port ${PORT}`);
});
